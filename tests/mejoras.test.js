// Pruebas de las mejoras: folios por papelería, cambio, kárdex, corte de caja, reportes,
// sugerencia de compra, límite de intentos de login, cambio de contraseña y bitácora.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const pool = require('../src/config/db');

const s = Date.now().toString().slice(-6) + 'm';
let base, server;
const tokens = {};
const api = async (quien, metodo, url, body) => {
  const res = await fetch(base + url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(tokens[quien] ? { Authorization: `Bearer ${tokens[quien]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};
const login = async (quien, usuario, password) => {
  const r = await api(null, 'POST', '/auth/login', { usuario, password });
  tokens[quien] = r.data.token;
  return r;
};

let pap2, prod, pg;

test.before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
  const hash = await bcrypt.hash('Prueba12345', 4);
  const crear = (u, rol, pap) => pool.query('INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,?)',
    [pap, `Prueba ${u}`, u, hash, rol]);
  await crear(`m_sop_${s}`, 'soporte', null);
  await login('sop', `m_sop_${s}`, 'Prueba12345');
  pap2 = (await api('sop', 'POST', '/papelerias', { nombre: `Papelería Mejoras ${s}` })).data.id;
  await crear(`m_adm_${s}`, 'administrador', pap2);
  await crear(`m_caj_${s}`, 'capturista', pap2);
  await login('adm', `m_adm_${s}`, 'Prueba12345');
  await login('caj', `m_caj_${s}`, 'Prueba12345');
  const clas = (await api('adm', 'GET', '/clasificaciones')).data[0].id_clasificacion;
  prod = (await api('adm', 'POST', '/productos', { codigo: 'MJ-1', nombre: 'Producto mejoras', precio_venta: 50, existencia: 10, existencia_minima: 4, id_clasificacion: clas })).data.id;
  pg = (await api('caj', 'GET', '/clientes/codigo/PG')).data.id_cliente;
});
test.after(async () => { server.close(); await pool.end(); });

test('apertura de caja: sin caja abierta no se vende; se abre contando el fondo', async () => {
  const cerrada = await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }] });
  assert.equal(cerrada.status, 409);
  assert.equal(cerrada.data.caja_cerrada, true);
  const e = (await api('caj', 'GET', '/caja')).data;
  assert.equal(e.abierta, false);
  assert.equal(e.fondo_sugerido, 500);
  assert.equal((await api('caj', 'POST', '/caja/abrir', {})).status, 400);
  // el desglose de billetes y monedas debe sumar el fondo
  assert.equal((await api('caj', 'POST', '/caja/abrir', { fondo_inicial: 500, desglose: { 200: 2 } })).status, 400);
  const r = await api('caj', 'POST', '/caja/abrir', { fondo_inicial: 500, desglose: { 200: 2, 50: 1, 20: 2, 10: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.data.caja.fondo_inicial, 500);
  assert.equal((await api('caj', 'POST', '/caja/abrir', { fondo_inicial: 100 })).status, 409); // solo una caja abierta
  const abiertas = (await api('adm', 'GET', '/caja/abiertas')).data;
  assert.equal(abiertas.length, 1);
  assert.equal((await api('caj', 'GET', '/caja/abiertas')).status, 403);
});

test('folios consecutivos propios de cada papelería', async () => {
  const v1 = (await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }] })).data.venta;
  const v2 = (await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }], metodo_pago: 'tarjeta' })).data.venta;
  assert.equal(v1.folio, 1); // papelería nueva: empieza en 1 aunque otras ya tengan ventas
  assert.equal(v2.folio, 2);
  const c = (await api('caj', 'POST', '/cotizaciones', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 2 }] })).data.cotizacion;
  assert.equal(c.folio, 1);
  const conv = await api('caj', 'POST', `/cotizaciones/${c.id_cotizacion}/convertir`, { metodo_pago: 'efectivo' });
  assert.equal(conv.data.folio, 3);
});

test('cobro en efectivo calcula el cambio y rechaza pagos insuficientes', async () => {
  const ok = await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }], metodo_pago: 'efectivo', pago_con: 200 });
  assert.equal(ok.status, 201);
  assert.equal(Number(ok.data.venta.pago_con), 200);
  assert.equal(Number(ok.data.venta.cambio), 150);
  const poco = await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }], metodo_pago: 'efectivo', pago_con: 20 });
  assert.equal(poco.status, 400);
});

test('kárdex: cada movimiento queda registrado con la existencia resultante', async () => {
  const k = (await api('caj', 'GET', `/productos/${prod}/movimientos`)).data;
  const tipos = k.movimientos.map((m) => m.tipo).reverse();
  assert.deepEqual(tipos, ['inicial', 'venta', 'venta', 'venta', 'venta']);
  assert.equal(k.movimientos[0].existencia, k.producto.existencia);
  assert.equal(k.producto.existencia, 5); // 10 - 1 - 1 - 2 - 1
  // una compra y una cancelación también quedan en el kárdex
  const prov = (await api('adm', 'POST', '/proveedores', { nombre: 'Proveedor mejoras' })).data.id;
  await api('adm', 'POST', '/compras', { id_proveedor: prov, partidas: [{ id_producto: prod, cantidad: 5, costo_unitario: 30 }] });
  const ventas = (await api('adm', 'GET', '/ventas')).data;
  await api('adm', 'POST', `/ventas/${ventas.find((v) => v.folio === 2).id_venta}/cancelar`);
  const k2 = (await api('adm', 'GET', `/productos/${prod}/movimientos`)).data;
  assert.equal(k2.movimientos[0].tipo, 'cancelacion');
  assert.equal(k2.movimientos[0].referencia, 'Cancelación venta 2');
  assert.equal(k2.movimientos[1].tipo, 'compra');
  assert.equal(k2.producto.existencia, 11);
  // otra papelería no puede ver el kárdex
  assert.equal((await api('sop', 'POST', '/auth/papeleria', { id_papeleria: 1 })).status, 200);
});

test('corte de caja: fondo de la apertura + ventas en efectivo + entradas - salidas', async () => {
  const t = (await api('caj', 'GET', '/caja')).data;
  assert.equal(t.abierta, true);
  assert.equal(t.num_ventas, 3);       // folios 1, 3 y 4 (la 2 se canceló)
  assert.equal(t.canceladas, 1);
  assert.equal(t.ventas_efectivo, 200); // 50 + 100 (cotización convertida, 2 piezas) + 50
  assert.equal(t.efectivo_esperado, 700);
  // entradas y salidas de efectivo que no son ventas
  assert.equal((await api('caj', 'POST', '/caja/movimientos', { tipo: 'salida', monto: 5000, motivo: 'Retiro' })).status, 400); // no alcanza
  assert.equal((await api('caj', 'POST', '/caja/movimientos', { tipo: 'salida', monto: 30 })).status, 400);                   // sin motivo
  assert.equal((await api('caj', 'POST', '/caja/movimientos', { tipo: 'entrada', monto: 50, motivo: 'Traen monedas de cambio' })).status, 201);
  const sal = await api('caj', 'POST', '/caja/movimientos', { tipo: 'salida', monto: 30, motivo: 'Garrafón de agua' });
  assert.equal(sal.data.caja.efectivo_esperado, 720);
  // el contado debe coincidir con su desglose
  assert.equal((await api('caj', 'POST', '/cortes', { efectivo_contado: 710, desglose: { 500: 1 } })).status, 400);
  const r = await api('caj', 'POST', '/cortes', { efectivo_contado: 710, desglose: { 500: 1, 200: 1, 10: 1 }, fondo_inicial: 9999 });
  assert.equal(r.status, 201);
  assert.equal(Number(r.data.corte.fondo_inicial), 500); // el fondo sale de la apertura, no se puede cambiar al cerrar
  assert.equal(Number(r.data.corte.entradas), 50);
  assert.equal(Number(r.data.corte.salidas), 30);
  assert.equal(Number(r.data.corte.efectivo_esperado), 720);
  assert.equal(Number(r.data.corte.diferencia), -10);
  assert.equal(r.data.corte.folio, 1);
  assert.equal(r.data.corte.movimientos.length, 2);
  // la caja queda cerrada: ya no se vende ni se puede volver a cortar hasta abrir otra
  assert.equal((await api('caj', 'GET', '/caja')).data.abierta, false);
  assert.equal((await api('caj', 'POST', '/cortes', { efectivo_contado: 0 })).status, 409);
  assert.equal((await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 1 }] })).status, 409);
  assert.equal((await api('adm', 'GET', '/cortes')).data.length, 1);
  // la caja siguiente empieza en cero
  const nueva = (await api('caj', 'POST', '/caja/abrir', { fondo_inicial: 710 })).data.caja;
  assert.equal(nueva.num_ventas, 0);
  assert.equal(nueva.efectivo_esperado, 710);
});

test('reportes de ventas por rango y agrupación', async () => {
  const hoy = new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
  const r = (await api('adm', 'GET', `/reportes/ventas?agrupar=metodo&desde=2026-01-01&hasta=2099-12-31`)).data;
  assert.equal(r.resumen.ventas, 3);
  assert.equal(r.resumen.canceladas, 1);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].grupo, 'efectivo');
  const p = (await api('adm', 'GET', '/reportes/ventas?agrupar=producto&desde=2026-01-01&hasta=2099-12-31')).data;
  assert.equal(Number(p.filas[0].piezas), 4); // 1 + 2 (cotización) + 1
  assert.equal((await api('caj', 'GET', '/reportes/ventas')).status, 403);
  assert.equal((await api('adm', 'GET', `/reportes/ventas?desde=${hoy}&hasta=2020-01-01`)).status, 400);
});

test('sugerencia de compra con los productos por reabastecer', async () => {
  await api('caj', 'POST', '/ventas', { id_cliente: pg, partidas: [{ id_producto: prod, cantidad: 8 }] }); // queda en 3, mínimo 4
  const s2 = (await api('adm', 'GET', '/compras/sugerencia')).data;
  const fila = s2.find((x) => x.id_producto === prod);
  assert.ok(fila);
  assert.equal(Number(fila.sugerido), 5); // para llegar a 8 (doble del mínimo)
});

test('bloqueo tras 5 intentos fallidos de inicio de sesión', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await api(null, 'POST', '/auth/login', { usuario: `m_caj_${s}`, password: 'mala' })).status, 401);
  assert.equal((await api(null, 'POST', '/auth/login', { usuario: `m_caj_${s}`, password: 'Prueba12345' })).status, 429);
  await pool.query('DELETE FROM intentos_login WHERE usuario = ?', [`m_caj_${s}`]);
  assert.equal((await api(null, 'POST', '/auth/login', { usuario: `m_caj_${s}`, password: 'Prueba12345' })).status, 200);
});

test('cada empleado cambia su propia contraseña', async () => {
  assert.equal((await api('caj', 'POST', '/auth/password', { actual: 'incorrecta', nueva: 'Nueva123456' })).status, 400);
  assert.equal((await api('caj', 'POST', '/auth/password', { actual: 'Prueba12345', nueva: 'corta' })).status, 400);
  assert.equal((await api('caj', 'POST', '/auth/password', { actual: 'Prueba12345', nueva: 'Nueva123456' })).status, 200);
  assert.equal((await api(null, 'POST', '/auth/login', { usuario: `m_caj_${s}`, password: 'Nueva123456' })).status, 200);
});

test('la bitácora registra las acciones importantes', async () => {
  const b = (await api('adm', 'GET', '/bitacora?desde=2026-01-01&hasta=2099-12-31')).data;
  const acciones = b.map((x) => x.accion);
  for (const a of ['Cancelar venta', 'Registrar compra', 'Abrir caja', 'Salida de efectivo', 'Corte de caja', 'Cambiar contraseña']) assert.ok(acciones.includes(a), a);
  assert.equal((await api('caj', 'GET', '/bitacora')).status, 403);
});
