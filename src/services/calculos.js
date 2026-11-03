// Lógica compartida por ventas y cotizaciones: partidas, totales y descuento.
const { HttpError, redondear } = require('../utils/http');

async function leerConfig(conn, clave, porDefecto) {
  const [rows] = await conn.query('SELECT valor FROM configuracion WHERE clave = ?', [clave]);
  return rows.length ? Number(rows[0].valor) : porDefecto;
}

async function obtenerCliente(conn, idCliente) {
  const [rows] = await conn.query(
    'SELECT id_cliente, codigo, nombre, rfc, porcentaje_descuento FROM clientes WHERE id_cliente = ? AND activo = 1',
    [idCliente]
  );
  if (!rows.length) throw new HttpError(400, 'El cliente no existe o está dado de baja');
  return rows[0];
}

// Junta partidas repetidas del mismo producto y valida cantidades.
function normalizarPartidas(partidas) {
  if (!Array.isArray(partidas) || !partidas.length) {
    throw new HttpError(400, 'Agrega al menos un producto');
  }
  const mapa = new Map();
  for (const p of partidas) {
    const id = Number(p.id_producto);
    const cant = Number(p.cantidad);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Producto inválido');
    if (!Number.isInteger(cant) || cant <= 0) throw new HttpError(400, 'La cantidad debe ser un entero mayor a 0');
    mapa.set(id, (mapa.get(id) || 0) + cant);
  }
  return [...mapa].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));
}

// Trae precio y existencia actuales de cada producto.
// bloquear = true usa SELECT ... FOR UPDATE (dentro de una transacción de venta).
async function armarPartidas(conn, partidas, { bloquear = false } = {}) {
  const lista = normalizarPartidas(partidas);
  const ids = lista.map((p) => p.id_producto);
  const [productos] = await conn.query(
    `SELECT id_producto, codigo, nombre, precio_venta, existencia
     FROM productos WHERE activo = 1 AND id_producto IN (?) ${bloquear ? 'FOR UPDATE' : ''}`,
    [ids]
  );
  const porId = new Map(productos.map((p) => [p.id_producto, p]));
  return lista.map((p) => {
    const prod = porId.get(p.id_producto);
    if (!prod) throw new HttpError(400, `El producto ${p.id_producto} no existe o está dado de baja`);
    const precio = Number(prod.precio_venta);
    return {
      id_producto: p.id_producto,
      codigo: prod.codigo,
      nombre: prod.nombre,
      cantidad: p.cantidad,
      existencia: prod.existencia,
      precio_unitario: precio,
      importe: redondear(precio * p.cantidad),
    };
  });
}

// Revisa que alcance la existencia; si no, lista los faltantes para que el capturista decida.
function validarExistencia(lineas) {
  const faltantes = lineas
    .filter((l) => l.cantidad > l.existencia)
    .map((l) => ({ codigo: l.codigo, nombre: l.nombre, solicitado: l.cantidad, existencia: l.existencia }));
  if (faltantes.length) {
    throw new HttpError(409, 'No hay existencia suficiente de algunos productos', { faltantes });
  }
}

// Descuento asignado por cliente (no se acumula con otros).
// - Si no se envía porcentaje, se usa el del catálogo de clientes.
// - Si el capturista lo cambia, puede ir de 0 hasta el tope (o hasta el % del cliente si es mayor).
async function resolverDescuento(conn, cliente, porcentajeSolicitado) {
  const asignado = Number(cliente.porcentaje_descuento);
  if (porcentajeSolicitado === undefined || porcentajeSolicitado === null || porcentajeSolicitado === '') {
    return asignado;
  }
  const pct = Number(porcentajeSolicitado);
  const tope = await leerConfig(conn, 'tope_descuento', 15);
  const maximo = Math.max(tope, asignado);
  if (isNaN(pct) || pct < 0 || pct > maximo) {
    throw new HttpError(400, `El descuento debe estar entre 0% y ${maximo}%`);
  }
  return pct;
}

function totales(lineas, porcentaje) {
  const subtotal = redondear(lineas.reduce((s, l) => s + Number(l.importe), 0));
  const descuento = redondear(subtotal * (porcentaje / 100));
  return { subtotal, porcentaje_descuento: porcentaje, descuento, total: redondear(subtotal - descuento) };
}

module.exports = {
  leerConfig, obtenerCliente, armarPartidas, validarExistencia, resolverDescuento, totales,
};
