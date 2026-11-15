#!/usr/bin/env node
'use strict';
// Outil du vendeur : crée les licences des clients. Ne fait pas partie de l'application livrée.
//
//   node tools/licence.js init
//       Crée votre paire de clés. La clé privée est écrite dans licence-cle-privee.pem
//       (à garder secrète, jamais dans le dépôt) et la clé publique dans l'application.
//
//   node tools/licence.js creer --machine XXXX-XXXX-XXXX-XXXX --nom "Nom du client" [--expire AAAA-MM-JJ]
//       Crée le fichier de licence du client dans le dossier licences/.

const fs = require('node:fs');
const path = require('node:path');
const { createLicence, generateKeyPair, normalizeCode } = require('../src/core/licence');

const ROOT = path.join(__dirname, '..');
const PRIVATE_KEY = process.env.FACTURATION_CLE_PRIVEE || path.join(ROOT, 'licence-cle-privee.pem');
const PUBLIC_KEY_MODULE = path.join(ROOT, 'src', 'core', 'licence-key.js');

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fail(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

const command = process.argv[2];

if (command === 'init') {
  if (fs.existsSync(PRIVATE_KEY) && !process.argv.includes('--remplacer')) {
    fail(`une clé privée existe déjà (${PRIVATE_KEY}). La remplacer rendrait invalides toutes les licences déjà vendues. Ajoutez --remplacer pour confirmer.`);
  }
  const keys = generateKeyPair();
  fs.writeFileSync(PRIVATE_KEY, keys.privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_MODULE, `'use strict';\n// Clé publique de vérification des licences. Créée par : node tools/licence.js init\nmodule.exports = \`${keys.publicKey}\`;\n`);
  console.log(`Clé privée écrite dans ${PRIVATE_KEY}`);
  console.log('Gardez ce fichier en lieu sûr, avec une copie de secours. Ne le partagez jamais.');
  console.log(`Clé publique écrite dans ${PUBLIC_KEY_MODULE} : enregistrez ce changement dans le dépôt.`);
} else if (command === 'creer') {
  const machine = option('machine');
  const name = option('nom');
  const expires = option('expire') || null;
  if (!machine || !name) fail('indiquez --machine et --nom. Exemple : node tools/licence.js creer --machine 1A2B-3C4D-5E6F-7G8H --nom "Cabinet Diallo"');
  if (!fs.existsSync(PRIVATE_KEY)) fail(`clé privée introuvable (${PRIVATE_KEY}). Lancez d'abord : node tools/licence.js init`);
  let text;
  let code;
  try {
    code = normalizeCode(machine);
    const d = new Date();
    const issued = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    text = createLicence({ machine: code, name, expires, issued }, fs.readFileSync(PRIVATE_KEY, 'utf8'));
  } catch (err) {
    fail(err.message);
  }
  const dir = option('dossier') || path.join(ROOT, 'licences');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${code}.licence`);
  fs.writeFileSync(file, `${text}\n`);
  console.log(`Licence créée pour « ${name.trim()} » (ordinateur ${code})${expires ? `, valable jusqu'au ${expires}` : ', sans date de fin'}.`);
  console.log(`Fichier : ${file}`);
  console.log('Copiez ce fichier sur la clé USB du client.');
} else {
  console.log('Commandes :\n  node tools/licence.js init\n  node tools/licence.js creer --machine CODE --nom "Nom du client" [--expire AAAA-MM-JJ] [--dossier chemin]');
  process.exit(command ? 1 : 0);
}
