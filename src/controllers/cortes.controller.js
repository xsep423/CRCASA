// CAJA: cada empleado ABRE su caja contando el fondo con el que empieza (apertura), durante el turno
// anota las entradas y salidas de efectivo que no son ventas, y al terminar CIERRA con el corte:
// cuenta el efectivo y el sistema lo compara con lo que debería haber
//   efectivo esperado = fondo de apertura + ventas en efectivo + entradas - salidas
// Sin caja abierta no se pueden registrar ventas (ver ventas.controller).
const pool = require('../config/db');
const { HttpError, redondear } = require('../utils/http');
const { pid, esAdmin } = require('../middleware/auth');
const { siguienteFolio, bitacora } = require('../services/registro');
const { leerConfig } = require('../services/calculos');

// Billetes y monedas mexicanos que se cuentan en la caja
const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

// Valida un monto de efectivo capturado por el empleado
function monto(valor, nombre, { obligatorio = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obligatorio) throw new HttpError(400, `Escribe ${nombre}`);
    return 0;
  }
  const n = Number(valor);
  if (isNaN(n) || n < 0 || n > 1000000) throw new HttpError(400, `Cantidad inválida para ${nombre}`);
  return redondear(n);
}

// Desglose opcional de billetes y monedas: { "500": 1, "100": 3, ... }. Si viene, debe sumar el total.
function leerDesglose(desglose, total) {
  if (!desglose || typeof desglose !== 'object' || !Object.keys(desglose).length) return null;
  const limpio = {};
  let suma = 0;
  for (const [den, cant] of Object.entries(desglose)) {
    const d = Number(den);
    const c = Number(cant || 0);
    if (!DENOMINACIONES.includes(d)) throw new HttpError(400, `Denominación inválida: ${den}`);
    if (!Number.isInteger(c) || c < 0) throw new HttpError(400, `Cantidad inválida de piezas de $${den}`);
    if (c) { limpio[den] = c; suma += d * c; }
  }
  if (redondear(suma) !== redondear(total)) {
    throw new HttpError(400, `El desglose de billetes y monedas suma ${redondear(suma)} y no coincide con el total (${total})`);
  }
  return Object.keys(limpio).length ? JSON.stringify(limpio) : null;
}

// Caja abierta del empleado en la papelería (a lo más hay una)
async function turnoAbierto(conn, idPap, idUsuario, { bloquear = false } = {}) {
  const [rows] = await conn.query(
    `SELECT t.*, DATE(t.abierto_en) < CURDATE() AS de_otro_dia FROM turnos_caja t
     WHERE t.id_papeleria = ? AND t.id_usuario = ? AND t.estado = 'abierto'
     ORDER BY t.id_turno DESC LIMIT 1 ${bloquear ? 'FOR UPDATE' : ''}`, [idPap, idUsuario]);
  return rows[0] || null;
}

// Lo que lleva una caja: ventas por forma de pago, entradas, salidas y el efectivo que debería haber
async function resumenTurno(conn, turno) {
  const [[v]] = await conn.query(
    `SELECT COUNT(CASE WHEN estado <> 'cancelada' THEN 1 END) AS num_ventas,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'efectivo' THEN total END), 0) AS ventas_efectivo,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'tarjeta' THEN total END), 0) AS ventas_tarjeta,
            COALESCE(SUM(CASE WHEN estado <> 'cancelada' AND metodo_pago = 'transferencia' THEN total END), 0) AS ventas_transferencia,
            COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) AS canceladas
     FROM ventas WHERE id_turno = ?`, [turno.id_turno]);
  const [movimientos] = await conn.query(
    'SELECT id_movimiento, tipo, monto, motivo, fecha FROM movimientos_caja WHERE id_turno = ? ORDER BY id_movimiento', [turno.id_turno]);
  const suma = (tipo) => redondear(movimientos.filter((m) => m.tipo === tipo).reduce((s, m) => s + Number(m.monto), 0));
  const r = {
    id_turno: turno.id_turno,
    id_usuario: turno.id_usuario,
    abierto_en: turno.abierto_en,
    de_otro_dia: Boolean(Number(turno.de_otro_dia)),
    fondo_inicial: Number(turno.fondo_inicial),
    num_ventas: Number(v.num_ventas),
    canceladas: Number(v.canceladas),
    ventas_efectivo: Number(v.ventas_efectivo),
    ventas_tarjeta: Number(v.ventas_tarjeta),
    ventas_transferencia: Number(v.ventas_transferencia),
    entradas: suma('entrada'),
    salidas: suma('salida'),
    movimientos,
  };
  r.efectivo_esperado = redondear(r.fondo_inicial + r.ventas_efectivo + r.entradas - r.salidas);
  return r;
}

// GET /api/caja — estado de la caja del empleado
async function estado(req, res) {
  const t = await turnoAbierto(pool, pid(req), req.usuario.id);
  if (t) return res.json({ abierta: true, ...(await resumenTurno(pool, t)) });
  const [[ultimo]] = await pool.query(
    `SELECT hasta, efectivo_contado FROM cortes_caja WHERE id_papeleria = ? AND id_usuario = ?
     ORDER BY id_corte DESC LIMIT 1`, [pid(req), req.usuario.id]);
  res.json({
    abierta: false,
    fondo_sugerido: await leerConfig(pool, pid(req), 'fondo_caja_sugerido', 500),
    ultimo_corte: ultimo || null,
  });
}

// POST /api/caja/abrir  { fondo_inicial, desglose? } — el empleado cuenta con cuánto efectivo empieza
async function abrir(req, res) {
  const fondo = monto(req.body.fondo_inicial, 'con cuánto efectivo abres la caja');
  const desglose = leerDesglose(req.body.desglose, fondo);
  const turno = await pool.transaccion(async (conn) => {
    // Bloquea al empleado para que dos pestañas no abran dos cajas al mismo tiempo
    await conn.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ? FOR UPDATE', [req.usuario.id]);
    if (await turnoAbierto(conn, pid(req), req.usuario.id)) throw new HttpError(409, 'Ya tienes una caja abierta');
    await conn.query(
      'INSERT INTO turnos_caja (id_papeleria, id_usuario, abierto_en, fondo_inicial, desglose_apertura) VALUES (?,?,NOW(),?,?)',
      [pid(req), req.usuario.id, fondo, desglose]);
    await bitacora(req.usuario, 'Abrir caja', `Fondo inicial ${fondo}`, { conn });
    return turnoAbierto(conn, pid(req), req.usuario.id);
  });
  res.status(201).json({ mensaje: `Caja abierta con ${fondo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
    caja: { abierta: true, ...(await resumenTurno(pool, turno)) } });
}

// POST /api/caja/movimientos  { tipo: entrada|salida, monto, motivo }
// Efectivo que entra o sale de la caja sin ser venta: traen cambio, se paga un garrafón, el dueño retira...
async function movimiento(req, res) {
  const { tipo } = req.body;
  if (!['entrada', 'salida'].includes(tipo)) throw new HttpError(400, 'Indica si es entrada o salida de efectivo');
  const cantidad = monto(req.body.monto, 'el monto');
  if (cantidad <= 0) throw new HttpError(400, 'El monto debe ser mayor a 0');
  const motivo = String(req.body.motivo || '').trim();
  if (motivo.length < 3) throw new HttpError(400, 'Escribe el motivo del movimiento');
  const caja = await pool.transaccion(async (conn) => {
    const t = await turnoAbierto(conn, pid(req), req.usuario.id, { bloquear: true });
    if (!t) throw new HttpError(409, 'Abre tu caja primero');
    const r = await resumenTurno(conn, t);
    if (tipo === 'salida' && cantidad > r.efectivo_esperado) {
      throw new HttpError(400, `En la caja debería haber ${r.efectivo_esperado}; no alcanza para sacar ${cantidad}`);
    }
    await conn.query(
      'INSERT INTO movimientos_caja (id_turno, id_papeleria, id_usuario, tipo, monto, motivo) VALUES (?,?,?,?,?,?)',
      [t.id_turno, pid(req), req.usuario.id, tipo, cantidad, motivo.slice(0, 150)]);
    await bitacora(req.usuario, tipo === 'entrada' ? 'Entrada de efectivo' : 'Salida de efectivo', `${cantidad} · ${motivo}`, { conn });
    return resumenTurno(conn, t);
  });
  res.status(201).json({ mensaje: tipo === 'entrada' ? 'Entrada de efectivo registrada' : 'Salida de efectivo registrada', caja: { abierta: true, ...caja } });
}

// GET /api/caja/abiertas (admin) — quién tiene la caja abierta ahora y cuánto debería tener
async function abiertas(req, res) {
  const [turnos] = await pool.query(
    `SELECT t.*, DATE(t.abierto_en) < CURDATE() AS de_otro_dia, u.nombre AS empleado FROM turnos_caja t
     JOIN usuarios u ON u.id_usuario = t.id_usuario
     WHERE t.id_papeleria = ? AND t.estado = 'abierto' ORDER BY t.abierto_en`, [pid(req)]);
  res.json(await Promise.all(turnos.map(async (t) => ({ empleado: t.empleado, ...(await resumenTurno(pool, t)) }))));
}

// POST /api/cortes  { efectivo_contado, desglose?, notas? } — cierra la caja del empleado
async function crear(req, res) {
  const contado = monto(req.body.efectivo_contado, 'cuánto efectivo contaste en caja');
  const desglose = leerDesglose(req.body.desglose, contado);
  const id = await pool.transaccion(async (conn) => {
    const t = await turnoAbierto(conn, pid(req), req.usuario.id, { bloquear: true });
    if (!t) throw new HttpError(409, 'No tienes una caja abierta');
    const r = await resumenTurno(conn, t);
    const diferencia = redondear(contado - r.efectivo_esperado);
    const [[ahora]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora");
    const folio = await siguienteFolio(conn, pid(req), 'corte');
    const [ins] = await conn.query(
      `INSERT INTO cortes_caja (id_papeleria, folio, id_usuario, id_turno, desde, hasta, num_ventas, ventas_efectivo, ventas_tarjeta,
                                ventas_transferencia, canceladas, fondo_inicial, entradas, salidas, efectivo_esperado,
                                efectivo_contado, diferencia, desglose, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid(req), folio, req.usuario.id, t.id_turno, t.abierto_en, ahora.ahora, r.num_ventas, r.ventas_efectivo, r.ventas_tarjeta,
        r.ventas_transferencia, r.canceladas, r.fondo_inicial, r.entradas, r.salidas, r.efectivo_esperado,
        contado, diferencia, desglose, req.body.notas ? String(req.body.notas).slice(0, 255) : null]);
    await conn.query("UPDATE turnos_caja SET estado = 'cerrado', cerrado_en = ? WHERE id_turno = ?", [ahora.ahora, t.id_turno]);
    await bitacora(req.usuario, 'Corte de caja',
      `Corte ${folio}: esperado ${r.efectivo_esperado}, contado ${contado}, diferencia ${diferencia}`, { conn });
    return ins.insertId;
  });
  res.status(201).json({ mensaje: 'Corte registrado; tu caja quedó cerrada', corte: await obtenerCorte(pid(req), id) });
}

async function obtenerCorte(idPap, id) {
  const [rows] = await pool.query(
    `SELECT c.*, u.nombre AS empleado FROM cortes_caja c JOIN usuarios u ON u.id_usuario = c.id_usuario
     WHERE c.id_corte = ? AND c.id_papeleria = ?`, [id, idPap]);
  if (!rows.length) throw new HttpError(404, 'Corte no encontrado');
  const c = rows[0];
  if (c.id_turno) {
    [c.movimientos] = await pool.query(
      'SELECT tipo, monto, motivo, fecha FROM movimientos_caja WHERE id_turno = ? ORDER BY id_movimiento', [c.id_turno]);
  }
  return c;
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

module.exports = { DENOMINACIONES, turnoAbierto, estado, abrir, movimiento, abiertas, crear, listar, obtener };
