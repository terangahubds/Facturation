#!/usr/bin/env node
'use strict';
// Vérifie, sur l'application empaquetée, que modifier son code l'empêche de démarrer.
// Usage : node tools/verifier-protection.js <dossier de l'application empaquetée>
// Sous Windows le dossier est dist/win-unpacked. Cette protection n'existe pas sous Linux.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const dir = process.argv[2];
if (!dir) { console.error('Indiquez le dossier de l\'application empaquetée.'); process.exit(2); }
const exe = path.join(dir, process.platform === 'win32' ? 'Facturation.exe' : 'facturation');
const asar = path.join(dir, 'resources', 'app.asar');
const WAIT_MS = 15000;

// Lance l'application et indique si elle tourne encore après quelques secondes.
function staysAlive() {
  return new Promise((resolve) => {
    const child = spawn(exe, process.platform === 'win32' ? [] : ['--no-sandbox'], { stdio: 'ignore' });
    let exited = false;
    child.on('exit', () => { exited = true; });
    child.on('error', () => { exited = true; });
    setTimeout(() => {
      if (!exited) {
        try {
          if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          else child.kill('SIGKILL');
        } catch (err) { /* déjà arrêtée */ }
      }
      setTimeout(() => resolve(!exited), 2000);
    }, WAIT_MS);
  });
}

(async () => {
  const original = fs.readFileSync(asar);
  const marker = 'usable: !enforced';
  const at = original.indexOf(marker);
  if (at === -1) { console.error('Repère introuvable dans app.asar : le test est à mettre à jour.'); process.exit(2); }

  const normal = await staysAlive();
  console.log(`Application d'origine : ${normal ? 'démarre' : 'NE DÉMARRE PAS'}`);

  // Remplace la vérification de licence par « toujours autorisé », sans changer la taille du fichier.
  const patched = Buffer.from(original);
  patched.write('usable: true     ', at);
  fs.writeFileSync(asar, patched);
  let tampered;
  try {
    tampered = await staysAlive();
  } finally {
    fs.writeFileSync(asar, original);
  }
  console.log(`Application au code modifié : ${tampered ? 'DÉMARRE (protection inactive)' : 'refuse de démarrer (protection active)'}`);

  if (!normal) process.exit(2);
  process.exit(tampered ? 1 : 0);
})();
