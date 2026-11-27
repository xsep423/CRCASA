// SIMULACIÓN DE USO: llena la base con varias semanas de operación realista de cada papelería
// para probar el sistema y mostrar los reportes con datos.
//
//  - Catálogo de 112 productos repartidos en las 4 clasificaciones, con 5 proveedores
//  - Clientes frecuentes (escuelas, despachos, particulares) y 2 cajeros por papelería (turno mañana y tarde)
//  - Cada día (lunes a sábado): apertura de caja con fondo, ventas de mostrador y a clientes, cobro con cambio,
//    pedidos para recoger, cotizaciones (unas se convierten en venta, otras vencen), solicitudes de factura,
//    cancelaciones, salidas y retiros de efectivo, compras a proveedores para reabastecer y corte de caja.
//  - Todo respeta las reglas del sistema: kárdex con la existencia resultante, folios consecutivos por papelería,
//    descuento del cliente, cambio, efectivo esperado del corte y bitácora.
//  - Hoy se simula hasta la hora actual: la caja del turno en curso queda ABIERTA.
//
// Uso:
//   npm run simular                                   -> base de .env, papelerías 1, 2 y 3, últimos 30 días
//   npm run simular -- --env .env.tidb --reiniciar    -> base de la nube, borrando primero la operación anterior
//   Opciones: --dias 30  --papelerias 1,2  --semilla 2026  --reiniciar
//
// --reiniciar BORRA las ventas, cotizaciones, compras, cajas, cortes, kárdex y bitácora de esas papelerías
// (los productos, clientes, proveedores y usuarios se conservan). Sin esa opción, si la papelería ya tiene
// operaciones, no se toca.
const path = require('path');
const args = process.argv.slice(2);
const opcion = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : def; };
const bandera = (n) => args.includes(`--${n}`);
require('dotenv').config({ path: path.resolve(__dirname, '..', opcion('env', '.env')) });
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { PROVEEDORES, CATALOGO, CLIENTES, CAJEROS, SALIDAS } = require('./datos-simulacion');

const DIAS = Number(opcion('dias', 30));
const PAPELERIAS = opcion('papelerias', '1,2,3').split(',').map(Number);
const REINICIAR = bandera('reiniciar');
const PASS_CAJERO = 'Caja2026xx';
const PASS_ADMIN = 'Admin2026x';
const VENCIDA = 'Venció su vigencia sin convertirse en venta';

// ---------- Azar reproducible (misma semilla = misma simulación) ----------
let semilla = Number(opcion('semilla', 2026)) >>> 0;
function azar() {
  semilla = (semilla + 0x6D2B79F5) >>> 0;
  let t = semilla;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (arr) => arr[Math.floor(azar() * arr.length)];
const prob = (p) => azar() < p;
function elegirPeso(arr, peso) {
  const total = arr.reduce((s, x) => s + peso(x), 0);
  let r = azar() * total;
  for (const x of arr) { r -= peso(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
}
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= azar(); } while (p > L);
  return k - 1;
}
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// ---------- Fechas (en la hora local de la papelería) ----------
const dos = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
const fmtDia = (d) => fmt(d).slice(0, 10);
const leer = (s) => { const [f, h = '00:00:00'] = s.split(' '); const [y, m, d] = f.split('-').map(Number); const [hh, mi, ss] = h.split(':').map(Number); return new Date(y, m - 1, d, hh, mi, ss); };
const masMin = (d, min) => new Date(d.getTime() + min * 60000);
const aLas = (dia, h, m = 0) => new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, m, entre(0, 59));

// ---------- Efectivo: desglose en billetes y monedas ----------
function desglosar(monto, topes = {}) {
  let resto = Math.round(monto * 2); // en medios pesos
  const d = {};
  for (const den of [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]) {
    const v = Math.round(den * 2);
    let n = Math.floor(resto / v);
    if (topes[den] !== undefined) n = Math.min(n, topes[den]);
    if (n > 0) { d[den] = n; resto -= n * v; }
  }
  return JSON.stringify(d);
}
// el fondo de caja es "morralla": billetes chicos y monedas para dar cambio
const desgloseFondo = (m) => desglosar(m, { 1000: 0, 500: 0, 200: 1, 100: 1, 50: 2, 20: 5, 10: 6, 5: 8 });
// lo que paga el cliente: el billete con que normalmente se paga ese total
function pagoCon(total) {
  const r = azar();
  if (r < 0.12) return total;
  const opciones = [Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100,
    ...[200, 500, 1000].filter((b) => b >= total)].filter((x) => x >= total);
  return r < 0.4 ? opciones[0] : r < 0.65 ? opciones[Math.min(1, opciones.length - 1)] : elegir(opciones);
}

async function insertar(conn, tabla, columnas, filas) {
  const mala = filas.find((f) => f.some((x) => typeof x === 'number' && !Number.isFinite(x)));
  if (mala) throw new Error(`Dato inválido para ${tabla}: ${JSON.stringify(mala)}`);
  for (let i = 0; i < filas.length; i += 400) {
    await conn.query(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ?`, [filas.slice(i, i + 400)]);
  }
}

// =====================================================================================
async function simularPapeleria(conn, idPap, ahora) {
  const [[pap]] = await conn.query('SELECT id_papeleria, nombre FROM papelerias WHERE id_papeleria = ?', [idPap]);
  if (!pap) { console.log(`La papelería ${idPap} no existe; se omite.`); return null; }
  const [[ops]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM ventas WHERE id_papeleria = ?) + (SELECT COUNT(*) FROM compras WHERE id_papeleria = ?)
          + (SELECT COUNT(*) FROM cotizaciones WHERE id_papeleria = ?) + (SELECT COUNT(*) FROM turnos_caja WHERE id_papeleria = ?) AS n`,
    [idPap, idPap, idPap, idPap]);
  if (Number(ops.n) && !REINICIAR) {
    console.log(`"${pap.nombre}" ya tiene ${ops.n} operaciones. Usa --reiniciar para borrarlas y simular de nuevo; se omite.`);
    return null;
  }
  console.log(`\n=== ${pap.nombre} ===`);
  await conn.beginTransaction();

  if (REINICIAR) {
    const borrar = [
      'DELETE FROM solicitudes_factura WHERE id_venta IN (SELECT id_venta FROM ventas WHERE id_papeleria = ?)',
      'DELETE FROM detalle_venta WHERE id_venta IN (SELECT id_venta FROM ventas WHERE id_papeleria = ?)',
      'DELETE FROM ventas WHERE id_papeleria = ?',
      'DELETE FROM detalle_cotizacion WHERE id_cotizacion IN (SELECT id_cotizacion FROM cotizaciones WHERE id_papeleria = ?)',
      'DELETE FROM cotizaciones WHERE id_papeleria = ?',
      'DELETE FROM detalle_compra WHERE id_compra IN (SELECT id_compra FROM compras WHERE id_papeleria = ?)',
      'DELETE FROM compras WHERE id_papeleria = ?',
      'DELETE FROM movimientos_caja WHERE id_papeleria = ?',
      'DELETE FROM cortes_caja WHERE id_papeleria = ?',
      'DELETE FROM turnos_caja WHERE id_papeleria = ?',
      'DELETE FROM movimientos_inventario WHERE id_papeleria = ?',
      'DELETE FROM bitacora WHERE id_papeleria = ?',
      "DELETE FROM folios WHERE id_papeleria = ? AND tipo IN ('venta','cotizacion','compra','corte')",
    ];
    for (const q of borrar) await conn.query(q, [idPap]);
    console.log('Operación anterior borrada (catálogos y usuarios se conservan).');
  }

  // ---------- Catálogos ----------
  const [cfg] = await conn.query('SELECT clave, valor FROM configuracion WHERE id_papeleria = ?', [idPap]);
  const config = Object.fromEntries(cfg.map((c) => [c.clave, Number(c.valor)]));
  const diasVigencia = config.dias_vigencia_cotizacion || 15;
  const fondoSugerido = config.fondo_caja_sugerido ?? 500;

  for (const nombre of Object.keys(CATALOGO)) {
    await conn.query('INSERT IGNORE INTO clasificaciones (id_papeleria, nombre) VALUES (?,?)', [idPap, nombre]);
  }
  const [clas] = await conn.query('SELECT id_clasificacion, nombre FROM clasificaciones WHERE id_papeleria = ?', [idPap]);
  const idClas = Object.fromEntries(clas.map((c) => [c.nombre, c.id_clasificacion]));

  const idProv = {};
  for (const [clave, p] of Object.entries(PROVEEDORES)) {
    const [ya] = await conn.query('SELECT id_proveedor FROM proveedores WHERE id_papeleria = ? AND nombre = ?', [idPap, p.nombre]);
    if (ya.length) { idProv[clave] = ya[0].id_proveedor; continue; }
    const [r] = await conn.query('INSERT INTO proveedores (id_papeleria, nombre, contacto, telefono, email, rfc) VALUES (?,?,?,?,?,?)',
      [idPap, p.nombre, p.contacto, p.telefono, p.email, p.rfc]);
    idProv[clave] = r.insertId;
  }

  const factorPrecio = { 1: 1, 2: 1.05, 3: 0.95 }[idPap] || 1;
  const popularidad = {};
  const [existentes] = await conn.query('SELECT codigo FROM productos WHERE id_papeleria = ?', [idPap]);
  const yaHay = new Set(existentes.map((p) => p.codigo));
  const nuevos = [];
  for (const [cat, lista] of Object.entries(CATALOGO)) {
    for (const [codigo, nombre, desc, precio, costo, minima, prov, pop] of lista) {
      popularidad[codigo] = pop;
      if (yaHay.has(codigo)) continue;
      nuevos.push([idPap, codigo, nombre, desc, Math.round(precio * factorPrecio * 2) / 2, costo, 0, minima, idClas[cat], idProv[prov]]);
    }
  }
  await insertar(conn, 'productos', ['id_papeleria', 'codigo', 'nombre', 'descripcion', 'precio_venta', 'costo', 'existencia',
    'existencia_minima', 'id_clasificacion', 'id_proveedor'], nuevos);
  const [prods] = await conn.query(
    `SELECT p.id_producto, p.codigo, p.nombre, p.precio_venta, p.costo, p.existencia, p.existencia_minima, p.id_proveedor, c.nombre AS clasificacion
     FROM productos p JOIN clasificaciones c ON c.id_clasificacion = p.id_clasificacion WHERE p.id_papeleria = ? AND p.activo = 1`, [idPap]);
  const productos = prods.map((p) => ({ ...p, precio: Number(p.precio_venta), costo: Number(p.costo), pop: popularidad[p.codigo] || 0 }));
  const vendibles = productos.filter((p) => p.pop > 0);
  console.log(`Productos: ${productos.length} (${nuevos.length} nuevos) · proveedores: ${Object.keys(idProv).length}`);

  // ---------- Clientes ----------
  const [cods] = await conn.query("SELECT MAX(CAST(SUBSTRING(codigo, 3) AS UNSIGNED)) AS n FROM clientes WHERE id_papeleria = ? AND codigo REGEXP '^C-[0-9]+$'", [idPap]);
  let sigCliente = Number(cods[0].n || 0);
  let clientesNuevos = 0;
  for (const [nombre, tel, email, rfc, pct] of CLIENTES[idPap] || []) {
    const [ya] = await conn.query('SELECT id_cliente FROM clientes WHERE id_papeleria = ? AND nombre = ?', [idPap, nombre]);
    if (ya.length) continue;
    sigCliente++;
    clientesNuevos++;
    await conn.query('INSERT INTO clientes (id_papeleria, codigo, nombre, telefono, email, rfc, porcentaje_descuento) VALUES (?,?,?,?,?,?,?)',
      [idPap, `C-${String(sigCliente).padStart(4, '0')}`, nombre, tel, email, rfc, pct]);
  }
  const [clis] = await conn.query('SELECT id_cliente, codigo, nombre, rfc, porcentaje_descuento FROM clientes WHERE id_papeleria = ? AND activo = 1', [idPap]);
  const pg = clis.find((c) => c.codigo === 'PG');
  if (!pg) throw new Error(`La papelería ${idPap} no tiene el cliente PG (público en general)`);
  pg.pct = Number(pg.porcentaje_descuento);
  const registrados = clis.filter((c) => !['PG', 'C-PRUEBA'].includes(c.codigo)).map((c) => ({ ...c, pct: Number(c.porcentaje_descuento) }));
  console.log(`Clientes registrados: ${registrados.length} (${clientesNuevos} nuevos)`);

  // ---------- Empleados ----------
  const creados = [];
  let [[admin]] = await conn.query("SELECT id_usuario, nombre FROM usuarios WHERE id_papeleria = ? AND rol = 'administrador' AND activo = 1 ORDER BY id_usuario LIMIT 1", [idPap]);
  if (!admin) {
    const usuario = `admin${idPap}`;
    await conn.query("INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,'administrador')",
      [idPap, `Dueño ${pap.nombre}`, usuario, await bcrypt.hash(PASS_ADMIN, 10)]);
    [[admin]] = await conn.query('SELECT id_usuario, nombre FROM usuarios WHERE usuario = ?', [usuario]);
    creados.push(`${usuario} / ${PASS_ADMIN} (administrador)`);
  }
  const cajeros = [];
  for (const [usuario, nombre] of CAJEROS[idPap] || [[`caja${idPap}`, 'Cajero mañana'], [`caja${idPap}t`, 'Cajero tarde']]) {
    let [[u]] = await conn.query('SELECT id_usuario, id_papeleria, nombre FROM usuarios WHERE usuario = ?', [usuario]);
    if (!u) {
      await conn.query("INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,'capturista')",
        [idPap, nombre, usuario, await bcrypt.hash(PASS_CAJERO, 10)]);
      [[u]] = await conn.query('SELECT id_usuario, id_papeleria, nombre FROM usuarios WHERE usuario = ?', [usuario]);
      creados.push(`${usuario} / ${PASS_CAJERO} (capturista)`);
    }
    if (u.id_papeleria !== idPap) { console.log(`  El usuario ${usuario} es de otra papelería; se omite.`); continue; }
    cajeros.push({ id: u.id_usuario, nombre: u.nombre, usuario });
  }
  if (!cajeros.length) throw new Error('No hay cajeros para simular');
  const cajeroDe = (turno) => cajeros[turno % cajeros.length];

  // ---------- Buffers de lo que se va a guardar ----------
  const folio = { venta: 0, cotizacion: 0, compra: 0, corte: 0 };
  const turnos = [], ventas = [], cotizaciones = [], compras = [], cortes = [], movCaja = [], solicitudes = [];
  const kardex = [], bitacora = [];
  const bit = (fecha, idUsuario, accion, detalle) => bitacora.push([idPap, idUsuario, accion, String(detalle).slice(0, 255), fmt(fecha)]);
  const mov = (fecha, p, tipo, cantidad, referencia, idUsuario) => {
    p.existencia += cantidad;
    kardex.push([idPap, p.id_producto, tipo, cantidad, p.existencia, referencia, idUsuario, fmt(fecha)]);
  };

  // ---------- Existencia inicial ----------
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - DIAS);
  for (const p of productos) {
    const base = p.pop > 0 ? Math.round(p.existencia_minima * (2.2 + azar() * 1.8)) + entre(0, 4) : p.existencia;
    p.existencia = 0;
    mov(aLas(inicio, 7, 30), p, 'inicial', base, 'Existencia inicial', admin.id_usuario);
  }

  // ---------- Operaciones ----------
  const partidaDe = (p, cantidad, precio = p.precio) => ({ p, cantidad, precio, importe: r2(precio * cantidad) });
  const totales = (lineas, pct) => {
    const subtotal = r2(lineas.reduce((s, l) => s + l.importe, 0));
    const descuento = r2(subtotal * pct / 100);
    return { subtotal, descuento, total: r2(subtotal - descuento) };
  };

  function armarCarrito(cliente) {
    const mayoreo = cliente.pct >= 8 && prob(0.55);
    const n = mayoreo ? entre(3, 7) : elegirPeso([1, 2, 3, 4, 5], (k) => [46, 28, 14, 8, 4][k - 1]);
    const lista = mayoreo ? vendibles.filter((p) => p.clasificacion !== 'Accesorios de cómputo' && p.pop >= 4) : vendibles;
    const usados = new Map();
    for (let i = 0; i < n; i++) {
      const p = elegirPeso(lista, (x) => x.pop * x.pop);
      let cant;
      if (mayoreo) cant = p.precio < 15 ? entre(10, 40) : entre(4, 15);
      else if (p.precio < 10) cant = elegirPeso([1, 2, 3, 4, 5, 6, 10], (k) => ({ 1: 30, 2: 22, 3: 15, 4: 8, 5: 8, 6: 5, 10: 3 }[k]));
      else if (p.precio < 60) cant = elegirPeso([1, 2, 3], (k) => [70, 22, 8][k - 1]);
      else cant = prob(0.92) ? 1 : 2;
      usados.set(p, (usados.get(p) || 0) + cant);
    }
    return { mayoreo, lineas: [...usados].map(([p, c]) => ({ p, cantidad: c })) };
  }

  // Registra una venta (resta existencia con kárdex). Las cantidades se ajustan a lo que hay, como haría el capturista.
  function vender(fecha, turno, cliente, pedido, { cotizacion = null, metodo, mayoreo = false } = {}) {
    const lineas = [];
    for (const l of pedido) {
      const cant = Math.min(l.cantidad, l.p.existencia);
      if (cant > 0) lineas.push(partidaDe(l.p, cant, l.precio ?? l.p.precio));
    }
    if (!lineas.length) return null;
    const pct = cotizacion ? cotizacion.pct : cliente.pct;
    const t = totales(lineas, pct);
    if (!metodo) {
      const r = azar();
      metodo = cliente === pg ? (r < 0.66 ? 'efectivo' : r < 0.93 ? 'tarjeta' : 'transferencia')
        : mayoreo ? (r < 0.25 ? 'efectivo' : r < 0.45 ? 'tarjeta' : 'transferencia')
          : (r < 0.45 ? 'efectivo' : r < 0.75 ? 'tarjeta' : 'transferencia');
    }
    let pago = null, cambio = null;
    if (metodo === 'efectivo' && prob(0.88)) { pago = pagoCon(t.total); cambio = r2(pago - t.total); }
    const recoger = cliente === pg ? prob(0.02) : prob(mayoreo ? 0.3 : 0.1);
    folio.venta++;
    const v = {
      folio: folio.venta, fecha, turno, cliente, lineas, ...t, pct, metodo, pago, cambio,
      tipo_entrega: recoger ? 'recoger' : 'mostrador', estado: recoger ? 'pendiente_entrega' : 'pagada', cotizacion,
    };
    ventas.push(v);
    for (const l of lineas) mov(fecha, l.p, 'venta', -l.cantidad, `Venta ${v.folio}`, turno.cajero.id);
    if (metodo === 'efectivo') turno.efectivo += v.total;
    turno.ventas.push(v);
    // a veces el cliente pide factura (solo clientes registrados con RFC)
    if (cliente.rfc && cliente !== pg && prob(mayoreo ? 0.6 : 0.25)) {
      const moral = cliente.rfc.length === 12;
      solicitudes.push({ venta: v, rfc: cliente.rfc, razon: cliente.nombre.toUpperCase(), uso: moral ? 'G03' : elegir(['G03', 'G01']),
        regimen: moral ? '601' : elegir(['612', '626']), cp: String(entre(22000, 22650)), fecha: masMin(fecha, entre(1, 20)), usuario: turno.cajero.id });
      bit(masMin(fecha, 1), turno.cajero.id, 'Solicitud de factura', `Venta ${v.folio} · RFC ${cliente.rfc}`);
      v.factura = true;
    }
    return v;
  }

  function cancelarVenta(fecha, v) {
    if (v.estado === 'cancelada' || v.factura) return;
    for (const l of v.lineas) mov(fecha, l.p, 'cancelacion', l.cantidad, `Cancelación venta ${v.folio}`, admin.id_usuario);
    v.estado = 'cancelada';
    if (v.metodo === 'efectivo') v.turno.efectivo -= v.total;
    bit(fecha, admin.id_usuario, 'Cancelar venta', `Venta ${v.folio}`);
  }

  function cotizar(fecha, turno, cliente) {
    const { lineas } = armarCarrito({ ...cliente, pct: Math.max(cliente.pct, 8) });
    const partidas = lineas.map((l) => partidaDe(l.p, Math.max(l.cantidad, entre(2, 12))));
    folio.cotizacion++;
    const vig = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + diasVigencia);
    const c = { folio: folio.cotizacion, fecha, cliente, usuario: turno.cajero.id, pct: cliente.pct, partidas,
      ...totales(partidas, cliente.pct), vigencia: fmtDia(vig), estado: 'vigente', motivo: null };
    cotizaciones.push(c);
    const r = azar();
    if (r < 0.45) {
      const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + entre(0, Math.min(5, diasVigencia)));
      (porConvertir[fmtDia(dia)] ||= []).push(c);
    } else if (r < 0.62) {
      c.cancelarEl = masMin(fecha, entre(60 * 24, 60 * 24 * 6));
    }
    return c;
  }

  function convertir(fecha, turno, c) {
    if (c.estado !== 'vigente' || fmtDia(fecha) > c.vigencia) return;
    // si falta mercancía, el capturista ajusta la cantidad (o quita el producto) antes de convertir
    const pedido = c.partidas.map((l) => ({ p: l.p, cantidad: Math.min(l.cantidad, l.p.existencia), precio: l.precio })).filter((l) => l.cantidad > 0);
    if (!pedido.length) return;
    if (pedido.length !== c.partidas.length || pedido.some((l, i) => l.cantidad !== c.partidas[i].cantidad)) {
      c.partidas = pedido.map((l) => partidaDe(l.p, l.cantidad, l.precio));
      Object.assign(c, totales(c.partidas, c.pct));
    }
    const v = vender(fecha, turno, c.cliente, pedido, { cotizacion: c, mayoreo: true });
    if (v) c.estado = 'convertida';
  }

  // Compra a un proveedor de lo que está en o debajo del mínimo (lo mismo que sugiere el sistema)
  function reabastecer(fecha, { soloUrgente = false } = {}) {
    const bajos = productos.filter((p) => p.pop > 0 && p.existencia <= p.existencia_minima);
    const porProv = new Map();
    for (const p of bajos) (porProv.get(p.id_proveedor) || porProv.set(p.id_proveedor, []).get(p.id_proveedor)).push(p);
    for (const [prov, lista] of porProv) {
      const urgente = lista.some((p) => p.pop >= 7 && p.existencia <= p.existencia_minima / 2);
      if (soloUrgente ? !urgente : lista.length < 3 && !urgente) continue; // pedidos chicos se juntan para el siguiente
      folio.compra++;
      const lineas = lista.map((p) => {
        let cant = Math.max(p.existencia_minima * 3 - p.existencia, p.existencia_minima);
        cant = cant >= 20 ? Math.ceil(cant / 10) * 10 : cant;
        const costo = r2(p.costo * (prob(0.15) ? 1 + entre(2, 6) / 100 : 1));
        return { p, cantidad: cant, costo, importe: r2(cant * costo) };
      });
      const total = r2(lineas.reduce((s, l) => s + l.importe, 0));
      const c = { folio: folio.compra, prov, fecha, lineas, total, folioProv: `${elegir(['F', 'A', 'FAC'])}-${entre(1000, 99999)}` };
      compras.push(c);
      for (const l of lineas) { mov(fecha, l.p, 'compra', l.cantidad, `Compra ${c.folio}`, admin.id_usuario); l.p.costo = l.costo; }
      bit(fecha, admin.id_usuario, 'Registrar compra', `Compra ${c.folio} · total ${total}`);
      fecha = new Date(fecha.getTime() + 1000); // una compra tras otra, en el mismo momento
    }
  }

  function abrirTurno(fecha, cajero) {
    const fondo = prob(0.85) ? fondoSugerido : fondoSugerido + elegir([-50, -20, 20, 50, 100]);
    const t = { ref: turnos.length, cajero, abierto: fecha, fondo, desglose: desgloseFondo(fondo), efectivo: fondo, ventas: [], movs: [], estado: 'abierto', cerrado: null };
    turnos.push(t);
    bit(fecha, cajero.id, 'Abrir caja', `Fondo inicial ${fondo}`);
    return t;
  }

  function movimientoCaja(fecha, t, tipo, monto, motivo) {
    if (tipo === 'salida' && monto > t.efectivo) return;
    t.movs.push({ tipo, monto, motivo, fecha });
    t.efectivo += tipo === 'entrada' ? monto : -monto;
    bit(fecha, t.cajero.id, tipo === 'entrada' ? 'Entrada de efectivo' : 'Salida de efectivo', `${monto} · ${motivo}`);
  }

  function cerrarTurno(fecha, t) {
    const esperado = r2(t.efectivo);
    const r = azar();
    const dif = r < 0.78 ? 0 : r < 0.9 ? -elegir([0.5, 1, 2, 5, 10, 20]) : r < 0.97 ? elegir([1, 5, 10, 20]) : -entre(5, 10) * 10;
    const contado = r2(Math.max(0, esperado + dif));
    const diferencia = r2(contado - esperado);
    folio.corte++;
    const notas = diferencia === 0 ? null : diferencia > 0 ? elegir(['Un cliente no esperó su cambio', 'Sobrante sin identificar'])
      : elegir(['Posible error al dar cambio', 'Faltante sin identificar', 'Se dio cambio de más a un cliente']);
    // cifras del turno en el momento del corte (una cancelación posterior ya no cambia el corte)
    const vivas = t.ventas.filter((v) => v.estado !== 'cancelada');
    const suma = (m) => r2(vivas.filter((v) => v.metodo === m).reduce((s, v) => s + v.total, 0));
    const mov = (tipo) => r2(t.movs.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.monto, 0));
    cortes.push({ folio: folio.corte, t, desde: t.abierto, hasta: fecha, esperado, contado, diferencia, notas, desglose: desglosar(contado),
      num: vivas.length, canceladas: t.ventas.length - vivas.length, efectivo: suma('efectivo'), tarjeta: suma('tarjeta'),
      transferencia: suma('transferencia'), entradas: mov('entrada'), salidas: mov('salida') });
    t.estado = 'cerrado';
    t.cerrado = fecha;
    bit(fecha, t.cajero.id, 'Corte de caja', `Corte ${folio.corte}: esperado ${esperado}, contado ${contado}, diferencia ${diferencia}`);
  }

  // ---------- Día por día ----------
  const porConvertir = {};
  const volumen = { 1: 1, 2: 0.75, 3: 0.6 }[idPap] || 0.7;
  const hoy = fmtDia(ahora);
  for (let d = new Date(inicio); fmtDia(d) <= hoy; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0) continue; // domingo cerrado
    const turnosDia = dow === 6 ? [[9, 0, 15, 0]] : [[8, 0, 14, 0], [14, 0, 20, 0]];
    const eventos = [];
    // compras: los lunes se reabastece; cualquier día si algo muy vendido está por agotarse
    eventos.push({ t: aLas(d, 9, entre(10, 50)), f: (t) => reabastecer(t, { soloUrgente: dow !== 1 }) });

    turnosDia.forEach(([hi, mi, hf, mf], idx) => {
      const ini = aLas(d, hi, mi + entre(0, 6));
      if (ini >= ahora) return;
      const cajero = cajeroDe(idx);
      const fin = new Date(Math.min(aLas(d, hf, mf).getTime(), ahora.getTime() - 2 * 60000));
      const enCurso = aLas(d, hf, mf) > ahora;
      const ctx = { turno: null };
      eventos.push({ t: ini, f: (t) => { ctx.turno = abrirTurno(t, cajero); } });
      const horas = (fin - ini) / 36e5;
      const factorDia = (dow === 6 ? 1.35 : dow === 1 ? 1.1 : 1) * (0.8 + azar() * 0.4);
      const n = poisson(3.2 * horas * volumen * factorDia);
      const enTurno = () => new Date(ini.getTime() + 5 * 60000 + azar() * Math.max(0, fin - ini - 6 * 60000));
      for (let i = 0; i < n; i++) {
        eventos.push({ t: enTurno(), f: (t) => {
          const cliente = prob(0.74) ? pg : elegirPeso(registrados, (c) => 1 + c.pct);
          const { lineas, mayoreo } = armarCarrito(cliente);
          const v = vender(t, ctx.turno, cliente, lineas, { mayoreo });
          if (v && prob(0.015)) eventos.push({ t: masMin(t, entre(5, 90)), f: (tc) => cancelarVenta(tc, v), tarde: true });
        } });
      }
      // cotizaciones del turno
      for (let i = 0; i < poisson(0.9 * volumen); i++) {
        eventos.push({ t: enTurno(), f: (t) => cotizar(t, ctx.turno, prob(0.85) ? elegirPeso(registrados, (c) => 1 + c.pct) : { ...pg, pct: 0 }) });
      }
      // cotizaciones que el cliente vino a convertir en venta este día
      if (idx === 0 || dow === 6) {
        for (const c of porConvertir[fmtDia(d)] || []) eventos.push({ t: enTurno(), f: (t) => convertir(t, ctx.turno, c) });
      }
      // salidas de efectivo y retiros del encargado
      if (prob(0.3)) {
        const [motivo, a, b] = elegir(SALIDAS);
        eventos.push({ t: enTurno(), f: (t) => movimientoCaja(t, ctx.turno, 'salida', entre(a, b), motivo) });
      }
      eventos.push({ t: masMin(ini, horas * 60 * 0.7), f: (t) => {
        if (ctx.turno.efectivo > 2500 && prob(0.7)) movimientoCaja(t, ctx.turno, 'salida', Math.floor((ctx.turno.efectivo - fondoSugerido) / 1000) * 1000 || 1000, 'Retiro de efectivo por el encargado');
      } });
      if (prob(0.05)) eventos.push({ t: enTurno(), f: (t) => movimientoCaja(t, ctx.turno, 'entrada', elegir([100, 200]), 'Reposición de fondo por el encargado') });
      if (!enCurso) eventos.push({ t: masMin(fin, entre(2, 12)), f: (t) => cerrarTurno(t, ctx.turno), cierre: true });
    });

    // procesa en orden cronológico (los eventos pueden agregar otros, como una cancelación)
    const hechos = new Set();
    for (;;) {
      const pendientes = eventos.filter((e) => !hechos.has(e) && e.t < ahora).sort((a, b) => a.t - b.t || (a.cierre ? 1 : 0) - (b.cierre ? 1 : 0));
      if (!pendientes.length) break;
      const e = pendientes[0];
      hechos.add(e);
      e.f(e.t);
    }
  }

  // ---------- Estados finales ----------
  for (const c of cotizaciones) {
    if (c.estado !== 'vigente') continue;
    if (c.cancelarEl && c.cancelarEl < ahora) { c.estado = 'cancelada'; c.motivo = elegir(['El cliente decidió no comprar', 'El cliente compró en otro lugar', 'El cliente pidió otra cotización']); bit(c.cancelarEl, c.usuario, 'Cancelar cotización', `Cotización ${c.folio}: ${c.motivo}`); }
    else if (c.vigencia < hoy) { c.estado = 'cancelada'; c.motivo = VENCIDA; }
  }
  const haceDosDias = new Date(ahora.getTime() - 2 * 864e5);
  for (const v of ventas) if (v.estado === 'pendiente_entrega' && v.fecha < haceDosDias && prob(0.9)) v.estado = 'entregada';

  // ---------- Guardar ----------
  const idTurno = new Map();
  for (const t of turnos) {
    const [r] = await conn.query(
      'INSERT INTO turnos_caja (id_papeleria, id_usuario, abierto_en, fondo_inicial, desglose_apertura, estado, cerrado_en) VALUES (?,?,?,?,?,?,?)',
      [idPap, t.cajero.id, fmt(t.abierto), t.fondo, t.desglose, t.estado, t.cerrado ? fmt(t.cerrado) : null]);
    idTurno.set(t, r.insertId);
  }
  await insertar(conn, 'cotizaciones', ['id_papeleria', 'folio', 'id_cliente', 'id_usuario', 'fecha', 'vigencia', 'subtotal', 'porcentaje_descuento',
    'descuento', 'total', 'estado', 'motivo_cancelacion'], cotizaciones.map((c) => [idPap, c.folio, c.cliente.id_cliente, c.usuario, fmt(c.fecha),
    c.vigencia, c.subtotal, c.pct, c.descuento, c.total, c.estado, c.motivo]));
  const [cots] = await conn.query('SELECT id_cotizacion, folio FROM cotizaciones WHERE id_papeleria = ?', [idPap]);
  const idCot = new Map(cots.map((c) => [c.folio, c.id_cotizacion]));
  await insertar(conn, 'detalle_cotizacion', ['id_cotizacion', 'id_producto', 'cantidad', 'precio_unitario', 'importe'],
    cotizaciones.flatMap((c) => c.partidas.map((l) => [idCot.get(c.folio), l.p.id_producto, l.cantidad, l.precio, l.importe])));

  await insertar(conn, 'ventas', ['id_papeleria', 'folio', 'id_cliente', 'id_usuario', 'id_cotizacion', 'fecha', 'subtotal', 'porcentaje_descuento',
    'descuento', 'total', 'metodo_pago', 'pago_con', 'cambio', 'tipo_entrega', 'estado', 'id_turno'],
  ventas.map((v) => [idPap, v.folio, v.cliente.id_cliente, v.turno.cajero.id, v.cotizacion ? idCot.get(v.cotizacion.folio) : null, fmt(v.fecha),
    v.subtotal, v.pct, v.descuento, v.total, v.metodo, v.pago, v.cambio, v.tipo_entrega, v.estado, idTurno.get(v.turno)]));
  const [vs] = await conn.query('SELECT id_venta, folio FROM ventas WHERE id_papeleria = ?', [idPap]);
  const idVenta = new Map(vs.map((v) => [v.folio, v.id_venta]));
  await insertar(conn, 'detalle_venta', ['id_venta', 'id_producto', 'cantidad', 'precio_unitario', 'importe'],
    ventas.flatMap((v) => v.lineas.map((l) => [idVenta.get(v.folio), l.p.id_producto, l.cantidad, l.precio, l.importe])));
  await insertar(conn, 'solicitudes_factura', ['id_venta', 'rfc', 'razon_social', 'uso_cfdi', 'regimen_fiscal', 'codigo_postal', 'fecha', 'id_usuario'],
    solicitudes.map((s) => [idVenta.get(s.venta.folio), s.rfc, s.razon, s.uso, s.regimen, s.cp, fmt(s.fecha), s.usuario]));

  await insertar(conn, 'compras', ['id_papeleria', 'folio', 'id_proveedor', 'id_usuario', 'folio_proveedor', 'fecha', 'total'],
    compras.map((c) => [idPap, c.folio, c.prov, admin.id_usuario, c.folioProv, fmt(c.fecha), c.total]));
  const [cps] = await conn.query('SELECT id_compra, folio FROM compras WHERE id_papeleria = ?', [idPap]);
  const idCompra = new Map(cps.map((c) => [c.folio, c.id_compra]));
  await insertar(conn, 'detalle_compra', ['id_compra', 'id_producto', 'cantidad', 'costo_unitario', 'importe'],
    compras.flatMap((c) => c.lineas.map((l) => [idCompra.get(c.folio), l.p.id_producto, l.cantidad, l.costo, l.importe])));

  await insertar(conn, 'movimientos_caja', ['id_turno', 'id_papeleria', 'id_usuario', 'tipo', 'monto', 'motivo', 'fecha'],
    turnos.flatMap((t) => t.movs.map((m) => [idTurno.get(t), idPap, t.cajero.id, m.tipo, m.monto, m.motivo, fmt(m.fecha)])));
  await insertar(conn, 'cortes_caja', ['id_papeleria', 'folio', 'id_usuario', 'id_turno', 'desde', 'hasta', 'num_ventas', 'ventas_efectivo',
    'ventas_tarjeta', 'ventas_transferencia', 'canceladas', 'fondo_inicial', 'entradas', 'salidas', 'efectivo_esperado', 'efectivo_contado',
    'diferencia', 'desglose', 'notas'],
  cortes.map((c) => [idPap, c.folio, c.t.cajero.id, idTurno.get(c.t), fmt(c.desde), fmt(c.hasta), c.num, c.efectivo, c.tarjeta,
    c.transferencia, c.canceladas, c.t.fondo, c.entradas, c.salidas, c.esperado, c.contado, c.diferencia, c.desglose, c.notas]));

  kardex.sort((a, b) => (a[7] < b[7] ? -1 : a[7] > b[7] ? 1 : 0)); // orden cronológico (sort estable)
  await insertar(conn, 'movimientos_inventario', ['id_papeleria', 'id_producto', 'tipo', 'cantidad', 'existencia', 'referencia', 'id_usuario', 'fecha'], kardex);
  bitacora.sort((a, b) => (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0));
  await insertar(conn, 'bitacora', ['id_papeleria', 'id_usuario', 'accion', 'detalle', 'fecha'], bitacora);
  for (const [tipo, ultimo] of Object.entries(folio)) {
    await conn.query('INSERT INTO folios (id_papeleria, tipo, ultimo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ultimo = VALUES(ultimo)', [idPap, tipo, ultimo]);
  }
  for (let i = 0; i < productos.length; i += 150) {
    const lote = productos.slice(i, i + 150);
    await conn.query(
      `UPDATE productos SET existencia = CASE id_producto ${lote.map(() => 'WHEN ? THEN ?').join(' ')} END,
                            costo = CASE id_producto ${lote.map(() => 'WHEN ? THEN ?').join(' ')} END
       WHERE id_producto IN (?)`,
      [...lote.flatMap((p) => [p.id_producto, p.existencia]), ...lote.flatMap((p) => [p.id_producto, p.costo]), lote.map((p) => p.id_producto)]);
  }
  await conn.commit();

  // ---------- Resumen ----------
  const vivas = ventas.filter((v) => v.estado !== 'cancelada');
  const res = {
    papeleria: pap.nombre,
    productos: productos.length,
    ventas: ventas.length,
    importe: r2(vivas.reduce((s, v) => s + v.total, 0)),
    canceladas: ventas.length - vivas.length,
    cotizaciones: cotizaciones.length,
    convertidas: cotizaciones.filter((c) => c.estado === 'convertida').length,
    vigentes: cotizaciones.filter((c) => c.estado === 'vigente').length,
    compras: compras.length,
    cortes: cortes.length,
    cajas_abiertas: turnos.filter((t) => t.estado === 'abierto').map((t) => t.cajero.usuario),
    pedidos_pendientes: ventas.filter((v) => v.estado === 'pendiente_entrega').length,
    solicitudes_factura: solicitudes.length,
    bajo_minimo: productos.filter((p) => p.pop > 0 && p.existencia <= p.existencia_minima).length,
    cajeros: cajeros.map((c) => c.usuario),
    usuarios_creados: creados,
  };
  console.table(Object.fromEntries(Object.entries(res).filter(([k]) => !['usuarios_creados'].includes(k))));
  if (creados.length) console.log('Usuarios creados:', creados.join(' | '));
  return res;
}

(async () => {
  console.log(`Base: ${process.env.DB_HOST} · días: ${DIAS} · papelerías: ${PAPELERIAS.join(', ')}${REINICIAR ? ' · REINICIANDO' : ''}`);
  const conn = await pool.getConnection();
  try {
    const [[r]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora");
    const ahora = leer(r.ahora);
    console.log(`Hora de la base: ${r.ahora}`);
    for (const id of PAPELERIAS) {
      try {
        await simularPapeleria(conn, id, ahora);
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      }
    }
  } finally {
    conn.release();
    await pool.end();
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
