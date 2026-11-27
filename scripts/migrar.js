// Aplica las migraciones pendientes sobre la base configurada en .env (local o TiDB Cloud) SIN borrar datos.
// Cada migración revisa primero si ya estaba aplicada, así que se puede correr las veces que sea.
// Uso: npm run migrar
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const columna = (tabla, col) => `SELECT COUNT(*) AS n FROM information_schema.columns
  WHERE table_schema = 'papeleria_crcasa' AND table_name = '${tabla}' AND column_name = '${col}'`;

const MIGRACIONES = [
  { archivo: 'migracion-u5.sql', descripcion: 'timbrado de prueba de CFDI', aplicada: columna('solicitudes_factura', 'estado_cfdi') },
  { archivo: 'migracion-caja.sql', descripcion: 'apertura de caja y movimientos de efectivo', aplicada: columna('ventas', 'id_turno') },
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  });
  for (const m of MIGRACIONES) {
    const [[r]] = await conn.query(m.aplicada);
    if (r.n) { console.log(`Ya aplicada: ${m.archivo} (${m.descripcion})`); continue; }
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'database', m.archivo), 'utf8'));
    console.log(`Aplicada: ${m.archivo} (${m.descripcion})`);
  }
  await conn.end();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
