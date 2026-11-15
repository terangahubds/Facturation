'use strict';
// Chiffres du tableau de bord, calculés à la demande à partir des factures, avoirs et paiements.

const { today } = require('./invoices');

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

// on : date du jour au format AAAA-MM-JJ (paramètre pour les tests).
function getDashboard(db, { on = today() } = {}) {
  const year = Number(on.slice(0, 4));
  const monthIndex = Number(on.slice(5, 7)) - 1;
  const currentMonth = on.slice(0, 7);

  // Montant facturé par mois, avoirs déduits, sur les six derniers mois.
  const billedByMonth = new Map(db.prepare(`
    SELECT substr(issue_date, 1, 7) AS month,
           SUM(CASE WHEN kind = 'avoir' THEN -total_ttc ELSE total_ttc END) AS total
    FROM invoices WHERE status = 'emise' GROUP BY month
  `).all().map((r) => [r.month, r.total]));
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(year, monthIndex - i, 1));
    const key = monthKey(d.getUTCFullYear(), d.getUTCMonth());
    months.push({ key, label: MONTH_NAMES[d.getUTCMonth()], year: d.getUTCFullYear(), total: billedByMonth.get(key) || 0 });
  }

  const issuedThisMonth = db.prepare(`SELECT COUNT(*) AS n FROM invoices
    WHERE status = 'emise' AND kind = 'facture' AND substr(issue_date, 1, 7) = ?`).get(currentMonth).n;
  const collected = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payments
    WHERE substr(paid_on, 1, 7) = ?`).get(currentMonth);

  // Factures émises non soldées : reste dû = total − avoirs − paiements.
  const open = db.prepare(`
    SELECT i.id, i.number, i.client_name, i.due_date, i.total_ttc
      - (SELECT COALESCE(SUM(a.total_ttc), 0) FROM invoices a WHERE a.credit_of = i.id AND a.status = 'emise')
      - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.invoice_id = i.id) AS remaining
    FROM invoices i WHERE i.status = 'emise' AND i.kind = 'facture'
  `).all().filter((r) => r.remaining > 0);
  const late = open.filter((r) => r.due_date < on)
    .map((r) => ({ ...r, days_late: daysBetween(r.due_date, on) }))
    .sort((a, b) => b.days_late - a.days_late);
  const pending = open.filter((r) => r.due_date >= on);
  const sum = (rows) => rows.reduce((s, r) => s + r.remaining, 0);

  const quotes = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc), 0) AS total FROM quotes
    WHERE status = 'envoye' AND valid_until >= ?`).get(on);

  return {
    month_label: `${MONTH_NAMES[monthIndex]} ${year}`,
    billed: { total: months[5].total, count: issuedThisMonth },
    collected: { total: collected.total, count: collected.n },
    pending: { total: sum(pending), count: pending.length },
    late: { total: sum(late), count: late.length },
    late_invoices: late.slice(0, 5),
    months,
    open_quotes: { total: quotes.total, count: quotes.n },
  };
}

module.exports = { getDashboard };
