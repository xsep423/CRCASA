// Copia Bootstrap y Bootstrap Icons a public/vendor para que Vercel los sirva como archivos estáticos.
// Localmente no hace falta: Express los sirve directo desde node_modules.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const copias = [
  ['node_modules/bootstrap/dist', 'public/vendor/bootstrap'],
  ['node_modules/bootstrap-icons/font', 'public/vendor/icons'],
];
for (const [origen, destino] of copias) {
  fs.rmSync(path.join(raiz, destino), { recursive: true, force: true });
  fs.cpSync(path.join(raiz, origen), path.join(raiz, destino), { recursive: true });
  console.log(`Copiado ${origen} -> ${destino}`);
}
