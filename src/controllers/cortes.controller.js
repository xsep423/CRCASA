// CORTE DE CAJA: al cerrar su turno, el empleado cuenta el efectivo y el sistema lo compara
// con lo que debería haber (fondo inicial + ventas en efectivo del turno).
const pool = require('../config/db');
const { HttpError, redondear } = require('../utils/http');
const { pid, esAdmin } = require('../middleware/auth');
const { siguienteFolio, bitacora } = require('../services/registro');

// El turno de un empleado empieza al terminar su último corte del día (o a las 00:00 si no ha hecho ninguno)
async function turnoActual(conn, idPap, idUsuario) {
  const [[ultimo]] = await conn.query(
    `SELECT MAX(hasta) AS hasta FROM cortes_caja
     WHERE id_papeleria = ? AND id_usuario = ? AND hasta >= CURDATE()`, [idPap, idUsuario]);
  const [[ahora]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora, DATE_FORMAT(CURDATE(), '%Y-%m-%d 00:00:00') AS hoy");
  const desde = ultimo.hasta || ahora.hoy;
  const [[v]] = await conn.query(
    `SELECT COUNT(CASE WHEN estado <> 'cancelada' THEN 1 END) AS num_ventas,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'efectivo' THEN total END), 0) AS ventas_efectivo,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'tarjeta' THEN total END), 0) AS ventas_tarjeta,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'transferencia' THEN total END), 0) AS ventas_transferencia,
            COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) AS canceladas
     FROM ventas WHERE id_papeleria = ? AND id_usuario = ? AND fecha > ? AND fecha <= ?`,
    [idPap, idUsuario, desde, ahora.ahora]);
  return {
    desde, hasta: ahora.ahora,
    num_ventas: Number(v.num_ventas), canceladas: Number(v.canceladas),
    ventas_efectivo: Number(v.ventas_efectivo), ventas_tarjeta: Number(v.ventas_tarjeta),
    ventas_transferencia: Number(v.ventas_transferencia),
  };
}

// GET /api/cortes/actual — lo que lleva el turno del empleado (antes de cerrar)
async function actual(req, res) {
  res.json(await turnoActual(pool, pid(req), req.usuario.id));
}

// POST /api/cortes  { fondo_inicial, efectivo_contado, notas? }
async function crear(req, res) {
  const fondo = Number(req.body.fondo_inicial || 0);
  const contado = Number(req.body.efectivo_contado);
  if (isNaN(fondo) || fondo < 0) throw new HttpError(400, 'Fondo inicial inválido');
  if (req.body.efectivo_contado === undefined || req.body.efectivo_contado === '' || isNaN(contado) || contado < 0) {
    throw new HttpError(400, 'Escribe cuánto efectivo contaste en caja');
  }
  const id = await pool.transaccion(async (conn) => {
    const t = await turnoActual(conn, pid(req), req.usuario.id);
    const esperado = redondear(fondo + t.ventas_efectivo);
    const diferencia = redondear(contado - esperado);
    const folio = await siguienteFolio(conn, pid(req), 'corte');
    const [r] = await conn.query(
      `INSERT INTO cortes_caja (id_papeleria, folio, id_usuario, desde, hasta, num_ventas, ventas_efectivo, ventas_tarjeta,
                                ventas_transferencia, canceladas, fondo_inicial, efectivo_esperado, efectivo_contado, diferencia, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid(req), folio, req.usuario.id, t.desde, t.hasta, t.num_ventas, t.ventas_efectivo, t.ventas_tarjeta,
        t.ventas_transferencia, t.canceladas, fondo, esperado, contado, diferencia, req.body.notas ? String(req.body.notas).slice(0, 255) : null]);
    await bitacora(req.usuario, 'Corte de caja',
      `Corte ${folio}: esperado ${esperado}, contado ${contado}, diferencia ${diferencia}`, { conn });
    return r.insertId;
  });
  res.status(201).json({ mensaje: 'Corte de caja registrado', corte: await obtenerCorte(pid(req), id) });
}

async function obtenerCorte(idPap, id) {
  const [rows] = await pool.query(
    `SELECT c.*, u.nombre AS empleado FROM cortes_caja c JOIN usuarios u ON u.id_usuario = c.id_usuario
     WHERE c.id_corte = ? AND c.id_papeleria = ?`, [id, idPap]);
  if (!rows.length) throw new HttpError(404, 'Corte no encontrado');
  return rows[0];
}

// GET /api/cortes — el capturista ve los suyos; el administrador, los de toda la papelería
async function listar(req, res) {
  const params = [pid(req)];
  let sql = `SELECT c.*, u.nombre AS empleado FROM cortes_caja c JOIN usuarios u ON u.id_usuario = c.id_usuario
             WHERE c.id_papeleria = ?`;
  if (!esAdmin(req.usuario)) { sql += ' AND c.id_usuario = ?'; params.push(req.usuario.id); }
  sql += ' ORDER BY c.id_corte DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}

async function obtener(req, res) {
  const c = await obtenerCorte(pid(req), req.params.id);
  if (!esAdmin(req.usuario) && c.id_usuario !== req.usuario.id) throw new HttpError(404, 'Corte no encontrado');
  res.json(c);
}

module.exports = { actual, crear, listar, obtener };
