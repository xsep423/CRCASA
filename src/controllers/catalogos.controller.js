// Catálogos sencillos: clasificaciones y proveedores
const pool = require('../config/db');
const { HttpError } = require('../utils/http');

// ---------- CLASIFICACIONES ----------
const clasificaciones = {
  async listar(req, res) {
    const [rows] = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM productos p WHERE p.id_clasificacion = c.id_clasificacion AND p.activo = 1) AS productos
       FROM clasificaciones c ORDER BY nombre`);
    res.json(rows);
  },
  async crear(req, res) {
    const { nombre, descripcion } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    const [r] = await pool.query('INSERT INTO clasificaciones (nombre, descripcion) VALUES (?,?)', [nombre.trim(), descripcion || null]);
    res.status(201).json({ mensaje: 'Clasificación creada', id: r.insertId });
  },
  async actualizar(req, res) {
    const { nombre, descripcion } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    const [r] = await pool.query('UPDATE clasificaciones SET nombre=?, descripcion=? WHERE id_clasificacion=?',
      [nombre.trim(), descripcion || null, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Clasificación no encontrada');
    res.json({ mensaje: 'Clasificación actualizada' });
  },
  async eliminar(req, res) {
    const [r] = await pool.query('DELETE FROM clasificaciones WHERE id_clasificacion = ?', [req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Clasificación no encontrada');
    res.json({ mensaje: 'Clasificación eliminada' });
  },
};

// ---------- PROVEEDORES ----------
function datosProveedor({ nombre, contacto, telefono, email, rfc, direccion }) {
  if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Correo inválido');
  return [nombre.trim(), contacto || null, telefono || null, email || null, rfc ? rfc.toUpperCase() : null, direccion || null];
}

const proveedores = {
  async listar(req, res) {
    const [rows] = await pool.query('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre');
    res.json(rows);
  },
  async crear(req, res) {
    const [r] = await pool.query(
      'INSERT INTO proveedores (nombre, contacto, telefono, email, rfc, direccion) VALUES (?,?,?,?,?,?)',
      datosProveedor(req.body));
    res.status(201).json({ mensaje: 'Proveedor registrado', id: r.insertId });
  },
  async actualizar(req, res) {
    const [r] = await pool.query(
      'UPDATE proveedores SET nombre=?, contacto=?, telefono=?, email=?, rfc=?, direccion=? WHERE id_proveedor=? AND activo = 1',
      [...datosProveedor(req.body), req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Proveedor no encontrado');
    res.json({ mensaje: 'Proveedor actualizado' });
  },
  async eliminar(req, res) {
    const [r] = await pool.query('UPDATE proveedores SET activo = 0 WHERE id_proveedor = ?', [req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Proveedor no encontrado');
    res.json({ mensaje: 'Proveedor dado de baja' });
  },
};

module.exports = { clasificaciones, proveedores };
