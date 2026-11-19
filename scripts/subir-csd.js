// Registra en el sandbox de Facturama el Certificado de Sello Digital (CSD) de PRUEBA del emisor.
// Se corre una sola vez. Los CSD de prueba del SAT vienen en el ZIP que publica Facturama:
//   https://cdnfacturama.azureedge.net/content/csd-pruebas.zip
// Uso: npm run subir-csd -- <archivo.cer> <archivo.key> [contraseña] [RFC]
//   por defecto: contraseña 12345678a (la de los certificados de prueba) y RFC EKU9003173C9
// Requiere FACTURAMA_USUARIO y FACTURAMA_PASSWORD en .env (cuenta de sandbox).
require('dotenv').config();
const fs = require('fs');

(async () => {
  const [cer, key, password = '12345678a', rfc = 'EKU9003173C9'] = process.argv.slice(2);
  if (!cer || !key) {
    console.log('Uso: npm run subir-csd -- <archivo.cer> <archivo.key> [contraseña] [RFC]');
    process.exit(1);
  }
  const { FACTURAMA_USUARIO: u, FACTURAMA_PASSWORD: p } = process.env;
  if (!u || !p) throw new Error('Faltan FACTURAMA_USUARIO y FACTURAMA_PASSWORD en .env');
  const url = (process.env.FACTURAMA_URL || 'https://apisandbox.facturama.mx').replace(/\/$/, '');
  const res = await fetch(`${url}/api-lite/csds`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Rfc: rfc,
      Certificate: fs.readFileSync(cer).toString('base64'),
      PrivateKey: fs.readFileSync(key).toString('base64'),
      PrivateKeyPassword: password,
    }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Facturama respondió ${res.status}: ${texto}`);
  console.log(`CSD de ${rfc} registrado en el sandbox. Ya se pueden timbrar CFDI de prueba.`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
