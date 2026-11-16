// Utilidades que usan varios módulos: folios por papelería, kárdex y bitácora.
const pool = require('../config/db');

// Siguiente folio consecutivo de la papelería para un tipo de documento.
// Debe llamarse dentro de la transacción del documento: la fila queda bloqueada
// hasta el commit, así dos ventas simultáneas nunca reciben el mismo folio.
async function siguienteFolio(conn, idPapeleria, tipo) {
  await conn.query(
    'INSERT INTO folios (id_papeleria, tipo, ultimo) VALUES (?,?,1) ON DUPLICATE KEY UPDATE ultimo = ultimo + 1',
    [idPapeleria, tipo]);
  const [[f]] = await conn.query('SELECT ultimo FROM folios WHERE id_papeleria = ? AND tipo = ?', [idPapeleria, tipo]);
  return f.ultimo;
}

// Registra en el kárdex un movimiento ya aplicado a la existencia del producto.
async function movimiento(conn, { idPapeleria, idProducto, tipo, cantidad, referencia, idUsuario }) {
  const [[p]] = await conn.query('SELECT existencia FROM productos WHERE id_producto = ?', [idProducto]);
  await conn.query(
    `INSERT INTO movimientos_inventario (id_papeleria, id_producto, tipo, cantidad, existencia, referencia, id_usuario)
     VALUES (?,?,?,?,?,?,?)`,
    [idPapeleria, idProducto, tipo, cantidad, p.existencia, referencia || null, idUsuario || null]);
}

// Bitácora: quién hizo qué. Nunca debe tumbar la operación principal.
async function bitacora(usuario, accion, detalle, { conn = pool, idPapeleria } = {}) {
  try {
    await conn.query('INSERT INTO bitacora (id_papeleria, id_usuario, accion, detalle) VALUES (?,?,?,?)',
      [idPapeleria !== undefined ? idPapeleria : usuario?.id_papeleria ?? null, usuario?.id ?? null, accion, String(detalle || '').slice(0, 255)]);
  } catch (err) {
    console.error('No se pudo escribir en la bitácora:', err.message);
  }
}

module.exports = { siguienteFolio, movimiento, bitacora };
