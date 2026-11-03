// Usuarios (empleados), configuración y resumen para el administrador
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { HttpError } = require('../utils/http');

const ROLES_VALIDOS = ['capturista', 'administrador', 'soporte'];

// ---------- USUARIOS (solo soporte técnico) ----------
const usuarios = {
  async listar(req, res) {
    const [rows] = await pool.query(
      'SELECT id_usuario, nombre, usuario, rol, activo, creado_en FROM usuarios ORDER BY activo DESC, nombre');
    res.json(rows);
  },
  async crear(req, res) {
    const { nombre, usuario, password, rol = 'capturista' } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    if (!usuario || !/^[a-z0-9._]{3,40}$/i.test(usuario)) throw new HttpError(400, 'Usuario inválido (3 a 40 letras, números, punto o guion bajo)');
    if (!password || password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    if (!ROLES_VALIDOS.includes(rol)) throw new HttpError(400, 'Rol inválido');
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)',
      [nombre.trim(), usuario.toLowerCase(), hash, rol]);
    res.status(201).json({ mensaje: 'Usuario creado', id: r.insertId });
  },
  async actualizar(req, res) {
    const { nombre, rol, activo, password } = req.body;
    if (!nombre || nombre.trim().length < 3) throw new HttpError(400, 'Nombre inválido');
    if (!ROLES_VALIDOS.includes(rol)) throw new HttpError(400, 'Rol inválido');
    if (Number(req.params.id) === req.usuario.id && (rol !== 'soporte' || !Number(activo))) {
      throw new HttpError(400, 'No puedes quitarte el rol de soporte ni desactivarte a ti mismo');
    }
    const campos = ['nombre = ?', 'rol = ?', 'activo = ?'];
    const valores = [nombre.trim(), rol, Number(activo) ? 1 : 0];
    if (password) {
      if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
      campos.push('password_hash = ?');
      valores.push(await bcrypt.hash(password, 10));
    }
    const [r] = await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id_usuario = ?`, [...valores, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ mensaje: 'Usuario actualizado' });
  },
};

// ---------- CONFIGURACIÓN ----------
const configuracion = {
  async obtener(req, res) {
    const [rows] = await pool.query('SELECT clave, valor, descripcion FROM configuracion');
    res.json(Object.fromEntries(rows.map((r) => [r.clave, Number(r.valor)])));
  },
  // PUT { tope_descuento, dias_vigencia_cotizacion } (administrador)
  async actualizar(req, res) {
    const reglas = {
      tope_descuento: (v) => v >= 0 && v <= 100,
      dias_vigencia_cotizacion: (v) => Number.isInteger(v) && v >= 1 && v <= 90,
    };
    for (const [clave, valido] of Object.entries(reglas)) {
      if (req.body[clave] === undefined) continue;
      const v = Number(req.body[clave]);
      if (isNaN(v) || !valido(v)) throw new HttpError(400, `Valor inválido para ${clave}`);
      await pool.query('UPDATE configuracion SET valor = ? WHERE clave = ?', [String(v), clave]);
    }
    res.json({ mensaje: 'Configuración guardada' });
  },
};

// ---------- RESUMEN (panel del administrador) ----------
async function resumen(req, res) {
  const [[hoy]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS importe, COALESCE(SUM(descuento),0) AS descuentos
     FROM ventas WHERE estado <> 'cancelada' AND DATE(fecha) = CURDATE()`);
  const [[mes]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS importe FROM ventas
     WHERE estado <> 'cancelada' AND YEAR(fecha) = YEAR(CURDATE()) AND MONTH(fecha) = MONTH(CURDATE())`);
  const [[cot]] = await pool.query(
    "SELECT COUNT(*) AS vigentes FROM cotizaciones WHERE estado = 'vigente' AND vigencia >= CURDATE()");
  const [[pend]] = await pool.query("SELECT COUNT(*) AS pedidos FROM ventas WHERE estado = 'pendiente_entrega'");
  const [bajos] = await pool.query(
    `SELECT codigo, nombre, existencia, existencia_minima FROM productos
     WHERE activo = 1 AND existencia <= existencia_minima ORDER BY existencia LIMIT 20`);
  const [top] = await pool.query(
    `SELECT p.codigo, p.nombre, SUM(d.cantidad) AS piezas, SUM(d.importe) AS importe
     FROM detalle_venta d JOIN ventas v ON v.id_venta = d.id_venta JOIN productos p ON p.id_producto = d.id_producto
     WHERE v.estado <> 'cancelada' AND v.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY p.id_producto ORDER BY piezas DESC LIMIT 5`);
  res.json({ hoy, mes, cotizaciones_vigentes: cot.vigentes, pedidos_pendientes: pend.pedidos, bajo_minimo: bajos, mas_vendidos: top });
}

module.exports = { usuarios, configuracion, resumen };
