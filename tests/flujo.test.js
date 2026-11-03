// Prueba de punta a punta de los flujos principales contra la BD local.
// Requiere haber corrido schema.sql y seed.sql. Crea sus propios usuarios y productos de prueba.
// Ejecutar: npm test
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const pool = require('../src/config/db');

const sufijo = Date.now().toString().slice(-6);
let base, server;
const tokens = {};

async function api(rol, metodo, url, body) {
  const res = await fetch(base + url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(tokens[rol] ? { Authorization: `Bearer ${tokens[rol]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const existencia = async (id) => (await pool.query('SELECT existencia FROM productos WHERE id_producto = ?', [id]))[0][0].existencia;

let prodA, prodB, cliente;

test.before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
  const hash = await bcrypt.hash('Prueba12345', 4);
  for (const rol of ['capturista', 'administrador', 'soporte']) {
    await pool.query('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)',
      [`Test ${rol}`, `t_${rol}_${sufijo}`, hash, rol]);
    const r = await api(null, 'POST', '/auth/login', { usuario: `t_${rol}_${sufijo}`, password: 'Prueba12345' });
    tokens[rol] = r.data.token;
  }
});

test.after(async () => { server.close(); await pool.end(); });

test('sin sesión no se puede consultar nada', async () => {
  assert.equal((await api(null, 'GET', '/productos')).status, 401);
  assert.equal((await api(null, 'POST', '/auth/registro', {})).status, 401); // ya no hay registro público
});

test('administrador crea productos; capturista no puede', async () => {
  const p = { codigo: `TA-${sufijo}`, nombre: 'Producto prueba A', precio_venta: 100, existencia: 10, id_clasificacion: 1 };
  assert.equal((await api('capturista', 'POST', '/productos', p)).status, 403);
  prodA = (await api('administrador', 'POST', '/productos', p)).data.id;
  prodB = (await api('administrador', 'POST', '/productos', { ...p, codigo: `TB-${sufijo}`, nombre: 'Producto prueba B', precio_venta: 50 })).data.id;
  assert.ok(prodA && prodB);
  const r = await api('capturista', 'GET', `/productos/codigo/ta-${sufijo}`);
  assert.equal(r.data.id_producto, prodA);
});

test('capturista registra cliente pero no puede asignarle descuento', async () => {
  const r = await api('capturista', 'POST', '/clientes', { nombre: 'Cliente de prueba', porcentaje_descuento: 50 });
  assert.equal(r.status, 201);
  cliente = (await api('capturista', 'GET', `/clientes/codigo/${r.data.codigo}`)).data;
  assert.equal(Number(cliente.porcentaje_descuento), 0);
  await api('administrador', 'PUT', `/clientes/${cliente.id_cliente}`, { ...cliente, porcentaje_descuento: 10 });
  cliente = (await api('capturista', 'GET', `/clientes/${cliente.id_cliente}`)).data;
  assert.equal(Number(cliente.porcentaje_descuento), 10);
});

test('cotización: se aplica el descuento del cliente y NO mueve existencia', async () => {
  const r = await api('capturista', 'POST', '/cotizaciones', {
    id_cliente: cliente.id_cliente,
    partidas: [{ id_producto: prodA, cantidad: 3 }, { id_producto: prodB, cantidad: 2 }, { id_producto: prodA, cantidad: 1 }],
  });
  assert.equal(r.status, 201);
  const c = r.data.cotizacion;
  assert.equal(c.partidas.length, 2);          // las partidas repetidas se juntan
  assert.equal(Number(c.subtotal), 500);       // 4*100 + 2*50
  assert.equal(Number(c.descuento), 50);       // 10% del cliente
  assert.equal(Number(c.total), 450);
  assert.equal(await existencia(prodA), 10);

  // Quitar un producto: se recalcula todo
  const e = await api('capturista', 'PUT', `/cotizaciones/${c.id_cotizacion}`, { partidas: [{ id_producto: prodA, cantidad: 4 }] });
  assert.equal(Number(e.data.cotizacion.total), 360);
  assert.equal(await existencia(prodA), 10);

  // Pide más de lo que hay: la cotización sí se guarda (no aparta mercancía)...
  await api('capturista', 'PUT', `/cotizaciones/${c.id_cotizacion}`, { partidas: [{ id_producto: prodA, cantidad: 25 }] });
  // ...pero al convertirla avisa qué falta
  const conv = await api('capturista', 'POST', `/cotizaciones/${c.id_cotizacion}/convertir`, {});
  assert.equal(conv.status, 409);
  assert.equal(conv.data.faltantes[0].existencia, 10);

  // El capturista ajusta y ahora sí se convierte; aquí se descuenta inventario
  await api('capturista', 'PUT', `/cotizaciones/${c.id_cotizacion}`, { partidas: [{ id_producto: prodA, cantidad: 4 }] });
  const ok = await api('capturista', 'POST', `/cotizaciones/${c.id_cotizacion}/convertir`, { metodo_pago: 'efectivo' });
  assert.equal(ok.status, 201);
  assert.equal(await existencia(prodA), 6);
  const venta = (await api('capturista', 'GET', `/ventas/${ok.data.id_venta}`)).data;
  assert.equal(Number(venta.total), 360);
  assert.equal(venta.id_cotizacion, c.id_cotizacion);

  // Una cotización convertida ya no se edita
  assert.equal((await api('capturista', 'PUT', `/cotizaciones/${c.id_cotizacion}`, { partidas: [{ id_producto: prodA, cantidad: 1 }] })).status, 409);
});

test('venta directa: el capturista ajusta el descuento hasta el tope', async () => {
  const pedir = (pct) => api('capturista', 'POST', '/ventas', {
    id_cliente: cliente.id_cliente, porcentaje_descuento: pct, partidas: [{ id_producto: prodB, cantidad: 2 }],
  });
  assert.equal((await pedir(40)).status, 400);           // pasa del tope (15%)
  const r = await pedir(0);                               // decide no dar descuento
  assert.equal(r.status, 201);
  assert.equal(Number(r.data.venta.total), 100);
  assert.equal(await existencia(prodB), 8);
});

test('pedido para recoger, cancelación (solo admin) y factura', async () => {
  const r = await api('capturista', 'POST', '/ventas', {
    id_cliente: cliente.id_cliente, tipo_entrega: 'recoger', partidas: [{ id_producto: prodB, cantidad: 3 }],
  });
  const id = r.data.venta.id_venta;
  assert.equal(r.data.venta.estado, 'pendiente_entrega');
  assert.equal((await api('capturista', 'POST', `/ventas/${id}/entregar`)).status, 200);
  assert.equal((await api('capturista', 'POST', `/ventas/${id}/cancelar`)).status, 403);
  assert.equal((await api('administrador', 'POST', `/ventas/${id}/cancelar`)).status, 200);
  assert.equal(await existencia(prodB), 8); // regresó la mercancía

  // factura: el cliente necesita RFC
  const v2 = (await api('capturista', 'POST', '/ventas', { id_cliente: cliente.id_cliente, partidas: [{ id_producto: prodB, cantidad: 1 }] })).data.venta;
  assert.equal((await api('capturista', 'POST', `/ventas/${v2.id_venta}/factura`, {})).status, 400);
  assert.equal((await api('capturista', 'POST', `/ventas/${v2.id_venta}/factura`, { rfc: 'XAXX010101000' })).status, 201);
  assert.equal((await api('capturista', 'POST', `/ventas/${v2.id_venta}/factura`, { rfc: 'XAXX010101000' })).status, 409);
});

test('compra a proveedor suma existencia y actualiza costo', async () => {
  const r = await api('administrador', 'POST', '/compras', {
    id_proveedor: 1, folio_proveedor: `F-${sufijo}`, partidas: [{ id_producto: prodA, cantidad: 20, costo_unitario: 60 }],
  });
  assert.equal(r.status, 201);
  assert.equal(await existencia(prodA), 26);
  assert.equal((await api('capturista', 'GET', '/compras')).status, 403);
});

test('solo soporte administra usuarios', async () => {
  assert.equal((await api('administrador', 'GET', '/usuarios')).status, 403);
  assert.equal((await api('soporte', 'GET', '/usuarios')).status, 200);
});

test('al editar una cotización se respeta el precio cotizado aunque el precio cambie', async () => {
  const c = (await api('capturista', 'POST', '/cotizaciones', { id_cliente: 1, partidas: [{ id_producto: prodB, cantidad: 2 }] })).data.cotizacion;
  const p = (await api('administrador', 'GET', `/productos/${prodB}`)).data;
  await api('administrador', 'PUT', `/productos/${prodB}`, { ...p, precio_venta: 80 });
  const e = (await api('capturista', 'PUT', `/cotizaciones/${c.id_cotizacion}`, {
    partidas: [{ id_producto: prodB, cantidad: 3 }, { id_producto: prodA, cantidad: 1 }],
  })).data.cotizacion;
  assert.equal(Number(e.total), 3 * 50 + 100); // B conserva $50 cotizado; A entra al precio actual
});
