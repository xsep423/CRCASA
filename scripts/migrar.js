// Aplica database/migracion-u5.sql sobre la base configurada en .env (local o TiDB Cloud) SIN borrar datos.
// Uso: npm run migrar
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  });
  const [cols] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = 'papeleria_crcasa' AND table_name = 'solicitudes_factura' AND column_name = 'estado_cfdi'");
  if (cols[0].n) {
    console.log('La migración ya estaba aplicada; no se hizo nada.');
  } else {
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'migracion-u5.sql'), 'utf8'));
    console.log('Migración aplicada: columnas de timbrado y cliente de prueba C-PRUEBA en cada papelería.');
  }
  await conn.end();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
