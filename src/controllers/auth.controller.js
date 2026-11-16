const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { HttpError } = require('../utils/http');

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

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.usuario, u.password_hash, u.rol, u.activo, u.id_papeleria,
            p.nombre AS papeleria, p.activo AS papeleria_activa
     FROM usuarios u LEFT JOIN papelerias p ON p.id_papeleria = u.id_papeleria
     WHERE u.usuario = ?`,
    [String(usuario).trim().toLowerCase()]
  );
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
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

// GET /api/auth/perfil
function perfil(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = { login, cambiarPapeleria, perfil };
