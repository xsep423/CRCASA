// VENTAS: operación con un CLIENTE. Sale mercancía -> se descuenta existencia (en transacción).
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const calc = require('../services/calculos');
const { pid } = require('../middleware/auth');
const { siguienteFolio, movimiento, bitacora } = require('../services/registro');
const { redondear } = require('../utils/http');

const METODOS = ['efectivo', 'tarjeta', 'transferencia'];
const ENTREGAS = ['mostrador', 'recoger'];

// Se usa en POST /api/ventas y al convertir una cotización. Debe llamarse dentro de una transacción.
async function registrarVenta(conn, opts) {
  const { usuario, id_cliente, partidas, preciosFijos = false, porcentajeFijo, id_cotizacion = null } = opts;
  const metodo = opts.metodo_pago || 'efectivo';
  const entrega = opts.tipo_entrega || 'mostrador';
  if (!METODOS.includes(metodo)) throw new HttpError(400, 'Método de pago inválido');
  if (!ENTREGAS.includes(entrega)) throw new HttpError(400, 'Tipo de entrega inválido');

  const idPap = usuario.id_papeleria;
  const cliente = await calc.obtenerCliente(conn, idPap, id_cliente);
  // FOR UPDATE: bloquea los productos para que dos ventas al mismo tiempo no vendan la misma pieza
  let lineas = await calc.armarPartidas(conn, idPap, partidas, { bloquear: true });
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

  // Cobro en efectivo: si el capturista anota con cuánto pagó el cliente, se calcula el cambio
  let pagoCon = null;
  let cambio = null;
  if (metodo === 'efectivo' && opts.pago_con !== undefined && opts.pago_con !== null && opts.pago_con !== '') {
    pagoCon = Number(opts.pago_con);
    if (isNaN(pagoCon) || pagoCon < t.total) throw new HttpError(400, `El pago (${pagoCon}) no cubre el total de la venta (${t.total})`);
    cambio = redondear(pagoCon - t.total);
  }

  const folio = await siguienteFolio(conn, idPap, 'venta');
  const [r] = await conn.query(
    `INSERT INTO ventas (id_papeleria, folio, id_cliente, id_usuario, id_cotizacion, subtotal, porcentaje_descuento, descuento, total,
                         metodo_pago, pago_con, cambio, tipo_entrega, estado)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [idPap, folio, cliente.id_cliente, usuario.id, id_cotizacion, t.subtotal, t.porcentaje_descuento, t.descuento, t.total,
      metodo, pagoCon, cambio, entrega, estado]);
  await conn.query(
    'INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario, importe) VALUES ?',
    [lineas.map((l) => [r.insertId, l.id_producto, l.cantidad, l.precio_unitario, l.importe])]);
  for (const l of lineas) {
    await conn.query('UPDATE productos SET existencia = existencia - ? WHERE id_producto = ?', [l.cantidad, l.id_producto]);
    await movimiento(conn, { idPapeleria: idPap, idProducto: l.id_producto, tipo: 'venta', cantidad: -l.cantidad,
      referencia: `Venta ${folio}`, idUsuario: usuario.id });
  }
  return r.insertId;
}

async function detalle(conn, idPap, id) {
  const [cab] = await conn.query(
    `SELECT v.*, co.folio AS folio_cotizacion, c.codigo AS codigo_cliente, c.nombre AS cliente, c.rfc AS rfc_cliente, u.nombre AS vendio,
            sf.id_solicitud
     FROM ventas v
     JOIN clientes c ON c.id_cliente = v.id_cliente
     JOIN usuarios u ON u.id_usuario = v.id_usuario
     LEFT JOIN solicitudes_factura sf ON sf.id_venta = v.id_venta
     LEFT JOIN cotizaciones co ON co.id_cotizacion = v.id_cotizacion
     WHERE v.id_venta = ? AND v.id_papeleria = ?`, [id, idPap]);
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
  let sql = `SELECT v.id_venta, v.folio, co.folio AS folio_cotizacion, v.fecha, v.total, v.porcentaje_descuento, v.metodo_pago, v.tipo_entrega, v.estado,
                    v.id_cotizacion, c.codigo AS codigo_cliente, c.nombre AS cliente, u.nombre AS vendio
             FROM ventas v
             JOIN clientes c ON c.id_cliente = v.id_cliente
             JOIN usuarios u ON u.id_usuario = v.id_usuario
             LEFT JOIN cotizaciones co ON co.id_cotizacion = v.id_cotizacion
             WHERE v.id_papeleria = ?`;
  const params = [pid(req)];
  if (estado) { sql += ' AND v.estado = ?'; params.push(estado); }
  if (desde) { sql += ' AND DATE(v.fecha) >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND DATE(v.fecha) <= ?'; params.push(hasta); }
  if (buscar) { sql += ' AND (c.nombre LIKE ? OR c.codigo LIKE ? OR v.folio = ?)'; params.push(`%${buscar}%`, `${buscar}%`, Number(buscar) || 0); }
  sql += ' ORDER BY v.id_venta DESC LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

async function obtener(req, res) {
  res.json(await detalle(pool, pid(req), req.params.id));
}

// POST /api/ventas  { id_cliente, partidas, porcentaje_descuento?, metodo_pago, tipo_entrega }
async function crear(req, res) {
  const id = await pool.transaccion((conn) => registrarVenta(conn, { ...req.body, usuario: req.usuario }));
  res.status(201).json({ mensaje: 'Venta registrada', venta: await detalle(pool, pid(req), id) });
}

// POST /api/ventas/:id/entregar — pedido para recoger que el cliente ya pasó a llevarse
async function entregar(req, res) {
  const [r] = await pool.query(
    "UPDATE ventas SET estado = 'entregada' WHERE id_venta = ? AND id_papeleria = ? AND estado = 'pendiente_entrega'",
    [req.params.id, pid(req)]);
  if (!r.affectedRows) throw new HttpError(409, 'La venta no es un pedido pendiente de entrega');
  res.json({ mensaje: 'Pedido entregado' });
}

// POST /api/ventas/:id/cancelar (admin) — regresa la mercancía a la existencia
async function cancelar(req, res) {
  await pool.transaccion(async (conn) => {
    const [rows] = await conn.query(
      `SELECT v.estado, v.folio, sf.id_solicitud FROM ventas v LEFT JOIN solicitudes_factura sf ON sf.id_venta = v.id_venta
       WHERE v.id_venta = ? AND v.id_papeleria = ? FOR UPDATE`, [req.params.id, pid(req)]);
    if (!rows.length) throw new HttpError(404, 'Venta no encontrada');
    if (rows[0].estado === 'cancelada') throw new HttpError(409, 'La venta ya estaba cancelada');
    if (rows[0].id_solicitud) throw new HttpError(409, 'La venta tiene una solicitud de factura; si el CFDI ya se emitió, primero hay que cancelarlo ante el SAT');
    const [partidas] = await conn.query('SELECT id_producto, cantidad FROM detalle_venta WHERE id_venta = ?', [req.params.id]);
    for (const p of partidas) {
      await conn.query('UPDATE productos SET existencia = existencia + ? WHERE id_producto = ?', [p.cantidad, p.id_producto]);
      await movimiento(conn, { idPapeleria: pid(req), idProducto: p.id_producto, tipo: 'cancelacion', cantidad: p.cantidad,
        referencia: `Cancelación venta ${rows[0].folio}`, idUsuario: req.usuario.id });
    }
    await conn.query("UPDATE ventas SET estado = 'cancelada' WHERE id_venta = ?", [req.params.id]);
    await bitacora(req.usuario, 'Cancelar venta', `Venta ${rows[0].folio}`, { conn });
  });
  res.json({ mensaje: 'Venta cancelada y existencia devuelta' });
}

// POST /api/ventas/:id/solicitud-factura  { rfc?, razon_social?, uso_cfdi? }
// El sistema NO emite facturas: sin timbrado ante el SAT no existe CFDI. Lo que hace es guardar
// los datos fiscales del cliente para que la papelería emita el CFDI en el portal del SAT o con su PAC.
async function solicitarFactura(req, res) {
  const venta = await detalle(pool, pid(req), req.params.id);
  if (venta.estado === 'cancelada') throw new HttpError(409, 'No se puede solicitar factura de una venta cancelada');
  if (venta.id_solicitud) throw new HttpError(409, 'Esta venta ya tiene una solicitud de factura');
  if (venta.codigo_cliente === 'PG') throw new HttpError(400, 'Para solicitar factura, la venta debe estar a nombre de un cliente registrado');
  const rfc = (req.body.rfc || venta.rfc_cliente || '').toUpperCase();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new HttpError(400, 'El cliente necesita un RFC válido para solicitar factura');
  const [r] = await pool.query(
    'INSERT INTO solicitudes_factura (id_venta, rfc, razon_social, uso_cfdi, id_usuario) VALUES (?,?,?,?,?)',
    [venta.id_venta, rfc, req.body.razon_social || venta.cliente, req.body.uso_cfdi || 'G03', req.usuario.id]);
  await bitacora(req.usuario, 'Solicitud de factura', `Venta ${venta.folio} · RFC ${rfc}`);
  res.status(201).json({ mensaje: 'Solicitud de factura registrada', id_solicitud: r.insertId });
}

module.exports = { registrarVenta, listar, obtener, crear, entregar, cancelar, solicitarFactura };
