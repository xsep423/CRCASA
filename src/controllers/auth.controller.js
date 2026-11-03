const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { HttpError } = require('../utils/http');

// POST /api/auth/login  { usuario, password }
// Solo empleados. No hay registro público: los usuarios los crea soporte técnico.
async function login(req, res) {
  const { usuario, password } = req.body;
  if (!usuario || !password) throw new HttpError(400, 'Usuario y contraseña son obligatorios');

  const [rows] = await pool.query(
    'SELECT id_usuario, nombre, usuario, password_hash, rol, activo FROM usuarios WHERE usuario = ?',
    [String(usuario).trim().toLowerCase()]
  );
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  if (!u.activo) throw new HttpError(403, 'Usuario desactivado');

  const token = jwt.sign(
    { id: u.id_usuario, nombre: u.nombre, rol: u.rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '8h' }
  );
  res.json({ token, usuario: { id: u.id_usuario, nombre: u.nombre, usuario: u.usuario, rol: u.rol } });
}

// GET /api/auth/perfil
function perfil(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = { login, perfil };
