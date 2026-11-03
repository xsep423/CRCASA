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
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL llega como número y no como texto
  dateStrings: true,
});

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
