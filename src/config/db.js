const mysql = require('mysql2/promise');
require('dotenv').config();

// Pool de conexiones reutilizable en toda la app
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 5), // en Vercel cada función abre pocas conexiones
  // TiDB Cloud (y la mayoría de bases en la nube) exigen conexión cifrada
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  decimalNumbers: true, // DECIMAL llega como número y no como texto
  dateStrings: true,
});

// Las bases en la nube trabajan en UTC: se fija la zona horaria para que "ventas de hoy"
// y las fechas de vigencia correspondan a la hora local de las papelerías.
if (process.env.DB_TIME_ZONE) {
  pool.on('connection', (conn) => conn.query('SET time_zone = ?', [process.env.DB_TIME_ZONE]));
}

// Ejecuta fn dentro de una transacción: si algo falla, no se guarda nada a medias
pool.transaccion = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = pool;
