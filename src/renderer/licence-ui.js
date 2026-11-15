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

function renderActivation(lic, onActivated) {
  document.body.classList.add('locked');
  const error = h('div', { class: 'error', role: 'alert' });
  const problem = lic.status !== 'absente' && h('div', { class: 'error' }, lic.message);
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
      h('p', { class: 'muted small' }, `Version ${lic.version}`)));
}

async function licenceSection() {
  const lic = await window.api.getLicence();
  const error = h('div', { class: 'error', role: 'alert' });
  const status = lic.status === 'valide'
    ? (lic.expires ? `Valide jusqu’au ${formatIsoDate(lic.expires)}` : 'Valide, sans date de fin')
    : lic.enforced ? lic.message : 'Non exigée en mode développement';
  return h('section', { class: 'card narrow' },
    h('h2', {}, 'Licence'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Titulaire'), h('dd', {}, lic.status === 'valide' ? lic.name : '—'),
      h('dt', {}, 'Statut'), h('dd', { id: 'licence-status' }, status),
      h('dt', {}, 'Code machine'), h('dd', {}, lic.machine_code),
      h('dt', {}, 'Version'), h('dd', {}, lic.version)),
    error,
    h('details', {},
      h('summary', {}, 'Installer une autre licence'),
      h('div', { class: 'stack details-body' },
        licenceInstaller(error, async () => { toast('Licence installée.'); await refresh(); }))));
}
