const pool = require('../config/db');

// GET /api/productos?clasificacion=1&buscar=cuaderno  (público)
async function listar(req, res) {
  try {
    const { clasificacion, buscar } = req.query;
    let sql = `SELECT p.id_producto, p.nombre, p.descripcion, p.precio, p.stock, p.imagen_url,
                      c.id_clasificacion, c.nombre AS clasificacion
               FROM productos p
               JOIN clasificaciones c ON c.id_clasificacion = p.id_clasificacion
               WHERE p.activo = 1`;
    const params = [];
    if (clasificacion) { sql += ' AND p.id_clasificacion = ?'; params.push(clasificacion); }
    if (buscar) { sql += ' AND p.nombre LIKE ?'; params.push(`%${buscar}%`); }
    sql += ' ORDER BY p.nombre';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
}

// GET /api/productos/:id  (público)
async function obtener(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, c.nombre AS clasificacion, pr.nombre AS proveedor
       FROM productos p
       JOIN clasificaciones c ON c.id_clasificacion = p.id_clasificacion
       LEFT JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
       WHERE p.id_producto = ? AND p.activo = 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
}

function validar(body) {
  const { nombre, precio, stock, id_clasificacion } = body;
  if (!nombre || nombre.trim().length < 3) return 'Nombre inválido';
  if (precio === undefined || isNaN(precio) || Number(precio) < 0) return 'Precio inválido';
  if (stock !== undefined && (!Number.isInteger(Number(stock)) || Number(stock) < 0)) return 'Stock inválido';
  if (!id_clasificacion) return 'La clasificación es obligatoria';
  return null;
}

// POST /api/productos  (admin)
async function crear(req, res) {
  const error = validar(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, descripcion, precio, stock = 0, imagen_url, id_clasificacion, id_proveedor } = req.body;
    const [r] = await pool.query(
      `INSERT INTO productos (nombre, descripcion, precio, stock, imagen_url, id_clasificacion, id_proveedor)
       VALUES (?,?,?,?,?,?,?)`,
      [nombre.trim(), descripcion || null, precio, stock, imagen_url || null, id_clasificacion, id_proveedor || null]
    );
    res.status(201).json({ mensaje: 'Producto creado', id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
}

// PUT /api/productos/:id  (admin)
async function actualizar(req, res) {
  const error = validar(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre, descripcion, precio, stock = 0, imagen_url, id_clasificacion, id_proveedor } = req.body;
    const [r] = await pool.query(
      `UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, imagen_url=?, id_clasificacion=?, id_proveedor=?
       WHERE id_producto = ?`,
      [nombre.trim(), descripcion || null, precio, stock, imagen_url || null, id_clasificacion, id_proveedor || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ mensaje: 'Producto actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
}

// DELETE /api/productos/:id  (admin) — baja lógica para no romper ventas pasadas
async function eliminar(req, res) {
  try {
    const [r] = await pool.query('UPDATE productos SET activo = 0 WHERE id_producto = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ mensaje: 'Producto dado de baja' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
