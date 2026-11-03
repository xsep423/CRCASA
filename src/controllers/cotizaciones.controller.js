// COTIZACIONES: propuesta de precio para un cliente. NUNCA mueve la existencia.
// Se puede editar (quitar/agregar productos) mientras esté vigente; al editarla se recalcula todo.
// Al convertirla en venta se valida existencia y apenas ahí se descuenta el inventario.
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const calc = require('../services/calculos');
const { registrarVenta } = require('./ventas.controller');

// Marca como vencidas las que ya pasaron su fecha de vigencia
const actualizarVencidas = (conn = pool) =>
  conn.query("UPDATE cotizaciones SET estado = 'vencida' WHERE estado = 'vigente' AND vigencia < CURDATE()");

async function detalle(conn, id) {
  const [cab] = await conn.query(
    `SELECT co.*, c.codigo AS codigo_cliente, c.nombre AS cliente, u.nombre AS capturo,
            v.id_venta
     FROM cotizaciones co
     JOIN clientes c ON c.id_cliente = co.id_cliente
     JOIN usuarios u ON u.id_usuario = co.id_usuario
     LEFT JOIN ventas v ON v.id_cotizacion = co.id_cotizacion
     WHERE co.id_cotizacion = ?`, [id]);
  if (!cab.length) throw new HttpError(404, 'Cotización no encontrada');
  const [partidas] = await conn.query(
    `SELECT d.id_producto, p.codigo, p.nombre, d.cantidad, d.precio_unitario, d.importe, p.existencia
     FROM detalle_cotizacion d JOIN productos p ON p.id_producto = d.id_producto
     WHERE d.id_cotizacion = ? ORDER BY d.id_detalle`, [id]);
  return { ...cab[0], partidas };
}

// GET /api/cotizaciones?estado=&buscar=
async function listar(req, res) {
  await actualizarVencidas();
  const { estado, buscar } = req.query;
  let sql = `SELECT co.id_cotizacion, co.fecha, co.vigencia, co.total, co.estado, co.porcentaje_descuento,
                    c.codigo AS codigo_cliente, c.nombre AS cliente, u.nombre AS capturo,
                    (SELECT COUNT(*) FROM detalle_cotizacion d WHERE d.id_cotizacion = co.id_cotizacion) AS productos
             FROM cotizaciones co
             JOIN clientes c ON c.id_cliente = co.id_cliente
             JOIN usuarios u ON u.id_usuario = co.id_usuario WHERE 1=1`;
  const params = [];
  if (estado) { sql += ' AND co.estado = ?'; params.push(estado); }
  if (buscar) { sql += ' AND (c.nombre LIKE ? OR c.codigo LIKE ? OR co.id_cotizacion = ?)'; params.push(`%${buscar}%`, `${buscar}%`, Number(buscar) || 0); }
  sql += ' ORDER BY co.id_cotizacion DESC LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

// GET /api/cotizaciones/:id
async function obtener(req, res) {
  await actualizarVencidas();
  res.json(await detalle(pool, req.params.id));
}

// Calcula partidas y totales SIN tocar existencia (no se valida stock en una cotización).
// preciosPrevios: al editar, los productos que ya estaban conservan el precio cotizado
// (la vigencia garantiza el precio); los productos nuevos toman el precio actual.
async function calcular(conn, body, cliente, preciosPrevios = new Map()) {
  const lineas = (await calc.armarPartidas(conn, body.partidas)).map((l) => {
    if (!preciosPrevios.has(l.id_producto)) return l;
    const precio = Number(preciosPrevios.get(l.id_producto));
    return { ...l, precio_unitario: precio, importe: Math.round(precio * l.cantidad * 100) / 100 };
  });
  const pct = await calc.resolverDescuento(conn, cliente, body.porcentaje_descuento);
  return { lineas, t: calc.totales(lineas, pct) };
}

async function guardarPartidas(conn, idCotizacion, lineas) {
  await conn.query('DELETE FROM detalle_cotizacion WHERE id_cotizacion = ?', [idCotizacion]);
  await conn.query(
    'INSERT INTO detalle_cotizacion (id_cotizacion, id_producto, cantidad, precio_unitario, importe) VALUES ?',
    [lineas.map((l) => [idCotizacion, l.id_producto, l.cantidad, l.precio_unitario, l.importe])]);
}

// POST /api/cotizaciones  { id_cliente, partidas:[{id_producto,cantidad}], porcentaje_descuento?, notas? }
async function crear(req, res) {
  const id = await pool.transaccion(async (conn) => {
    const cliente = await calc.obtenerCliente(conn, req.body.id_cliente);
    const { lineas, t } = await calcular(conn, req.body, cliente);
    const dias = await calc.leerConfig(conn, 'dias_vigencia_cotizacion', 15);
    const [r] = await conn.query(
      `INSERT INTO cotizaciones (id_cliente, id_usuario, vigencia, subtotal, porcentaje_descuento, descuento, total, notas)
       VALUES (?,?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?,?,?,?,?)`,
      [cliente.id_cliente, req.usuario.id, dias, t.subtotal, t.porcentaje_descuento, t.descuento, t.total, req.body.notas || null]);
    await guardarPartidas(conn, r.insertId, lineas);
    return r.insertId;
  });
  res.status(201).json({ mensaje: 'Cotización guardada', cotizacion: await detalle(pool, id) });
}

async function vigenteParaEditar(conn, id) {
  await actualizarVencidas(conn);
  const [rows] = await conn.query('SELECT * FROM cotizaciones WHERE id_cotizacion = ? FOR UPDATE', [id]);
  if (!rows.length) throw new HttpError(404, 'Cotización no encontrada');
  if (rows[0].estado !== 'vigente') throw new HttpError(409, `La cotización está ${rows[0].estado} y ya no se puede modificar`);
  return rows[0];
}

// PUT /api/cotizaciones/:id  — reemplaza las partidas (ej. de 10 productos quita 1) y recalcula
async function actualizar(req, res) {
  await pool.transaccion(async (conn) => {
    const cot = await vigenteParaEditar(conn, req.params.id);
    const cliente = await calc.obtenerCliente(conn, req.body.id_cliente || cot.id_cliente);
    const [previas] = await conn.query(
      'SELECT id_producto, precio_unitario FROM detalle_cotizacion WHERE id_cotizacion = ?', [cot.id_cotizacion]);
    const precios = new Map(previas.map((p) => [p.id_producto, p.precio_unitario]));
    const { lineas, t } = await calcular(conn, req.body, cliente, precios);
    await conn.query(
      `UPDATE cotizaciones SET id_cliente=?, subtotal=?, porcentaje_descuento=?, descuento=?, total=?, notas=?
       WHERE id_cotizacion = ?`,
      [cliente.id_cliente, t.subtotal, t.porcentaje_descuento, t.descuento, t.total, req.body.notas ?? cot.notas, cot.id_cotizacion]);
    await guardarPartidas(conn, cot.id_cotizacion, lineas);
  });
  res.json({ mensaje: 'Cotización actualizada', cotizacion: await detalle(pool, req.params.id) });
}

// POST /api/cotizaciones/:id/cancelar
async function cancelar(req, res) {
  await pool.transaccion(async (conn) => {
    await vigenteParaEditar(conn, req.params.id);
    await conn.query("UPDATE cotizaciones SET estado = 'cancelada' WHERE id_cotizacion = ?", [req.params.id]);
  });
  res.json({ mensaje: 'Cotización cancelada' });
}

// POST /api/cotizaciones/:id/convertir  { metodo_pago, tipo_entrega }
// Respeta los precios y el descuento cotizados (la vigencia garantiza el precio).
async function convertir(req, res) {
  const idVenta = await pool.transaccion(async (conn) => {
    const cot = await vigenteParaEditar(conn, req.params.id);
    const [partidas] = await conn.query(
      'SELECT id_producto, cantidad, precio_unitario, importe FROM detalle_cotizacion WHERE id_cotizacion = ?',
      [cot.id_cotizacion]);
    const id = await registrarVenta(conn, {
      usuario: req.usuario,
      id_cliente: cot.id_cliente,
      partidas,
      preciosFijos: true,
      porcentajeFijo: Number(cot.porcentaje_descuento),
      metodo_pago: req.body.metodo_pago,
      tipo_entrega: req.body.tipo_entrega,
      id_cotizacion: cot.id_cotizacion,
    });
    await conn.query("UPDATE cotizaciones SET estado = 'convertida' WHERE id_cotizacion = ?", [cot.id_cotizacion]);
    return id;
  });
  res.status(201).json({ mensaje: 'Cotización convertida en venta', id_venta: idVenta });
}

module.exports = { listar, obtener, crear, actualizar, cancelar, convertir };
