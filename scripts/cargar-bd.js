// Crea la base de datos y carga los datos de prueba en el servidor configurado en .env
// (local o TiDB Cloud). BORRA la base papeleria_crcasa si ya existe.
// Uso: npm run cargar-bd            -> esquema + datos de prueba
//      npm run cargar-bd -- --solo-esquema
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
  const archivos = process.argv.includes('--solo-esquema') ? ['schema.sql'] : ['schema.sql', 'seed.sql'];
  for (const a of archivos) {
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'database', a), 'utf8'));
    console.log(`Cargado database/${a}`);
  }
  const [p] = await conn.query('SELECT id_papeleria, nombre FROM papeleria_crcasa.papelerias');
  console.log('Papelerías:', p.map((x) => `${x.id_papeleria}. ${x.nombre}`).join(' | ') || 'ninguna');
  await conn.end();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
