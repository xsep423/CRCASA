// COMPRAS: mercancía que entra de un PROVEEDOR -> suma existencia y actualiza el costo.
const pool = require('../config/db');
const { HttpError, redondear } = require('../utils/http');
const { pid } = require('../middleware/auth');
const { siguienteFolio, movimiento, bitacora } = require('../services/registro');

// GET /api/compras
async function listar(req, res) {
  const [rows] = await pool.query(
    `SELECT co.id_compra, co.folio, co.fecha, co.folio_proveedor, co.total, pr.nombre AS proveedor, u.nombre AS registro,
            (SELECT COUNT(*) FROM detalle_compra d WHERE d.id_compra = co.id_compra) AS productos
     FROM compras co
     JOIN proveedores pr ON pr.id_proveedor = co.id_proveedor
     JOIN usuarios u ON u.id_usuario = co.id_usuario
     WHERE co.id_papeleria = ?
     ORDER BY co.id_compra DESC LIMIT 200`, [pid(req)]);
  res.json(rows);
}

// GET /api/compras/:id
async function obtener(req, res) {
  const [cab] = await pool.query(
    `SELECT co.*, pr.nombre AS proveedor, u.nombre AS registro FROM compras co
     JOIN proveedores pr ON pr.id_proveedor = co.id_proveedor
     JOIN usuarios u ON u.id_usuario = co.id_usuario WHERE co.id_compra = ? AND co.id_papeleria = ?`, [req.params.id, pid(req)]);
  if (!cab.length) throw new HttpError(404, 'Compra no encontrada');
  const [partidas] = await pool.query(
    `SELECT d.id_producto, p.codigo, p.nombre, d.cantidad, d.costo_unitario, d.importe
     FROM detalle_compra d JOIN productos p ON p.id_producto = d.id_producto WHERE d.id_compra = ?`, [req.params.id]);
  res.json({ ...cab[0], partidas });
}

// POST /api/compras  { id_proveedor, folio_proveedor?, partidas:[{id_producto, cantidad, costo_unitario}] }
async function crear(req, res) {
  const { id_proveedor, folio_proveedor, partidas } = req.body;
  if (!id_proveedor) throw new HttpError(400, 'Selecciona el proveedor');
  if (!Array.isArray(partidas) || !partidas.length) throw new HttpError(400, 'Agrega al menos un producto');
  const lineas = partidas.map((p) => {
    const cantidad = Number(p.cantidad);
    const costo = Number(p.costo_unitario);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new HttpError(400, 'La cantidad debe ser un entero mayor a 0');
    if (isNaN(costo) || costo < 0) throw new HttpError(400, 'Costo unitario inválido');
    return { id_producto: Number(p.id_producto), cantidad, costo, importe: redondear(cantidad * costo) };
  });
  const total = redondear(lineas.reduce((s, l) => s + l.importe, 0));

  const id = await pool.transaccion(async (conn) => {
    const [prov] = await conn.query('SELECT id_proveedor FROM proveedores WHERE id_proveedor = ? AND id_papeleria = ? AND activo = 1',
      [id_proveedor, pid(req)]);
    if (!prov.length) throw new HttpError(400, 'El proveedor no existe');
    const folio = await siguienteFolio(conn, pid(req), 'compra');
    const [r] = await conn.query(
      'INSERT INTO compras (id_papeleria, folio, id_proveedor, id_usuario, folio_proveedor, total) VALUES (?,?,?,?,?,?)',
      [pid(req), folio, id_proveedor, req.usuario.id, folio_proveedor || null, total]);
    for (const l of lineas) {
      const [u] = await conn.query(
        'UPDATE productos SET existencia = existencia + ?, costo = ? WHERE id_producto = ? AND id_papeleria = ? AND activo = 1',
        [l.cantidad, l.costo, l.id_producto, pid(req)]);
      if (!u.affectedRows) throw new HttpError(400, `El producto ${l.id_producto} no existe`);
      await movimiento(conn, { idPapeleria: pid(req), idProducto: l.id_producto, tipo: 'compra', cantidad: l.cantidad,
        referencia: `Compra ${folio}`, idUsuario: req.usuario.id });
      await conn.query(
        'INSERT INTO detalle_compra (id_compra, id_producto, cantidad, costo_unitario, importe) VALUES (?,?,?,?,?)',
        [r.insertId, l.id_producto, l.cantidad, l.costo, l.importe]);
    }
    await bitacora(req.usuario, 'Registrar compra', `Compra ${folio} · total ${total}`, { conn });
    return r.insertId;
  });
  res.status(201).json({ mensaje: 'Compra registrada; existencia actualizada', id_compra: id });
}

// GET /api/compras/sugerencia — productos en o debajo de su existencia mínima, agrupables por proveedor.
// Cantidad sugerida: lo necesario para llegar al doble de la existencia mínima.
async function sugerencia(req, res) {
  const [rows] = await pool.query(
    `SELECT p.id_producto, p.codigo, p.nombre, p.existencia, p.existencia_minima, p.costo,
            GREATEST(p.existencia_minima * 2 - p.existencia, 1) AS sugerido,
            p.id_proveedor, COALESCE(pr.nombre, 'Sin proveedor asignado') AS proveedor
     FROM productos p LEFT JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
     WHERE p.id_papeleria = ? AND p.activo = 1 AND p.existencia <= p.existencia_minima
     ORDER BY proveedor, p.nombre`, [pid(req)]);
  res.json(rows);
}

module.exports = { listar, obtener, crear, sugerencia };
