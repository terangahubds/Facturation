'use strict';
// Identifiant stable de l'ordinateur, utilisé pour calculer le code machine de la licence.

const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function rawMachineId() {
  if (process.env.FACTURATION_MACHINE_ID) return process.env.FACTURATION_MACHINE_ID; // tests automatiques
  if (process.platform === 'win32') {
    // Identifiant créé par Windows à l'installation du système.
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (match) return match[1];
    } catch (err) { /* on passe à la solution de repli */ }
  } else {
    try {
      const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (id) return id;
    } catch (err) { /* on passe à la solution de repli */ }
  }
  // Repli : nom de l'ordinateur, processeur et adresses des cartes réseau.
  const macs = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map((n) => n.mac).sort();
  return [os.hostname(), os.cpus()[0] ? os.cpus()[0].model : '', ...new Set(macs)].join('|');
}

module.exports = { rawMachineId };
