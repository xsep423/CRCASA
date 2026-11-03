// VENTAS: operación con un CLIENTE. Sale mercancía -> se descuenta existencia (en transacción).
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const calc = require('../services/calculos');

const METODOS = ['efectivo', 'tarjeta', 'transferencia'];
const ENTREGAS = ['mostrador', 'recoger'];

// Se usa en POST /api/ventas y al convertir una cotización. Debe llamarse dentro de una transacción.
async function registrarVenta(conn, opts) {
  const { usuario, id_cliente, partidas, preciosFijos = false, porcentajeFijo, id_cotizacion = null } = opts;
  const metodo = opts.metodo_pago || 'efectivo';
  const entrega = opts.tipo_entrega || 'mostrador';
  if (!METODOS.includes(metodo)) throw new HttpError(400, 'Método de pago inválido');
  if (!ENTREGAS.includes(entrega)) throw new HttpError(400, 'Tipo de entrega inválido');

  const cliente = await calc.obtenerCliente(conn, id_cliente);
  // FOR UPDATE: bloquea los productos para que dos ventas al mismo tiempo no vendan la misma pieza
  let lineas = await calc.armarPartidas(conn, partidas, { bloquear: true });
  if (preciosFijos) {
    const cotizado = new Map(partidas.map((p) => [Number(p.id_producto), p]));
    lineas = lineas.map((l) => ({
      ...l,
      precio_unitario: Number(cotizado.get(l.id_producto).precio_unitario),
      importe: Number(cotizado.get(l.id_producto).importe),
    }));
  }
  calc.validarExistencia(lineas);

  const pct = porcentajeFijo !== undefined ? porcentajeFijo : await calc.resolverDescuento(conn, cliente, opts.porcentaje_descuento);
  const t = calc.totales(lineas, pct);
  const estado = entrega === 'recoger' ? 'pendiente_entrega' : 'pagada';

  const [r] = await conn.query(
    `INSERT INTO ventas (id_cliente, id_usuario, id_cotizacion, subtotal, porcentaje_descuento, descuento, total,
                         metodo_pago, tipo_entrega, estado)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [cliente.id_cliente, usuario.id, id_cotizacion, t.subtotal, t.porcentaje_descuento, t.descuento, t.total,
      metodo, entrega, estado]);
  await conn.query(
    'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario, importe) VALUES ?',
    [lineas.map((l) => [r.insertId, l.id_producto, l.cantidad, l.precio_unitario, l.importe])]);
  for (const l of lineas) {
    await conn.query('UPDATE productos SET existencia = existencia - ? WHERE id_producto = ?', [l.cantidad, l.id_producto]);
  }
  return r.insertId;
}

async function detalle(conn, id) {
  const [cab] = await conn.query(
    `SELECT v.*, c.codigo AS codigo_cliente, c.nombre AS cliente, c.rfc AS rfc_cliente, u.nombre AS vendio,
            f.id_factura
     FROM ventas v
     JOIN clientes c ON c.id_cliente = v.id_cliente
     JOIN usuarios u ON u.id_usuario = v.id_usuario
     LEFT JOIN facturas f ON f.id_venta = v.id_venta
     WHERE v.id_venta = ?`, [id]);
  if (!cab.length) throw new HttpError(404, 'Venta no encontrada');
  const [partidas] = await conn.query(
    `SELECT d.id_producto, p.codigo, p.nombre, d.cantidad, d.precio_unitario, d.importe
     FROM detalle_venta d JOIN productos p ON p.id_producto = d.id_producto
     WHERE d.id_venta = ? ORDER BY d.id_detalle`, [id]);
  return { ...cab[0], partidas };
}

// GET /api/ventas?estado=&desde=&hasta=&buscar=
async function listar(req, res) {
  const { estado, desde, hasta, buscar } = req.query;
  let sql = `SELECT v.id_venta, v.fecha, v.total, v.porcentaje_descuento, v.metodo_pago, v.tipo_entrega, v.estado,
                    v.id_cotizacion, c.codigo AS codigo_cliente, c.nombre AS cliente, u.nombre AS vendio
             FROM ventas v
             JOIN clientes c ON c.id_cliente = v.id_cliente
             JOIN usuarios u ON u.id_usuario = v.id_usuario WHERE 1=1`;
  const params = [];
  if (estado) { sql += ' AND v.estado = ?'; params.push(estado); }
  if (desde) { sql += ' AND DATE(v.fecha) >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND DATE(v.fecha) <= ?'; params.push(hasta); }
  if (buscar) { sql += ' AND (c.nombre LIKE ? OR c.codigo LIKE ? OR v.id_venta = ?)'; params.push(`%${buscar}%`, `${buscar}%`, Number(buscar) || 0); }
  sql += ' ORDER BY v.id_venta DESC LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

async function obtener(req, res) {
  res.json(await detalle(pool, req.params.id));
}

// POST /api/ventas  { id_cliente, partidas, porcentaje_descuento?, metodo_pago, tipo_entrega }
async function crear(req, res) {
  const id = await pool.transaccion((conn) => registrarVenta(conn, { ...req.body, usuario: req.usuario }));
  res.status(201).json({ mensaje: 'Venta registrada', venta: await detalle(pool, id) });
}

// POST /api/ventas/:id/entregar — pedido para recoger que el cliente ya pasó a llevarse
async function entregar(req, res) {
  const [r] = await pool.query(
    "UPDATE ventas SET estado = 'entregada' WHERE id_venta = ? AND estado = 'pendiente_entrega'", [req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, 'La venta no es un pedido pendiente de entrega');
  res.json({ mensaje: 'Pedido entregado' });
}

// POST /api/ventas/:id/cancelar (admin) — regresa la mercancía a la existencia
async function cancelar(req, res) {
  await pool.transaccion(async (conn) => {
    const [rows] = await conn.query(
      `SELECT v.estado, f.id_factura FROM ventas v LEFT JOIN facturas f ON f.id_venta = v.id_venta
       WHERE v.id_venta = ? FOR UPDATE`, [req.params.id]);
    if (!rows.length) throw new HttpError(404, 'Venta no encontrada');
    if (rows[0].estado === 'cancelada') throw new HttpError(409, 'La venta ya estaba cancelada');
    if (rows[0].id_factura) throw new HttpError(409, 'La venta ya fue facturada; primero hay que cancelar la factura');
    const [partidas] = await conn.query('SELECT id_producto, cantidad FROM detalle_venta WHERE id_venta = ?', [req.params.id]);
    for (const p of partidas) {
      await conn.query('UPDATE productos SET existencia = existencia + ? WHERE id_producto = ?', [p.cantidad, p.id_producto]);
    }
    await conn.query("UPDATE ventas SET estado = 'cancelada' WHERE id_venta = ?", [req.params.id]);
  });
  res.json({ mensaje: 'Venta cancelada y existencia devuelta' });
}

// POST /api/ventas/:id/factura  { rfc?, razon_social?, uso_cfdi? }
// FACTURA = documento para el cliente al que le vendimos. Se registra; no se timbra ante el SAT.
async function facturar(req, res) {
  const venta = await detalle(pool, req.params.id);
  if (venta.estado === 'cancelada') throw new HttpError(409, 'No se puede facturar una venta cancelada');
  if (venta.id_factura) throw new HttpError(409, 'Esta venta ya tiene factura');
  if (venta.codigo_cliente === 'PG') throw new HttpError(400, 'Para facturar, la venta debe estar a nombre de un cliente registrado');
  const rfc = (req.body.rfc || venta.rfc_cliente || '').toUpperCase();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new HttpError(400, 'El cliente necesita un RFC válido para facturar');
  const [r] = await pool.query(
    'INSERT INTO facturas (id_venta, rfc, razon_social, uso_cfdi, id_usuario) VALUES (?,?,?,?,?)',
    [venta.id_venta, rfc, req.body.razon_social || venta.cliente, req.body.uso_cfdi || 'G03', req.usuario.id]);
  res.status(201).json({ mensaje: 'Factura registrada', id_factura: r.insertId });
}

module.exports = { registrarVenta, listar, obtener, crear, entregar, cancelar, facturar };
