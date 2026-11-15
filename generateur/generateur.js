'use strict';
// Fenêtre du générateur de licences.

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const cleanError = (err) => String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const frDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

// Ce que l'utilisateur a saisi est conservé quand la fenêtre se redessine.
const form = { machine: '', name: '', mode: 'sans', expires: '' };
let lastCreated = null;

async function chooseKey(error) {
  error.textContent = '';
  try {
    const state = await window.generateur.chooseKey();
    if (state) render(state);
  } catch (err) {
    error.textContent = cleanError(err);
  }
}

function keySection(state) {
  const error = h('div', { class: 'error', role: 'alert' });
  if (!state.hasKey) {
    return h('section', { class: 'card' },
      h('h2', {}, 'Avant de commencer : votre clé privée'),
      h('p', { class: 'muted' }, 'Le générateur a besoin de votre fichier de clé privée (licence-cle-privee.pem) pour signer les licences. Vous ne le choisissez qu’une fois : une copie est gardée sur cet ordinateur.'),
      error,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => chooseKey(error) }, 'Choisir ma clé privée')));
  }
  return h('section', { class: 'card' },
    h('div', { class: 'line' },
      h('span', { id: 'key-status' }, state.keyMatches ? 'Clé privée installée.' : 'Clé privée installée, mais elle ne correspond pas à l’application.'),
      h('button', { type: 'button', class: 'btn small', onclick: () => chooseKey(error) }, 'Changer de clé')),
    !state.keyMatches && h('p', { class: 'error' }, 'Les licences créées avec cette clé seraient refusées chez vos clients. Choisissez la clé qui a servi à fabriquer l’installateur.'),
    error);
}

function licenceForm(state) {
  const error = h('div', { class: 'error', role: 'alert' });
  const dateField = h('input', {
    type: 'date', id: 'f-expires', 'aria-label': 'Date de fin', value: form.expires, disabled: form.mode !== 'date',
    oninput: (e) => { form.expires = e.target.value; },
  });
  const radio = (value, label) => h('label', { class: 'check' },
    h('input', {
      type: 'radio', name: 'mode', value, checked: form.mode === value,
      onchange: () => { form.mode = value; dateField.disabled = value !== 'date'; if (value === 'date') dateField.focus(); },
    }), label);

  const submit = async (event) => {
    event.preventDefault();
    error.textContent = '';
    try {
      if (form.mode === 'date' && !form.expires) throw new Error('Choisissez la date de fin de la licence.');
      const result = await window.generateur.makeLicence({ machine: form.machine, name: form.name, expires: form.mode === 'date' ? form.expires : null });
      if (!result) return;
      lastCreated = { file: result.file, name: form.name.trim() };
      form.machine = ''; form.name = ''; form.mode = 'sans'; form.expires = '';
      render(result.state);
    } catch (err) {
      error.textContent = cleanError(err);
    }
  };

  return h('form', { class: 'card', onsubmit: submit },
    h('h2', {}, 'Créer une licence'),
    error,
    h('div', { class: 'field' },
      h('label', { for: 'f-machine' }, 'Code machine du client'),
      h('input', { type: 'text', id: 'f-machine', required: true, placeholder: 'XXXX-XXXX-XXXX-XXXX', autocomplete: 'off', value: form.machine, oninput: (e) => { form.machine = e.target.value; } }),
      h('span', { class: 'hint' }, 'Le client le trouve dans Paramètres, section Licence, ou sur l’écran d’activation.')),
    h('div', { class: 'field' },
      h('label', { for: 'f-name' }, 'Nom du client'),
      h('input', { type: 'text', id: 'f-name', required: true, autocomplete: 'off', value: form.name, oninput: (e) => { form.name = e.target.value; } })),
    h('fieldset', { class: 'field' },
      h('legend', {}, 'Durée de la licence'),
      h('div', { class: 'radio-row' }, radio('sans', 'Sans date de fin'), radio('date', 'Jusqu’au'), dateField)),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary', disabled: !state.hasKey || !state.keyMatches }, 'Créer la licence')));
}

function journalSection(state) {
  if (state.journal.length === 0) return null;
  return h('section', { class: 'card' },
    h('h2', {}, `Licences créées (${state.journal.length})`),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Créée le'), h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col' }, 'Code machine'), h('th', { scope: 'col' }, 'Valable'))),
      h('tbody', {}, state.journal.map((j) => h('tr', {},
        h('td', { class: 'muted' }, frDate(j.created)),
        h('td', { class: 'strong' }, j.name),
        h('td', {}, j.machine),
        h('td', {}, j.expires ? `jusqu’au ${frDate(j.expires)}` : 'sans date de fin')))))));
}

function render(state) {
  const created = lastCreated && h('div', { class: 'success', role: 'status' },
    h('span', { class: 'path' }, `Licence de ${lastCreated.name} enregistrée : ${lastCreated.file}`),
    h('button', { type: 'button', class: 'btn small', onclick: () => window.generateur.showFile(lastCreated.file) }, 'Ouvrir le dossier'));
  document.getElementById('view').replaceChildren(...[
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Générateur de licences'), h('span', { class: 'muted' }, 'Réservé au vendeur. Ne remettez jamais ce programme ni votre clé privée à un client.'))),
    keySection(state),
    created,
    licenceForm(state),
    journalSection(state),
    h('p', { class: 'muted small' }, `Version ${state.version}`),
  ].filter(Boolean));
}

window.generateur.getState().then(render);
