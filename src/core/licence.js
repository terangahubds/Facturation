'use strict';
// Licence hors ligne. Chaque ordinateur a un « code machine ». Le vendeur signe une licence
// pour ce code avec sa clé privée ; l'application vérifie la signature avec la clé publique
// qu'elle embarque. Sans la clé privée, personne ne peut fabriquer une licence valide.

const crypto = require('node:crypto');

const PREFIX = 'FACT1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // sans I, L, O, U : pas de confusion à la lecture

// Code machine lisible (XXXX-XXXX-XXXX-XXXX) calculé à partir de l'identifiant de l'ordinateur.
function machineCode(rawId) {
  const hash = crypto.createHash('sha256').update(`facturation:${String(rawId).trim().toLowerCase()}`).digest();
  let bits = '';
  for (const byte of hash.subarray(0, 10)) bits += byte.toString(2).padStart(8, '0');
  let code = '';
  for (let i = 0; i < 80; i += 5) code += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return code.match(/.{4}/g).join('-');
}

// Accepte une saisie approximative du code : minuscules, espaces, lettres ambiguës.
function normalizeCode(text) {
  const clean = String(text).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  if (clean.length !== 16 || [...clean].some((c) => !ALPHABET.includes(c))) throw new Error('Le code machine doit compter 16 caractères.');
  return clean.match(/.{4}/g).join('-');
}

const encode = (buffer) => Buffer.from(buffer).toString('base64url');

// Côté vendeur : fabrique le texte de la licence.
function createLicence({ machine, name, expires = null, issued }, privateKeyPem) {
  if (!name || !String(name).trim()) throw new Error('Le nom du titulaire est obligatoire.');
  if (expires !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error('La date d’expiration doit être au format AAAA-MM-JJ.');
  const payload = encode(JSON.stringify({ v: 1, machine: normalizeCode(machine), name: String(name).trim(), issued, expires }));
  const signature = crypto.sign(null, Buffer.from(`${PREFIX}.${payload}`), privateKeyPem);
  return `${PREFIX}.${payload}.${encode(signature)}`;
}

// Côté application : vérifie une licence pour cet ordinateur.
// Renvoie { status: 'valide' | 'absente' | 'invalide' | 'autre_machine' | 'expiree', ... }.
function checkLicence(text, code, publicKeyPem, today) {
  const clean = String(text || '').replace(/\s+/g, '');
  if (!clean) return { status: 'absente', message: 'Aucune licence n’est installée sur cet ordinateur.' };
  const invalid = { status: 'invalide', message: 'Cette licence n’est pas valide. Vérifiez que le fichier ou le texte est complet.' };
  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return invalid;
  let payload;
  try {
    const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKeyPem, Buffer.from(parts[2], 'base64url'));
    if (!ok) return invalid;
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    return invalid;
  }
  const details = { name: payload.name, expires: payload.expires || null, issued: payload.issued || null };
  if (payload.machine !== code) {
    return { status: 'autre_machine', message: 'Cette licence a été créée pour un autre ordinateur.', ...details };
  }
  if (payload.expires && payload.expires < today) {
    return { status: 'expiree', message: `Cette licence a expiré le ${payload.expires.split('-').reverse().join('/')}.`, ...details };
  }
  return { status: 'valide', message: '', ...details };
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

module.exports = { machineCode, normalizeCode, createLicence, checkLicence, generateKeyPair };
