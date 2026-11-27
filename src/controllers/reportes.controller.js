// REPORTES del administrador: ventas por rango de fechas y bitácora de acciones.
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { pid } = require('../middleware/auth');
const exportar = require('../services/exportar');

const NOMBRES = { categoria: 'categoría', dia: 'día', empleado: 'empleado', metodo: 'forma de pago', producto: 'producto' };
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
const fechaCorta = (f) => f.split('-').reverse().join('/');
// Fecha de hoy en la hora de Tijuana (el servidor de Vercel trabaja en UTC)
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ_REPORTES || 'America/Tijuana' });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const formato = (q) => {
  if (!['xlsx', 'pdf'].includes(q.formato)) throw new HttpError(400, 'Formato inválido: usa xlsx o pdf');
  return q.formato;
};
const nombrePapeleria = async (req) => {
  const [[p]] = await pool.query('SELECT nombre FROM papelerias WHERE id_papeleria = ?', [pid(req)]);
  return p ? p.nombre : 'CRCASA';
};

function rango(q) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = hoyLocal();
  const desde = q.desde && re.test(q.desde) ? q.desde : `${hoy.slice(0, 8)}01`;
  const hasta = q.hasta && re.test(q.hasta) ? q.hasta : hoy;
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial no puede ser mayor que la final');
  return { desde, hasta };
}

// Filtros opcionales: categoría, empleado y forma de pago. Devuelve el WHERE, sus parámetros y un texto legible.
async function filtros(req, { conProducto }) {
  const { desde, hasta } = rango(req.query);
  const idPap = pid(req);
  let where = "v.id_papeleria = ? AND v.estado <> 'cancelada' AND DATE(v.fecha) BETWEEN ? AND ?";
  const params = [idPap, desde, hasta];
  const textos = [];
  if (req.query.empleado) {
    const [[u]] = await pool.query('SELECT nombre FROM usuarios WHERE id_usuario = ? AND id_papeleria = ?', [req.query.empleado, idPap]);
    if (!u) throw new HttpError(400, 'Empleado inválido');
    where += ' AND v.id_usuario = ?'; params.push(Number(req.query.empleado)); textos.push(`empleado: ${u.nombre}`);
  }
  if (req.query.metodo) {
    if (!METODOS[req.query.metodo]) throw new HttpError(400, 'Forma de pago inválida');
    where += ' AND v.metodo_pago = ?'; params.push(req.query.metodo); textos.push(`pago: ${METODOS[req.query.metodo].toLowerCase()}`);
  }
  let categoria = null;
  if (req.query.categoria) {
    const [[c]] = await pool.query('SELECT nombre FROM clasificaciones WHERE id_clasificacion = ? AND id_papeleria = ?', [req.query.categoria, idPap]);
    if (!c) throw new HttpError(400, 'Categoría inválida');
    categoria = c.nombre;
    if (conProducto) { where += ' AND p.id_clasificacion = ?'; params.push(Number(req.query.categoria)); }
    textos.push(`categoría: ${c.nombre}`);
  }
  return { desde, hasta, where, params, textos, categoria };
}

// Ventas del periodo. agrupar = categoria (cada categoría con sus productos y subtotal) | producto | dia | empleado | metodo
async function datosVentas(req) {
  const agrupar = NOMBRES[req.query.agrupar] ? req.query.agrupar : 'categoria';
  const porProducto = ['categoria', 'producto'].includes(agrupar) || !!req.query.categoria;
  const f = await filtros(req, { conProducto: true });
  const desdeProductos = `FROM detalle_venta d JOIN ventas v ON v.id_venta = d.id_venta
       JOIN productos p ON p.id_producto = d.id_producto
       JOIN clasificaciones cl ON cl.id_clasificacion = p.id_clasificacion
       JOIN usuarios u ON u.id_usuario = v.id_usuario`;
  // El importe de cada producto ya lleva aplicado el descuento de su venta
  const importe = 'ROUND(SUM(d.importe * (1 - v.porcentaje_descuento / 100)), 2)';

  // Resumen del periodo (con los mismos filtros)
  const [[resumen]] = porProducto
    ? await pool.query(`SELECT COUNT(DISTINCT v.id_venta) AS ventas, COALESCE(SUM(d.cantidad),0) AS piezas,
              COALESCE(${importe},0) AS total, COALESCE(ROUND(SUM(d.importe * v.porcentaje_descuento / 100),2),0) AS descuentos
              ${desdeProductos} WHERE ${f.where}`, f.params)
    : await pool.query(`SELECT COUNT(*) AS ventas, COALESCE(SUM(v.total),0) AS total, COALESCE(SUM(v.descuento),0) AS descuentos,
              COALESCE(SUM((SELECT SUM(cantidad) FROM detalle_venta dv WHERE dv.id_venta = v.id_venta)),0) AS piezas
              FROM ventas v WHERE ${f.where}`, f.params);
  const [[canc]] = await pool.query(
    `SELECT COUNT(*) AS canceladas FROM ventas v WHERE v.id_papeleria = ? AND v.estado = 'cancelada' AND DATE(v.fecha) BETWEEN ? AND ?`,
    [pid(req), f.desde, f.hasta]);
  const total = Number(resumen.total);
  const pct = (x) => (total ? r2((Number(x) / total) * 100) : 0);

  let filas = [];
  let categorias = null;
  if (agrupar === 'categoria') {
    const [prods] = await pool.query(
      `SELECT cl.nombre AS categoria, p.codigo, p.nombre, COUNT(DISTINCT v.id_venta) AS ventas, SUM(d.cantidad) AS piezas, ${importe} AS total
       ${desdeProductos} WHERE ${f.where} GROUP BY cl.nombre, p.id_producto, p.codigo, p.nombre ORDER BY cl.nombre, total DESC`, f.params);
    const [cats] = await pool.query(
      `SELECT cl.nombre AS categoria, COUNT(DISTINCT v.id_venta) AS ventas, SUM(d.cantidad) AS piezas, ${importe} AS total
       ${desdeProductos} WHERE ${f.where} GROUP BY cl.nombre ORDER BY total DESC`, f.params);
    categorias = cats.map((c) => ({
      ...c, porcentaje: pct(c.total),
      productos: prods.filter((x) => x.categoria === c.categoria).map((x) => ({ ...x, porcentaje: pct(x.total) })),
    }));
  } else {
    const grupos = {
      producto: "CONCAT(p.codigo, ' · ', p.nombre)",
      dia: "DATE_FORMAT(v.fecha, '%Y-%m-%d')",
      empleado: 'u.nombre',
      metodo: 'v.metodo_pago',
    };
    const g = grupos[agrupar];
    const orden = agrupar === 'dia' ? 'grupo' : 'total DESC';
    [filas] = porProducto
      ? await pool.query(`SELECT ${g} AS grupo, COUNT(DISTINCT v.id_venta) AS ventas, SUM(d.cantidad) AS piezas, ${importe} AS total
          ${desdeProductos} WHERE ${f.where} GROUP BY ${g} ORDER BY ${orden}`, f.params)
      : await pool.query(`SELECT ${g} AS grupo, COUNT(*) AS ventas, SUM(pz.piezas) AS piezas, ROUND(SUM(v.total), 2) AS total
          FROM ventas v JOIN usuarios u ON u.id_usuario = v.id_usuario
          JOIN (SELECT id_venta, SUM(cantidad) AS piezas FROM detalle_venta GROUP BY id_venta) pz ON pz.id_venta = v.id_venta
          WHERE ${f.where} GROUP BY ${g} ORDER BY ${orden}`, f.params);
    filas = filas.map((x) => ({ ...x, porcentaje: pct(x.total) }));
  }
  return {
    desde: f.desde, hasta: f.hasta, agrupar, filtros: f.textos, porProducto,
    resumen: { ...resumen, canceladas: canc.canceladas }, filas, categorias,
  };
}

// GET /api/reportes/ventas?desde=&hasta=&agrupar=&categoria=&empleado=&metodo=
async function ventas(req, res) {
  res.json(await datosVentas(req));
}

// GET /api/reportes/opciones — categorías y empleados de la papelería para los filtros
async function opciones(req, res) {
  const [categorias] = await pool.query('SELECT id_clasificacion AS id, nombre FROM clasificaciones WHERE id_papeleria = ? ORDER BY nombre', [pid(req)]);
  const [empleados] = await pool.query('SELECT id_usuario AS id, nombre, rol FROM usuarios WHERE id_papeleria = ? ORDER BY nombre', [pid(req)]);
  res.json({ categorias, empleados, metodos: METODOS });
}

const etiquetaGrupo = (agrupar, g) => (agrupar === 'dia' ? fechaCorta(g) : agrupar === 'metodo' ? METODOS[g] || g : g);

// Convierte las categorías en renglones: encabezado de categoría, sus productos y su subtotal
function renglonesPorCategoria(categorias, columnaNombre, extra = () => ({})) {
  const filas = [];
  for (const c of categorias) {
    filas.push({ _tipo: 'grupo', [columnaNombre]: c.categoria });
    for (const p of c.productos) filas.push({ ...p, [columnaNombre]: `${p.codigo} · ${p.nombre}`, ...extra(p) });
    filas.push({ ...c, _tipo: 'subtotal', [columnaNombre]: `Subtotal ${c.categoria}` });
  }
  return filas;
}

// GET /api/reportes/ventas/exportar?formato=xlsx|pdf&(mismos filtros)
async function exportarVentas(req, res) {
  const f = formato(req.query);
  const d = await datosVentas(req);
  const r = d.resumen;
  const titulo = d.agrupar === 'categoria' ? 'Reporte de ventas por categoría y producto' : `Reporte de ventas por ${NOMBRES[d.agrupar]}`;
  const columnas = [
    { titulo: d.agrupar === 'categoria' ? 'Categoría / producto' : NOMBRES[d.agrupar][0].toUpperCase() + NOMBRES[d.agrupar].slice(1), clave: 'grupo', ancho: 36 },
    { titulo: 'Ventas', clave: 'ventas', tipo: 'numero', ancho: 10, sinFormula: true },
    { titulo: 'Piezas', clave: 'piezas', tipo: 'numero', ancho: 10 },
    { titulo: 'Importe', clave: 'total', tipo: 'dinero', ancho: 15 },
    { titulo: '% del total', clave: 'porcentaje', tipo: 'porcentaje', ancho: 11 },
  ];
  const filas = d.agrupar === 'categoria'
    ? renglonesPorCategoria(d.categorias, 'grupo')
    : d.filas.map((x) => ({ ...x, grupo: etiquetaGrupo(d.agrupar, x.grupo) }));
  await exportar.enviar(res, f, {
    papeleria: await nombrePapeleria(req),
    titulo,
    subtitulo: `Del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}${d.filtros.length ? ' · ' + d.filtros.join(' · ') : ''} · sin ventas canceladas`,
    hoja: 'Ventas',
    resumen: [
      { etiqueta: 'Ventas', valor: Number(r.ventas) },
      { etiqueta: 'Piezas', valor: Number(r.piezas) },
      { etiqueta: 'Vendido', valor: Number(r.total), tipo: 'dinero' },
      { etiqueta: 'Descuentos', valor: Number(r.descuentos), tipo: 'dinero' },
      { etiqueta: 'Canceladas', valor: Number(r.canceladas) },
    ],
    columnas,
    filas,
    totales: d.agrupar === 'categoria'
      ? { grupo: 'Total', ventas: Number(r.ventas), piezas: 'SUBTOTALES', total: 'SUBTOTALES', porcentaje: 100 }
      : { grupo: 'Total', ventas: d.porProducto ? Number(r.ventas) : 'SUMA', piezas: 'SUMA', total: 'SUMA', porcentaje: 100 },
    nota: d.porProducto ? 'El importe de cada producto ya lleva aplicado el descuento de su venta. Una venta con productos de varias categorías cuenta en cada una, por eso la suma de la columna Ventas puede ser mayor que el total.' : null,
  }, `reporte-ventas-${d.agrupar}-${d.desde}-a-${d.hasta}`);
}

// Existencias y valor del inventario a la fecha, divididos por categoría
async function datosInventario(req) {
  const params = [pid(req)];
  let where = 'p.id_papeleria = ? AND p.activo = 1';
  const textos = [];
  if (req.query.categoria) {
    const [[c]] = await pool.query('SELECT nombre FROM clasificaciones WHERE id_clasificacion = ? AND id_papeleria = ?', [req.query.categoria, pid(req)]);
    if (!c) throw new HttpError(400, 'Categoría inválida');
    where += ' AND p.id_clasificacion = ?'; params.push(Number(req.query.categoria)); textos.push(`categoría: ${c.nombre}`);
  }
  if (req.query.reabastecer === '1') { where += ' AND p.existencia <= p.existencia_minima'; textos.push('solo por reabastecer'); }
  const [filas] = await pool.query(
    `SELECT cl.nombre AS categoria, p.codigo, p.nombre, p.existencia, p.existencia_minima, p.costo, p.precio_venta,
            ROUND(p.existencia * p.costo, 2) AS valor_costo, ROUND(p.existencia * p.precio_venta, 2) AS valor_venta,
            IF(p.existencia <= p.existencia_minima, 'Reabastecer', '') AS alerta
     FROM productos p JOIN clasificaciones cl ON cl.id_clasificacion = p.id_clasificacion
     WHERE ${where} ORDER BY cl.nombre, p.nombre`, params);
  const suma = (lista, k) => r2(lista.reduce((s, f) => s + Number(f[k]), 0));
  const nombres = [...new Set(filas.map((f) => f.categoria))];
  const categorias = nombres.map((n) => {
    const productos = filas.filter((f) => f.categoria === n);
    return { categoria: n, productos: productos.length, existencia: suma(productos, 'existencia'),
      valor_costo: suma(productos, 'valor_costo'), valor_venta: suma(productos, 'valor_venta'),
      por_reabastecer: productos.filter((p) => p.alerta).length, lista: productos };
  });
  return {
    filtros: textos, filas, categorias,
    resumen: { productos: filas.length, piezas: suma(filas, 'existencia'), valor_costo: suma(filas, 'valor_costo'),
      valor_venta: suma(filas, 'valor_venta'), por_reabastecer: filas.filter((f) => f.alerta).length },
  };
}

// GET /api/reportes/inventario?categoria=&reabastecer=1
async function inventario(req, res) {
  res.json(await datosInventario(req));
}

// GET /api/reportes/inventario/exportar?formato=xlsx|pdf&categoria=&reabastecer=1
async function exportarInventario(req, res) {
  const f = formato(req.query);
  const d = await datosInventario(req);
  const hoy = hoyLocal();
  const filas = [];
  for (const c of d.categorias) {
    filas.push({ _tipo: 'grupo', nombre: c.categoria });
    filas.push(...c.lista);
    filas.push({ _tipo: 'subtotal', nombre: `Subtotal ${c.categoria}`, existencia: c.existencia, valor_costo: c.valor_costo, valor_venta: c.valor_venta });
  }
  await exportar.enviar(res, f, {
    papeleria: await nombrePapeleria(req),
    titulo: 'Reporte de inventario por categoría',
    subtitulo: `Existencias al ${fechaCorta(hoy)}${d.filtros.length ? ' · ' + d.filtros.join(' · ') : ''}`,
    hoja: 'Inventario',
    resumen: [
      { etiqueta: 'Productos', valor: d.resumen.productos },
      { etiqueta: 'Piezas', valor: d.resumen.piezas },
      { etiqueta: 'Valor a costo', valor: d.resumen.valor_costo, tipo: 'dinero' },
      { etiqueta: 'Valor a precio de venta', valor: d.resumen.valor_venta, tipo: 'dinero' },
      { etiqueta: 'Por reabastecer', valor: d.resumen.por_reabastecer },
    ],
    columnas: [
      { titulo: 'Código', clave: 'codigo', ancho: 10 },
      { titulo: 'Producto', clave: 'nombre', ancho: 30 },
      { titulo: 'Existencia', clave: 'existencia', tipo: 'numero', ancho: 10 },
      { titulo: 'Mínimo', clave: 'existencia_minima', tipo: 'numero', ancho: 8 },
      { titulo: 'Costo', clave: 'costo', tipo: 'dinero', ancho: 10 },
      { titulo: 'Precio', clave: 'precio_venta', tipo: 'dinero', ancho: 10 },
      { titulo: 'Valor a costo', clave: 'valor_costo', tipo: 'dinero', ancho: 13 },
      { titulo: 'Valor a precio', clave: 'valor_venta', tipo: 'dinero', ancho: 13 },
      { titulo: 'Alerta', clave: 'alerta', ancho: 11 },
    ],
    filas,
    totales: { codigo: 'Total', existencia: 'SUBTOTALES', valor_costo: 'SUBTOTALES', valor_venta: 'SUBTOTALES' },
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

module.exports = { ventas, opciones, exportarVentas, inventario, exportarInventario, bitacora, exportarBitacora };
