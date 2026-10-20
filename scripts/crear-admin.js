// Crea (o actualiza) el usuario administrador inicial.
// Uso: npm run crear-admin -- admin@crcasa.test MiPassword123 "Nombre Admin"
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

(async () => {
  const [email, password, nombre = 'Administrador'] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.log('Uso: npm run crear-admin -- <email> <password (mín. 8)> ["Nombre"]');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?, 'admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = 'admin'`,
    [nombre, email.toLowerCase(), hash]
  );
  console.log(`Administrador listo: ${email}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
