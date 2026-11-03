const pool = require('../config/db');
const { HttpError } = require('../utils/http');

const SELECT = `SELECT p.id_producto, p.codigo, p.nombre, p.descripcion, p.precio_venta, p.costo,
                       p.existencia, p.existencia_minima, p.id_clasificacion, c.nombre AS clasificacion,
                       p.id_proveedor, pr.nombre AS proveedor
                FROM productos p
                JOIN clasificaciones c ON c.id_clasificacion = p.id_clasificacion
                LEFT JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
                WHERE p.activo = 1`;

// GET /api/productos?buscar=&clasificacion=&bajo_minimo=1
// "buscar" coincide con código o nombre, para que el capturista teclee lo que tenga a la mano.
async function listar(req, res) {
  const { buscar, clasificacion, bajo_minimo } = req.query;
  let sql = SELECT;
  const params = [];
  if (buscar) { sql += ' AND (p.codigo LIKE ? OR p.nombre LIKE ?)'; params.push(`${buscar}%`, `%${buscar}%`); }
  if (clasificacion) { sql += ' AND p.id_clasificacion = ?'; params.push(clasificacion); }
  if (bajo_minimo) sql += ' AND p.existencia <= p.existencia_minima';
  sql += ' ORDER BY p.nombre LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

// GET /api/productos/codigo/:codigo  (lector de código de barras o tecleado)
async function porCodigo(req, res) {
  const [rows] = await pool.query(`${SELECT} AND p.codigo = ?`, [req.params.codigo.trim().toUpperCase()]);
  if (!rows.length) throw new HttpError(404, 'No existe un producto con ese código');
  res.json(rows[0]);
}

async function obtener(req, res) {
  const [rows] = await pool.query(`${SELECT} AND p.id_producto = ?`, [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Producto no encontrado');
  res.json(rows[0]);
}

function datos(body) {
  const { codigo, nombre, descripcion, precio_venta, costo = 0, existencia_minima = 0, id_clasificacion, id_proveedor } = body;
  if (!codigo || !String(codigo).trim()) throw new HttpError(400, 'El código es obligatorio');
  if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido (mínimo 3 caracteres)');
  if (precio_venta === undefined || isNaN(precio_venta) || Number(precio_venta) < 0) throw new HttpError(400, 'Precio de venta inválido');
  if (isNaN(costo) || Number(costo) < 0) throw new HttpError(400, 'Costo inválido');
  if (!Number.isInteger(Number(existencia_minima)) || Number(existencia_minima) < 0) throw new HttpError(400, 'Existencia mínima inválida');
  if (!id_clasificacion) throw new HttpError(400, 'La clasificación es obligatoria');
  return [String(codigo).trim().toUpperCase(), nombre.trim(), descripcion || null, precio_venta, costo,
    existencia_minima, id_clasificacion, id_proveedor || null];
}

// POST /api/productos (admin)
// La existencia inicial se captura solo al crear; después cambia únicamente con ventas y compras.
async function crear(req, res) {
  const valores = datos(req.body);
  const existencia = Number(req.body.existencia || 0);
  if (!Number.isInteger(existencia) || existencia < 0) throw new HttpError(400, 'Existencia inicial inválida');
  const [r] = await pool.query(
    `INSERT INTO productos (codigo, nombre, descripcion, precio_venta, costo, existencia_minima,
                            id_clasificacion, id_proveedor, existencia)
     VALUES (?,?,?,?,?,?,?,?,?)`, [...valores, existencia]);
  res.status(201).json({ mensaje: 'Producto creado', id: r.insertId });
}

// PUT /api/productos/:id (admin) — no modifica existencia
async function actualizar(req, res) {
  const [r] = await pool.query(
    `UPDATE productos SET codigo=?, nombre=?, descripcion=?, precio_venta=?, costo=?, existencia_minima=?,
            id_clasificacion=?, id_proveedor=?
     WHERE id_producto = ? AND activo = 1`, [...datos(req.body), req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Producto no encontrado');
  res.json({ mensaje: 'Producto actualizado' });
}

// DELETE /api/productos/:id (admin) — baja lógica para no romper ventas pasadas
async function eliminar(req, res) {
  const [r] = await pool.query('UPDATE productos SET activo = 0 WHERE id_producto = ?', [req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Producto no encontrado');
  res.json({ mensaje: 'Producto dado de baja' });
}

module.exports = { listar, porCodigo, obtener, crear, actualizar, eliminar };
