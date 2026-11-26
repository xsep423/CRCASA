// REPORTES del administrador: ventas por rango de fechas y bitácora de acciones.
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { pid } = require('../middleware/auth');
const exportar = require('../services/exportar');

const NOMBRES = { dia: 'día', empleado: 'empleado', metodo: 'forma de pago', clasificacion: 'clasificación', producto: 'producto' };
const fechaCorta = (f) => f.split('-').reverse().join('/');
// Fecha de hoy en la hora de Tijuana (el servidor de Vercel trabaja en UTC)
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ_REPORTES || 'America/Tijuana' });
const formato = (q) => {
  if (!['xlsx', 'pdf'].includes(q.formato)) throw new HttpError(400, 'Formato inválido: usa xlsx o pdf');
  return q.formato;
};
const nombrePapeleria = async (req) => {
  const [[p]] = await pool.query('SELECT nombre FROM papelerias WHERE id_papeleria = ?', [pid(req)]);
  return p ? p.nombre : 'CRCASA';
};

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
  const hoy = hoyLocal();
  const desde = q.desde && re.test(q.desde) ? q.desde : `${hoy.slice(0, 8)}01`;
  const hasta = q.hasta && re.test(q.hasta) ? q.hasta : hoy;
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial no puede ser mayor que la final');
  return { desde, hasta };
}

// Consulta del reporte de ventas; la usan la pantalla y la exportación
async function datosVentas(req) {
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
  return { desde, hasta, agrupar, resumen: { ...resumen, canceladas: canc.canceladas }, filas };
}

// GET /api/reportes/ventas?desde=&hasta=&agrupar=dia|empleado|metodo|clasificacion|producto
async function ventas(req, res) {
  res.json(await datosVentas(req));
}

// GET /api/reportes/ventas/exportar?formato=xlsx|pdf&desde=&hasta=&agrupar=
async function exportarVentas(req, res) {
  const f = formato(req.query);
  const d = await datosVentas(req);
  const detalle = ['clasificacion', 'producto'].includes(d.agrupar);
  const etiqueta = (g) => (d.agrupar === 'dia' ? fechaCorta(g) : d.agrupar === 'metodo' ? g[0].toUpperCase() + g.slice(1) : g);
  const r = d.resumen;
  await exportar.enviar(res, f, {
    papeleria: await nombrePapeleria(req),
    titulo: `Reporte de ventas por ${NOMBRES[d.agrupar]}`,
    subtitulo: `Del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)} · no incluye ventas canceladas`,
    hoja: 'Ventas',
    resumen: [
      { etiqueta: 'Ventas', valor: Number(r.ventas) },
      { etiqueta: 'Canceladas', valor: Number(r.canceladas) },
      { etiqueta: 'Vendido', valor: Number(r.total), tipo: 'dinero' },
      { etiqueta: 'Descuentos otorgados', valor: Number(r.descuentos), tipo: 'dinero' },
      { etiqueta: 'Ticket promedio', valor: r.ventas ? Math.round((r.total / r.ventas) * 100) / 100 : 0, tipo: 'dinero' },
    ],
    columnas: [
      { titulo: NOMBRES[d.agrupar][0].toUpperCase() + NOMBRES[d.agrupar].slice(1), clave: 'grupo', ancho: 34 },
      { titulo: 'Ventas', clave: 'ventas', tipo: 'numero', ancho: 12 },
      { titulo: 'Piezas', clave: 'piezas', tipo: 'numero', ancho: 12 },
      { titulo: 'Importe', clave: 'total', tipo: 'dinero', ancho: 16 },
    ],
    filas: d.filas.map((x) => ({ ...x, grupo: etiqueta(x.grupo) })),
    totales: { grupo: 'Total', ventas: detalle ? '' : 'SUMA', piezas: 'SUMA', total: 'SUMA' },
    nota: detalle ? 'Por clasificación y producto, el importe de cada renglón ya lleva aplicado el descuento de su venta; una venta puede contar en varias filas.' : null,
  }, `reporte-ventas-${d.agrupar}-${d.desde}-a-${d.hasta}`);
}

// Existencias y valor del inventario a la fecha
async function datosInventario(req) {
  const [filas] = await pool.query(
    `SELECT p.codigo, p.nombre, cl.nombre AS clasificacion, p.existencia, p.existencia_minima, p.costo, p.precio_venta,
            ROUND(p.existencia * p.costo, 2) AS valor_costo, ROUND(p.existencia * p.precio_venta, 2) AS valor_venta,
            IF(p.existencia <= p.existencia_minima, 'Reabastecer', '') AS alerta
     FROM productos p JOIN clasificaciones cl ON cl.id_clasificacion = p.id_clasificacion
     WHERE p.id_papeleria = ? AND p.activo = 1 ORDER BY cl.nombre, p.nombre`, [pid(req)]);
  const suma = (k) => Math.round(filas.reduce((s, f) => s + Number(f[k]), 0) * 100) / 100;
  return {
    filas,
    resumen: { productos: filas.length, piezas: suma('existencia'), valor_costo: suma('valor_costo'),
      valor_venta: suma('valor_venta'), por_reabastecer: filas.filter((f) => f.alerta).length },
  };
}

// GET /api/reportes/inventario
async function inventario(req, res) {
  res.json(await datosInventario(req));
}

// GET /api/reportes/inventario/exportar?formato=xlsx|pdf
async function exportarInventario(req, res) {
  const f = formato(req.query);
  const d = await datosInventario(req);
  const hoy = hoyLocal();
  await exportar.enviar(res, f, {
    papeleria: await nombrePapeleria(req),
    titulo: 'Reporte de inventario',
    subtitulo: `Existencias al ${fechaCorta(hoy)}`,
    hoja: 'Inventario',
    resumen: [
      { etiqueta: 'Productos', valor: d.resumen.productos },
      { etiqueta: 'Piezas en existencia', valor: d.resumen.piezas },
      { etiqueta: 'Valor a costo', valor: d.resumen.valor_costo, tipo: 'dinero' },
      { etiqueta: 'Valor a precio de venta', valor: d.resumen.valor_venta, tipo: 'dinero' },
      { etiqueta: 'Por reabastecer', valor: d.resumen.por_reabastecer },
    ],
    columnas: [
      { titulo: 'Código', clave: 'codigo', ancho: 11 },
      { titulo: 'Producto', clave: 'nombre', ancho: 28 },
      { titulo: 'Clasificación', clave: 'clasificacion', ancho: 16 },
      { titulo: 'Existencia', clave: 'existencia', tipo: 'numero', ancho: 10 },
      { titulo: 'Mínimo', clave: 'existencia_minima', tipo: 'numero', ancho: 9 },
      { titulo: 'Costo', clave: 'costo', tipo: 'dinero', ancho: 10 },
      { titulo: 'Precio', clave: 'precio_venta', tipo: 'dinero', ancho: 10 },
      { titulo: 'Valor a costo', clave: 'valor_costo', tipo: 'dinero', ancho: 13 },
      { titulo: 'Alerta', clave: 'alerta', ancho: 11 },
    ],
    filas: d.filas,
    totales: { codigo: 'Total', existencia: 'SUMA', valor_costo: 'SUMA' },
  }, `reporte-inventario-${hoy}`);
}

async function datosBitacora(req) {
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
  return { desde, hasta, rows };
}

// GET /api/bitacora?desde=&hasta=&buscar=
async function bitacora(req, res) {
  res.json((await datosBitacora(req)).rows);
}

// GET /api/bitacora/exportar?formato=xlsx|pdf&desde=&hasta=&buscar=
async function exportarBitacora(req, res) {
  const f = formato(req.query);
  const d = await datosBitacora(req);
  await exportar.enviar(res, f, {
    papeleria: await nombrePapeleria(req),
    titulo: 'Bitácora de acciones',
    subtitulo: `Del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}${req.query.buscar ? ` · búsqueda: "${req.query.buscar}"` : ''}`,
    hoja: 'Bitácora',
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', tipo: 'fecha', ancho: 16 },
      { titulo: 'Usuario', clave: 'usuario', ancho: 16 },
      { titulo: 'Rol', clave: 'rol', ancho: 12 },
      { titulo: 'Acción', clave: 'accion', ancho: 18 },
      { titulo: 'Detalle', clave: 'detalle', ancho: 38 },
    ],
    filas: d.rows,
  }, `bitacora-${d.desde}-a-${d.hasta}`);
}

module.exports = { ventas, exportarVentas, inventario, exportarInventario, bitacora, exportarBitacora };
