'use strict';
// Écran d'activation (affiché tant qu'aucune licence valide n'est installée)
// et section Licence des paramètres.

const formatIsoDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function machineCodeBox(code) {
  const copied = h('span', { class: 'muted small', 'aria-live': 'polite' });
  return h('div', { class: 'code-box' },
    h('span', { class: 'machine-code', id: 'machine-code' }, code),
    h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        try { await navigator.clipboard.writeText(code); copied.textContent = 'Copié.'; } catch (err) { copied.textContent = 'Notez le code à la main.'; }
      },
    }, 'Copier'),
    copied);
}

// Installe la licence choisie puis lance onDone ; affiche l'erreur sinon.
function licenceInstaller(error, onDone) {
  const run = async (action) => {
    error.textContent = '';
    try {
      const result = await action();
      if (result) await onDone(result);
    } catch (err) {
      error.textContent = cleanIpcError(err);
    }
  };
  const text = h('textarea', { id: 'f-licence', rows: 4, 'aria-label': 'Texte de la licence', placeholder: 'FACT1.…' });
  return [
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => run(() => window.api.importLicenceFile()) }, 'Choisir le fichier de licence')),
    h('details', {},
      h('summary', {}, 'Vous avez reçu la licence sous forme de texte ?'),
      h('div', { class: 'stack details-body' },
        text,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => run(() => window.api.activateLicence(text.value)) }, 'Activer avec ce texte')))),
  ];
}

const daysLeftText = (n) => (n > 1 ? `il reste ${n} jours` : 'dernier jour');

// Encadré du menu latéral pendant la période d'essai.
async function refreshTrialBox() {
  const lic = await window.api.getLicence();
  const box = document.getElementById('trial-box');
  if (lic.status === 'valide' || !lic.trial || !lic.trial.active) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(h('div', { class: 'trial', role: 'status' },
    h('strong', {}, 'Période d\u2019essai'),
    h('span', { id: 'trial-left' }, `${daysLeftText(lic.trial.days_left).replace(/^./, (c) => c.toUpperCase())}, jusqu\u2019au ${formatIsoDate(lic.trial.ends)} inclus`),
    h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        await go('settings');
        const card = document.getElementById('licence-card');
        card.querySelector('details').open = true;
        card.scrollIntoView({ block: 'start' });
      },
    }, 'Activer le logiciel')));
}

function renderActivation(lic, onActivated) {
  document.body.classList.add('locked');
  const error = h('div', { class: 'error', role: 'alert' });
  const trialOver = lic.trial && !lic.trial.active;
  const reason = lic.status !== 'absente' ? lic.message
    : trialOver ? `La période d\u2019essai de ${lic.trial.days} jours est terminée. Vos données sont conservées : elles seront de nouveau accessibles dès l\u2019activation.` : '';
  const problem = reason && h('div', { class: 'error' }, reason);
  document.getElementById('view').replaceChildren(
    h('div', { class: 'activation' },
      h('h1', {}, 'Activer le logiciel'),
      h('p', { class: 'muted' }, 'Ce logiciel fonctionne avec une licence propre à cet ordinateur. L’activation se fait une seule fois, sans Internet.'),
      problem,
      h('section', { class: 'card' },
        h('h2', {}, '1. Communiquez ce code à votre vendeur'),
        machineCodeBox(lic.machine_code),
        h('p', { class: 'muted small' }, 'Ce code identifie cet ordinateur. Il ne contient aucune information personnelle.')),
      h('section', { class: 'card' },
        h('h2', {}, '2. Installez la licence reçue'),
        h('p', { class: 'muted' }, 'Votre vendeur vous remet un fichier de licence, en général sur une clé USB.'),
        error,
        licenceInstaller(error, async () => {
          document.body.classList.remove('locked');
          toast('Logiciel activé.');
          await onActivated();
        })),
      h('section', { class: 'card' },
        h('h2', {}, 'Récupérer vos données'),
        h('p', { class: 'muted' }, 'Même sans licence, vous pouvez copier toutes vos données dans un fichier de sauvegarde.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: runBackup }, 'Sauvegarder mes données'))),
      h('p', { class: 'muted small' }, `Version ${lic.version}`)));
}

async function licenceSection() {
  const lic = await window.api.getLicence();
  const error = h('div', { class: 'error', role: 'alert' });
  const status = lic.status === 'valide'
    ? (lic.expires ? `Valide jusqu’au ${formatIsoDate(lic.expires)}` : 'Valide, sans date de fin')
    : !lic.enforced ? 'Non exigée en mode développement'
      : lic.trial && lic.trial.active && lic.status === 'absente' ? `Période d\u2019essai : ${daysLeftText(lic.trial.days_left)}, jusqu\u2019au ${formatIsoDate(lic.trial.ends)} inclus`
        : lic.message;
  return h('section', { class: 'card narrow', id: 'licence-card' },
    h('h2', {}, 'Licence'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Titulaire'), h('dd', {}, lic.status === 'valide' ? lic.name : '—'),
      h('dt', {}, 'Statut'), h('dd', { id: 'licence-status' }, status),
      h('dt', {}, 'Code machine'), h('dd', {}, lic.machine_code),
      h('dt', {}, 'Version'), h('dd', {}, lic.version)),
    error,
    h('details', {},
      h('summary', {}, lic.status === 'valide' ? 'Installer une autre licence' : 'Installer une licence'),
      h('div', { class: 'stack details-body' },
        licenceInstaller(error, async () => { toast('Licence installée.'); await refreshTrialBox(); await refresh(); }))));
}
