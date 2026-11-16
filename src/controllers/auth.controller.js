const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { bitacora } = require('../services/registro');

// Protección contra fuerza bruta (se guarda en la BD porque en Vercel no hay memoria compartida)
const MAX_POR_USUARIO = 5;   // intentos fallidos seguidos por usuario
const MAX_POR_IP = 20;       // intentos fallidos desde la misma IP
const MINUTOS_BLOQUEO = 15;

const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 45);

async function revisarBloqueo(usuario, ip) {
  const [[u]] = await pool.query(
    `SELECT COUNT(*) AS fallos FROM intentos_login
     WHERE usuario = ? AND exito = 0 AND fecha > DATE_SUB(NOW(), INTERVAL ? MINUTE)
       AND id_intento > COALESCE((SELECT MAX(id_intento) FROM intentos_login WHERE usuario = ? AND exito = 1), 0)`,
    [usuario, MINUTOS_BLOQUEO, usuario]);
  const [[i]] = await pool.query(
    'SELECT COUNT(*) AS fallos FROM intentos_login WHERE ip = ? AND exito = 0 AND fecha > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
    [ip, MINUTOS_BLOQUEO]);
  if (u.fallos >= MAX_POR_USUARIO || i.fallos >= MAX_POR_IP) {
    throw new HttpError(429, `Demasiados intentos fallidos. Espera ${MINUTOS_BLOQUEO} minutos e intenta de nuevo.`);
  }
}

const registrarIntento = (usuario, ip, exito) =>
  pool.query('INSERT INTO intentos_login (usuario, ip, exito) VALUES (?,?,?)', [usuario, ip, exito ? 1 : 0]);

function emitir(u, pap) {
  const datos = {
    id: u.id_usuario, nombre: u.nombre, usuario: u.usuario, rol: u.rol,
    id_papeleria: pap ? pap.id_papeleria : null, papeleria: pap ? pap.nombre : null,
  };
  const token = jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
  return { token, usuario: datos };
}

// POST /api/auth/login  { usuario, password }
// Solo empleados. No hay registro público: los usuarios los crea soporte técnico.
// El token lleva la papelería del empleado; todas las consultas se filtran con ella.
async function login(req, res) {
  const { usuario, password } = req.body;
  if (!usuario || !password) throw new HttpError(400, 'Usuario y contraseña son obligatorios');
  const nombreUsuario = String(usuario).trim().toLowerCase().slice(0, 40);
  const ip = ipDe(req);
  await revisarBloqueo(nombreUsuario, ip);

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.usuario, u.password_hash, u.rol, u.activo, u.id_papeleria,
            p.nombre AS papeleria, p.activo AS papeleria_activa
     FROM usuarios u LEFT JOIN papelerias p ON p.id_papeleria = u.id_papeleria
     WHERE u.usuario = ?`,
    [nombreUsuario]
  );
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    await registrarIntento(nombreUsuario, ip, false);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  await registrarIntento(nombreUsuario, ip, true);
  if (!u.activo) throw new HttpError(403, 'Usuario desactivado');
  if (u.rol !== 'soporte' && !u.papeleria_activa) throw new HttpError(403, 'La papelería de este usuario está dada de baja');

  let pap = u.id_papeleria ? { id_papeleria: u.id_papeleria, nombre: u.papeleria } : null;
  if (u.rol === 'soporte' && !pap) {
    // Soporte entra a la primera papelería activa; después puede cambiar desde el menú
    const [p] = await pool.query('SELECT id_papeleria, nombre FROM papelerias WHERE activo = 1 ORDER BY id_papeleria LIMIT 1');
    pap = p[0] || null;
  }
  res.json(emitir(u, pap));
}

// POST /api/auth/papeleria  { id_papeleria } — solo soporte: cambia la papelería con la que trabaja
async function cambiarPapeleria(req, res) {
  const [p] = await pool.query('SELECT id_papeleria, nombre FROM papelerias WHERE id_papeleria = ? AND activo = 1',
    [req.body.id_papeleria]);
  if (!p.length) throw new HttpError(404, 'Papelería no encontrada');
  const [u] = await pool.query('SELECT id_usuario, nombre, usuario, rol FROM usuarios WHERE id_usuario = ?', [req.usuario.id]);
  res.json(emitir(u[0], p[0]));
}

// POST /api/auth/password  { actual, nueva } — cada empleado cambia su propia contraseña
async function cambiarPassword(req, res) {
  const { actual, nueva } = req.body;
  if (!actual || !nueva) throw new HttpError(400, 'Escribe tu contraseña actual y la nueva');
  if (String(nueva).length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  if (actual === nueva) throw new HttpError(400, 'La nueva contraseña debe ser distinta a la actual');
  const [[u]] = await pool.query('SELECT password_hash FROM usuarios WHERE id_usuario = ?', [req.usuario.id]);
  if (!u || !(await bcrypt.compare(actual, u.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta');
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id_usuario = ?', [await bcrypt.hash(nueva, 10), req.usuario.id]);
  await bitacora(req.usuario, 'Cambiar contraseña', 'El empleado cambió su propia contraseña');
  res.json({ mensaje: 'Contraseña actualizada' });
}

// GET /api/auth/perfil
function perfil(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = { login, cambiarPapeleria, cambiarPassword, perfil };
