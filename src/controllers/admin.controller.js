// Papelerías, usuarios (empleados), configuración y resumen para el administrador
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { HttpError } = require('../utils/http');
const { pid } = require('../middleware/auth');
const { bitacora } = require('../services/registro');

const ROLES_VALIDOS = ['capturista', 'administrador', 'soporte'];

// ---------- PAPELERÍAS (cada negocio que usa el sistema) ----------
const CLASIFICACIONES_BASE = [
  ['Escolar', 'Cuadernos, lápices, plumas, colores y útiles escolares'],
  ['Oficina', 'Papel, carpetas, engrapadoras, folders y archivo'],
  ['Arte', 'Pinturas, pinceles, papel para dibujo y manualidades'],
  ['Accesorios de cómputo', 'Calculadoras, memorias USB, mouse y cables'],
];

function datosPapeleria({ nombre, giro, direccion, telefono, rfc }) {
  if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre de la papelería inválido');
  if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc)) throw new HttpError(400, 'RFC inválido');
  return [nombre.trim(), giro || null, direccion || null, telefono || null, rfc ? rfc.toUpperCase() : null];
}

const papelerias = {
  // GET /api/papeleria — datos de la papelería actual (para la nota de venta)
  async actual(req, res) {
    const [rows] = await pool.query(
      'SELECT id_papeleria, nombre, giro, direccion, telefono, rfc FROM papelerias WHERE id_papeleria = ?', [pid(req)]);
    res.json(rows[0] || {});
  },
  // GET /api/papelerias (soporte)
  async listar(req, res) {
    const [rows] = await pool.query(
      `SELECT p.*, (SELECT COUNT(*) FROM usuarios u WHERE u.id_papeleria = p.id_papeleria AND u.activo = 1) AS empleados
       FROM papelerias p ORDER BY p.activo DESC, p.nombre`);
    res.json(rows);
  },
  // POST /api/papelerias (soporte) — da de alta un negocio con sus reglas, cliente PG y clasificaciones base
  async crear(req, res) {
    const valores = datosPapeleria(req.body);
    const id = await pool.transaccion(async (conn) => {
      const [r] = await conn.query('INSERT INTO papelerias (nombre, giro, direccion, telefono, rfc) VALUES (?,?,?,?,?)', valores);
      const idPap = r.insertId;
      await conn.query('INSERT INTO configuracion (id_papeleria, clave, valor, descripcion) VALUES ?', [[
        [idPap, 'dias_vigencia_cotizacion', '15', 'Días de vigencia de una cotización'],
      ]]);
      await conn.query("INSERT INTO clientes (id_papeleria, codigo, nombre, porcentaje_descuento) VALUES (?, 'PG', 'Público en general', 0)", [idPap]);
      await conn.query('INSERT INTO clasificaciones (id_papeleria, nombre, descripcion) VALUES ?',
        [CLASIFICACIONES_BASE.map(([n, d]) => [idPap, n, d])]);
      return idPap;
    });
    await bitacora(req.usuario, 'Alta de papelería', valores[0], { idPapeleria: id });
    res.status(201).json({ mensaje: 'Papelería registrada', id });
  },
  // PUT /api/papelerias/:id (soporte)
  async actualizar(req, res) {
    const [r] = await pool.query(
      'UPDATE papelerias SET nombre=?, giro=?, direccion=?, telefono=?, rfc=?, activo=? WHERE id_papeleria=?',
      [...datosPapeleria(req.body), Number(req.body.activo ?? 1) ? 1 : 0, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Papelería no encontrada');
    res.json({ mensaje: 'Papelería actualizada' });
  },
};

// ---------- USUARIOS (solo soporte técnico; ve a los empleados de todas las papelerías) ----------
async function validarPapeleriaDeUsuario(rol, idPap) {
  if (rol === 'soporte') return null; // soporte atiende a todas
  if (!idPap) throw new HttpError(400, 'Selecciona la papelería del empleado');
  const [p] = await pool.query('SELECT 1 FROM papelerias WHERE id_papeleria = ?', [idPap]);
  if (!p.length) throw new HttpError(400, 'La papelería no existe');
  return Number(idPap);
}

const usuarios = {
  async listar(req, res) {
    const [rows] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.usuario, u.rol, u.activo, u.creado_en, u.id_papeleria, p.nombre AS papeleria
       FROM usuarios u LEFT JOIN papelerias p ON p.id_papeleria = u.id_papeleria
       ORDER BY u.activo DESC, p.nombre, u.nombre`);
    res.json(rows);
  },
  async crear(req, res) {
    const { nombre, usuario, password, rol = 'capturista' } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    if (!usuario || !/^[a-z0-9._]{3,40}$/i.test(usuario)) throw new HttpError(400, 'Usuario inválido (3 a 40 letras, números, punto o guion bajo)');
    if (!password || password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    if (!ROLES_VALIDOS.includes(rol)) throw new HttpError(400, 'Rol inválido');
    const idPap = await validarPapeleriaDeUsuario(rol, req.body.id_papeleria);
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,?)',
      [idPap, nombre.trim(), usuario.toLowerCase(), hash, rol]);
    await bitacora(req.usuario, 'Alta de usuario', `${usuario.toLowerCase()} (${rol})`, { idPapeleria: idPap });
    res.status(201).json({ mensaje: 'Usuario creado', id: r.insertId });
  },
  async actualizar(req, res) {
    const { nombre, rol, activo, password } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    if (!ROLES_VALIDOS.includes(rol)) throw new HttpError(400, 'Rol inválido');
    if (Number(req.params.id) === req.usuario.id && (rol !== 'soporte' || !Number(activo))) {
      throw new HttpError(400, 'No puedes quitarte el rol de soporte ni desactivarte a ti mismo');
    }
    const idPap = await validarPapeleriaDeUsuario(rol, req.body.id_papeleria);
    const campos = ['nombre = ?', 'rol = ?', 'activo = ?', 'id_papeleria = ?'];
    const valores = [nombre.trim(), rol, Number(activo) ? 1 : 0, idPap];
    if (password) {
      if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
      campos.push('password_hash = ?');
      valores.push(await bcrypt.hash(password, 10));
    }
    const [r] = await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id_usuario = ?`, [...valores, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Usuario no encontrado');
    await bitacora(req.usuario, 'Modificar usuario', `${nombre.trim()} (${rol}${Number(activo) ? '' : ', desactivado'}${password ? ', nueva contraseña' : ''})`, { idPapeleria: idPap });
    res.json({ mensaje: 'Usuario actualizado' });
  },
};

// ---------- CONFIGURACIÓN (de la papelería actual) ----------
const configuracion = {
  async obtener(req, res) {
    const [rows] = await pool.query('SELECT clave, valor FROM configuracion WHERE id_papeleria = ?', [pid(req)]);
    res.json(Object.fromEntries(rows.map((r) => [r.clave, Number(r.valor)])));
  },
  // PUT { dias_vigencia_cotizacion, fondo_caja_sugerido } (administrador)
  async actualizar(req, res) {
    const reglas = {
      dias_vigencia_cotizacion: (v) => Number.isInteger(v) && v >= 1 && v <= 90,
      fondo_caja_sugerido: (v) => v >= 0 && v <= 100000,
    };
    for (const [clave, valido] of Object.entries(reglas)) {
      if (req.body[clave] === undefined) continue;
      const v = Number(req.body[clave]);
      if (isNaN(v) || !valido(v)) throw new HttpError(400, `Valor inválido para ${clave}`);
      await pool.query(
        'INSERT INTO configuracion (id_papeleria, clave, valor) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
        [pid(req), clave, String(v)]);
      await bitacora(req.usuario, 'Cambiar regla', `${clave} = ${v}`);
    }
    res.json({ mensaje: 'Configuración guardada' });
  },
};

// ---------- RESUMEN (panel del administrador de la papelería actual) ----------
async function resumen(req, res) {
  const p = pid(req);
  const [[hoy]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS importe, COALESCE(SUM(descuento),0) AS descuentos
     FROM ventas WHERE id_papeleria = ? AND estado <> 'cancelada' AND DATE(fecha) = CURDATE()`, [p]);
  const [[mes]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS importe FROM ventas
     WHERE id_papeleria = ? AND estado <> 'cancelada' AND YEAR(fecha) = YEAR(CURDATE()) AND MONTH(fecha) = MONTH(CURDATE())`, [p]);
  const [[cot]] = await pool.query(
    "SELECT COUNT(*) AS vigentes FROM cotizaciones WHERE id_papeleria = ? AND estado = 'vigente' AND vigencia >= CURDATE()", [p]);
  const [[pend]] = await pool.query(
    "SELECT COUNT(*) AS pedidos FROM ventas WHERE id_papeleria = ? AND estado = 'pendiente_entrega'", [p]);
  const [bajos] = await pool.query(
    `SELECT codigo, nombre, existencia, existencia_minima FROM productos
     WHERE id_papeleria = ? AND activo = 1 AND existencia <= existencia_minima ORDER BY existencia LIMIT 20`, [p]);
  const [top] = await pool.query(
    `SELECT p.codigo, p.nombre, SUM(d.cantidad) AS piezas, SUM(d.importe) AS importe
     FROM detalle_venta d JOIN ventas v ON v.id_venta = d.id_venta JOIN productos p ON p.id_producto = d.id_producto
     WHERE v.id_papeleria = ? AND v.estado <> 'cancelada' AND v.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY p.id_producto, p.codigo, p.nombre ORDER BY piezas DESC LIMIT 5`, [p]);
  const [[cajas]] = await pool.query(
    "SELECT COUNT(*) AS abiertas FROM turnos_caja WHERE id_papeleria = ? AND estado = 'abierto'", [p]);
  res.json({ hoy, mes, cajas_abiertas: cajas.abiertas, cotizaciones_vigentes: cot.vigentes, pedidos_pendientes: pend.pedidos, bajo_minimo: bajos, mas_vendidos: top });
}

module.exports = { papelerias, usuarios, configuracion, resumen };
