// REPORTES del administrador: ventas por rango de fechas y bitácora de acciones.
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { pid } = require('../middleware/auth');

// Cómo se agrupan las ventas. En clasificación y producto el importe ya lleva aplicado el descuento de la venta.
const AGRUPACIONES = {
  dia: { grupo: "DATE_FORMAT(v.fecha, '%Y-%m-%d')", orden: 'grupo', detalle: false },
  empleado: { grupo: 'u.nombre', orden: 'total DESC', detalle: false },
  metodo: { grupo: 'v.metodo_pago', orden: 'total DESC', detalle: false },
  clasificacion: { grupo: 'cl.nombre', orden: 'total DESC', detalle: true },
  producto: { grupo: "CONCAT(p.codigo, ' · ', p.nombre)", orden: 'total DESC', detalle: true },
};

function rango(q) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = q.desde && re.test(q.desde) ? q.desde : `${hoy.slice(0, 8)}01`;
  const hasta = q.hasta && re.test(q.hasta) ? q.hasta : hoy;
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial no puede ser mayor que la final');
  return { desde, hasta };
}

// GET /api/reportes/ventas?desde=&hasta=&agrupar=dia|empleado|metodo|clasificacion|producto
async function ventas(req, res) {
  const { desde, hasta } = rango(req.query);
  const agrupar = AGRUPACIONES[req.query.agrupar] ? req.query.agrupar : 'dia';
  const a = AGRUPACIONES[agrupar];
  const filtro = "v.id_papeleria = ? AND v.estado <> 'cancelada' AND DATE(v.fecha) BETWEEN ? AND ?";
  const params = [pid(req), desde, hasta];

  const [[resumen]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(v.subtotal),0) AS subtotal, COALESCE(SUM(v.descuento),0) AS descuentos,
            COALESCE(SUM(v.total),0) AS total
     FROM ventas v WHERE ${filtro}`, params);
  const [[canc]] = await pool.query(
    `SELECT COUNT(*) AS canceladas FROM ventas v
     WHERE v.id_papeleria = ? AND v.estado = 'cancelada' AND DATE(v.fecha) BETWEEN ? AND ?`, params);

  const sql = a.detalle
    ? `SELECT ${a.grupo} AS grupo, COUNT(DISTINCT v.id_venta) AS ventas, SUM(d.cantidad) AS piezas,
              ROUND(SUM(d.importe * (1 - v.porcentaje_descuento / 100)), 2) AS total
       FROM detalle_venta d JOIN ventas v ON v.id_venta = d.id_venta
       JOIN productos p ON p.id_producto = d.id_producto
       JOIN clasificaciones cl ON cl.id_clasificacion = p.id_clasificacion
       WHERE ${filtro} GROUP BY ${a.grupo} ORDER BY ${a.orden}`
    : `SELECT ${a.grupo} AS grupo, COUNT(*) AS ventas, SUM(pz.piezas) AS piezas, ROUND(SUM(v.total), 2) AS total
       FROM ventas v JOIN usuarios u ON u.id_usuario = v.id_usuario
       JOIN (SELECT id_venta, SUM(cantidad) AS piezas FROM detalle_venta GROUP BY id_venta) pz ON pz.id_venta = v.id_venta
       WHERE ${filtro} GROUP BY ${a.grupo} ORDER BY ${a.orden}`;
  const [filas] = await pool.query(sql, params);
  res.json({ desde, hasta, agrupar, resumen: { ...resumen, canceladas: canc.canceladas }, filas });
}

// GET /api/bitacora?desde=&hasta=&buscar=
async function bitacora(req, res) {
  const { desde, hasta } = rango(req.query);
  const params = [pid(req), desde, hasta];
  let sql = `SELECT b.fecha, b.accion, b.detalle, u.nombre AS usuario, u.rol
             FROM bitacora b LEFT JOIN usuarios u ON u.id_usuario = b.id_usuario
             WHERE b.id_papeleria = ? AND DATE(b.fecha) BETWEEN ? AND ?`;
  if (req.query.buscar) {
    sql += ' AND (b.accion LIKE ? OR b.detalle LIKE ? OR u.nombre LIKE ?)';
    const q = `%${req.query.buscar}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY b.id_bitacora DESC LIMIT 500';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

module.exports = { ventas, bitacora };
