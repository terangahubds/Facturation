'use strict';
// Couleurs proposées pour l'interface et les documents. Chaque thème donne la couleur principale,
// une variante plus sombre pour le texte et une variante très claire pour les fonds.
const THEMES = {
  vert: { label: 'Vert', accent: '#0E6B5B', ink: '#0B5A4C', tint: '#E3F1EE' },
  bleu: { label: 'Bleu', accent: '#1B4FA8', ink: '#163F87', tint: '#E6EDFC' },
  bordeaux: { label: 'Bordeaux', accent: '#8A1F3D', ink: '#6F1831', tint: '#F8E6EB' },
  orange: { label: 'Orange', accent: '#A8480A', ink: '#8A3A07', tint: '#FCEBDD' },
  violet: { label: 'Violet', accent: '#5B2E91', ink: '#482374', tint: '#EEE6F8' },
  anthracite: { label: 'Anthracite', accent: '#2F3747', ink: '#1F2530', tint: '#ECEEF2' },
};

const themeOf = (key) => THEMES[key] || THEMES.vert;

// Un logo est enregistré sous forme d'image intégrée (PNG ou JPEG) ; tout autre contenu est refusé.
const LOGO_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LOGO_BYTES = 1024 * 1024;

// Transforme le contenu d'un fichier image en logo enregistrable, après vérification.
function logoFromFile(buffer) {
  if (buffer.length > MAX_LOGO_BYTES) throw new Error('Ce logo est trop lourd. Choisissez une image de moins de 1 Mo.');
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) throw new Error('Choisissez une image au format PNG ou JPEG.');
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,${buffer.toString('base64')}`;
}

const isValidLogo = (value) => typeof value === 'string' && LOGO_PATTERN.test(value);

module.exports = { THEMES, themeOf, logoFromFile, isValidLogo };
