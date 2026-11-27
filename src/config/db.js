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
  connectTimeout: 4000,
  enableKeepAlive: true,
  // En Vercel la función se congela entre peticiones: las conexiones inactivas se cierran pronto
  // para no reutilizar una que la base ya cortó.
  maxIdle: 1,
  idleTimeout: 30000,
});

// Errores de red pasajeros (la base en la nube tardó en responder o cortó la conexión).
// Se reintenta la operación en lugar de mostrar "Error en el servidor".
const PASAJEROS = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const esPasajero = (err) => PASAJEROS.has(err && err.code);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function conReintentos(fn, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!esPasajero(err) || i >= intentos) throw err;
      console.warn(`Conexión con la base falló (${err.code}); reintento ${i} de ${intentos - 1}`);
      await esperar(400 * i);
    }
  }
}

// query y getConnection reintentan solos ante un error de red pasajero.
// (query no se repite si el error llegó a la mitad de una transacción: esas usan getConnection)
const queryOriginal = pool.query.bind(pool);
const getConnectionOriginal = pool.getConnection.bind(pool);
pool.query = (...args) => conReintentos(() => queryOriginal(...args));
pool.getConnection = () => conReintentos(() => getConnectionOriginal());
pool.esPasajero = esPasajero;

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
