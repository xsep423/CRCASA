const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/registro
// Solo se pueden auto-registrar clientes individuales y mayoristas.
// Vendedores y admins los crea el administrador.
async function registro(req, res) {
  try {
    const { nombre, email, password, telefono, empresa, tipo } = req.body;
    const rol = tipo === 'mayorista' ? 'mayorista' : 'cliente';

    if (!nombre || nombre.trim().length < 3) return res.status(400).json({ error: 'Nombre inválido (mínimo 3 caracteres)' });
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo inválido' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    if (rol === 'mayorista' && !empresa) return res.status(400).json({ error: 'Los clientes mayoristas deben indicar su empresa o escuela' });

    const [existe] = await pool.query('SELECT id_usuario FROM usuarios WHERE email = ?', [email]);
    if (existe.length) return res.status(409).json({ error: 'Ese correo ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash, telefono, empresa, rol) VALUES (?,?,?,?,?,?)',
      [nombre.trim(), email.toLowerCase(), hash, telefono || null, empresa || null, rol]
    );
    res.status(201).json({ mensaje: 'Usuario registrado', id: r.insertId, rol });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });

    const [rows] = await pool.query(
      'SELECT id_usuario, nombre, password_hash, rol, activo FROM usuarios WHERE email = ?',
      [email.toLowerCase()]
    );
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    if (!u.activo) return res.status(403).json({ error: 'Usuario desactivado' });

    const token = jwt.sign(
      { id: u.id_usuario, nombre: u.nombre, rol: u.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );
    res.json({ token, usuario: { id: u.id_usuario, nombre: u.nombre, rol: u.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// GET /api/auth/perfil (requiere token)
function perfil(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = { registro, login, perfil };
