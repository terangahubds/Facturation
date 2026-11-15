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
// Si elle s'arrête, affiche son code de sortie et ses derniers messages pour le diagnostic.
function staysAlive() {
  return new Promise((resolve) => {
    const args = process.platform === 'win32' ? ['--enable-logging'] : ['--no-sandbox', '--enable-logging'];
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = false;
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('exit', (code, signal) => {
      exited = true;
      console.log(`  arrêt de l'application : code ${code}${signal ? `, signal ${signal}` : ''}`);
      const tail = output.trim().split(/\r?\n/).slice(-12).join('\n  ');
      if (tail) console.log(`  ${tail}`);
    });
    child.on('error', (err) => { exited = true; console.log(`  lancement impossible : ${err.message}`); });
    setTimeout(() => {
      const alive = !exited;
      if (alive) {
        try {
          if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          else child.kill('SIGKILL');
        } catch (err) { /* déjà arrêtée */ }
      }
      setTimeout(() => resolve(alive), 2000);
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
