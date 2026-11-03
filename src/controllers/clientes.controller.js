const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { esAdmin } = require('../middleware/auth');

const CAMPOS = 'id_cliente, codigo, nombre, telefono, email, rfc, direccion, porcentaje_descuento';

// GET /api/clientes?buscar=
async function listar(req, res) {
  const { buscar } = req.query;
  let sql = `SELECT ${CAMPOS} FROM clientes WHERE activo = 1`;
  const params = [];
  if (buscar) { sql += ' AND (codigo LIKE ? OR nombre LIKE ? OR telefono LIKE ?)'; params.push(`${buscar}%`, `%${buscar}%`, `${buscar}%`); }
  sql += ' ORDER BY (codigo = "PG") DESC, nombre LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

// GET /api/clientes/codigo/:codigo — lo usa la pantalla de captura para traer el descuento
async function porCodigo(req, res) {
  const [rows] = await pool.query(`SELECT ${CAMPOS} FROM clientes WHERE activo = 1 AND codigo = ?`,
    [req.params.codigo.trim().toUpperCase()]);
  if (!rows.length) throw new HttpError(404, 'No existe un cliente con ese código');
  res.json(rows[0]);
}

async function obtener(req, res) {
  const [rows] = await pool.query(`SELECT ${CAMPOS} FROM clientes WHERE id_cliente = ? AND activo = 1`, [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Cliente no encontrado');
  res.json(rows[0]);
}

function validar(body) {
  const { nombre, email, rfc, porcentaje_descuento } = body;
  if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido (mínimo 3 caracteres)');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Correo inválido');
  if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc)) throw new HttpError(400, 'RFC inválido (12 o 13 caracteres)');
  if (porcentaje_descuento !== undefined) {
    const p = Number(porcentaje_descuento);
    if (isNaN(p) || p < 0 || p > 100) throw new HttpError(400, 'El descuento debe estar entre 0 y 100');
  }
}

// Código automático C-0001, C-0002... si no se captura uno
async function siguienteCodigo() {
  const [rows] = await pool.query(
    "SELECT MAX(CAST(SUBSTRING(codigo, 3) AS UNSIGNED)) AS n FROM clientes WHERE codigo REGEXP '^C-[0-9]+$'");
  return `C-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

// POST /api/clientes
// El capturista puede dar de alta clientes; solo el administrador asigna el % de descuento.
async function crear(req, res) {
  validar(req.body);
  const { nombre, telefono, email, rfc, direccion } = req.body;
  const codigo = req.body.codigo ? String(req.body.codigo).trim().toUpperCase() : await siguienteCodigo();
  const pct = esAdmin(req.usuario) ? Number(req.body.porcentaje_descuento || 0) : 0;
  const [r] = await pool.query(
    `INSERT INTO clientes (codigo, nombre, telefono, email, rfc, direccion, porcentaje_descuento)
     VALUES (?,?,?,?,?,?,?)`,
    [codigo, nombre.trim(), telefono || null, email || null, rfc ? rfc.toUpperCase() : null, direccion || null, pct]);
  res.status(201).json({ mensaje: 'Cliente registrado', id: r.insertId, codigo });
}

// PUT /api/clientes/:id
async function actualizar(req, res) {
  validar(req.body);
  const { nombre, telefono, email, rfc, direccion, porcentaje_descuento } = req.body;
  const [actual] = await pool.query('SELECT codigo, porcentaje_descuento FROM clientes WHERE id_cliente = ? AND activo = 1', [req.params.id]);
  if (!actual.length) throw new HttpError(404, 'Cliente no encontrado');
  if (actual[0].codigo === 'PG') throw new HttpError(400, 'El cliente "Público en general" no se modifica');

  // Si no es administrador, conserva el descuento que ya tenía
  const pct = esAdmin(req.usuario) && porcentaje_descuento !== undefined
    ? Number(porcentaje_descuento) : actual[0].porcentaje_descuento;
  await pool.query(
    `UPDATE clientes SET nombre=?, telefono=?, email=?, rfc=?, direccion=?, porcentaje_descuento=?
     WHERE id_cliente = ?`,
    [nombre.trim(), telefono || null, email || null, rfc ? rfc.toUpperCase() : null, direccion || null, pct, req.params.id]);
  res.json({ mensaje: 'Cliente actualizado' });
}

// DELETE /api/clientes/:id (admin) — baja lógica
async function eliminar(req, res) {
  const [r] = await pool.query("UPDATE clientes SET activo = 0 WHERE id_cliente = ? AND codigo <> 'PG'", [req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Cliente no encontrado');
  res.json({ mensaje: 'Cliente dado de baja' });
}

module.exports = { listar, porCodigo, obtener, crear, actualizar, eliminar };
