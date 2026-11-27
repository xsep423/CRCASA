// Pruebas del Avance 5: timbrado de CFDI de prueba (contra un PAC simulado que valida montos como el SAT)
// y descarga real de reportes en Excel (.xlsx) y PDF.
require('dotenv').config();
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

// PAC simulado: misma ruta y forma de respuesta que el sandbox de Facturama
const recibidos = [];
const pacFalso = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    const responder = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (!req.headers.authorization?.startsWith('Basic ')) return responder(401, { Message: 'Sin credenciales' });
    if (req.method === 'POST' && req.url === '/api-lite/3/cfdis') {
      const c = JSON.parse(cuerpo);
      recibidos.push(c);
      if (c.Receiver.Rfc !== 'URE180429TM6') return responder(400, { Message: 'La solicitud no es válida.', ModelState: { 'Receiver.Rfc': ['El RFC del receptor no está en la lista de RFC de prueba'] } });
      for (const it of c.Items) {
        // Reglas del SAT: Importe = Cantidad x ValorUnitario (tolerancia de redondeo) e IVA = 16 % de la base
        if (Math.abs(it.UnitPrice * it.Quantity - it.Subtotal) > 0.01) return responder(400, { Message: 'Importe no cuadra' });
        if (Math.abs(it.Taxes[0].Base * 0.16 - it.Taxes[0].Total) > 0.01) return responder(400, { Message: 'IVA no cuadra' });
        if (Math.abs(it.Subtotal + it.Taxes[0].Total - it.Total) > 0.001) return responder(400, { Message: 'Total no cuadra' });
      }
      return responder(201, { Id: 'pac-' + recibidos.length, Total: c.Items.reduce((s, i) => s + i.Total, 0),
        Complement: { TaxStamp: { Uuid: `6F1D3C2A-0000-4000-8000-00000000000${recibidos.length}` } } });
    }
    const m = /^\/cfdi\/(pdf|xml)\/issuedLite\/(.+)$/.exec(req.url);
    if (req.method === 'GET' && m) {
      const contenido = m[1] === 'xml' ? '<?xml version="1.0"?><cfdi:Comprobante Version="4.0"/>' : '%PDF-1.4 prueba';
      return responder(200, { ContentType: m[1], ContentEncoding: 'UTF-8', Content: Buffer.from(contenido).toString('base64') });
    }
    responder(404, { Message: 'No encontrado' });
  });
});

let base, server;
const s = Date.now().toString().slice(-6) + 'u';
const tokens = {};
let app, pool;
const api = async (quien, metodo, url, body) => {
  const res = await fetch(base + url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(tokens[quien] ? { Authorization: `Bearer ${tokens[quien]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, tipo, disp: res.headers.get('content-disposition'),
    data: tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const login = async (quien, usuario) => {
  tokens[quien] = (await api(null, 'POST', '/auth/login', { usuario, password: 'Prueba12345' })).data.token;
};

let prod, prod2, clientePrueba, clienteFalso;

test.before(async () => {
  await new Promise((r) => pacFalso.listen(0, r));
  process.env.FACTURAMA_URL = `http://localhost:${pacFalso.address().port}`;
  process.env.FACTURAMA_USUARIO = 'demo';
  process.env.FACTURAMA_PASSWORD = 'demo';
  app = require('../src/app');
  pool = require('../src/config/db');
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
  const hash = await bcrypt.hash('Prueba12345', 4);
  const crear = (u, rol, pap) => pool.query('INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,?)',
    [pap, `Prueba ${u}`, u, hash, rol]);
  await crear(`u5_sop_${s}`, 'soporte', null);
  await login('sop', `u5_sop_${s}`);
  const pap = (await api('sop', 'POST', '/papelerias', { nombre: `Papelería U5 ${s}` })).data.id;
  await crear(`u5_adm_${s}`, 'administrador', pap);
  await crear(`u5_caj_${s}`, 'capturista', pap);
  await login('adm', `u5_adm_${s}`);
  await login('caj', `u5_caj_${s}`);
  const clas = (await api('adm', 'GET', '/clasificaciones')).data[0].id_clasificacion;
  prod = (await api('adm', 'POST', '/productos', { codigo: 'U5-1', nombre: 'Cuaderno profesional', precio_venta: 37.5, existencia: 50, existencia_minima: 5, id_clasificacion: clas })).data.id;
  prod2 = (await api('adm', 'POST', '/productos', { codigo: 'U5-2', nombre: 'Pluma azul', precio_venta: 8.9, existencia: 9, existencia_minima: 10, id_clasificacion: clas })).data.id;
  clientePrueba = (await api('adm', 'POST', '/clientes', { codigo: 'URE', nombre: 'Universidad Robótica Española', rfc: 'URE180429TM6', porcentaje_descuento: 7 })).data.id;
  clienteFalso = (await api('adm', 'POST', '/clientes', { codigo: 'FALSO', nombre: 'Cliente sin RFC de prueba', rfc: 'XYZ010101AB1' })).data.id;
});
test.after(async () => { server.close(); pacFalso.close(); await pool.end(); });

const vender = async (cliente) => (await api('caj', 'POST', '/ventas', {
  id_cliente: cliente, metodo_pago: 'tarjeta',
  partidas: [{ id_producto: prod, cantidad: 3 }, { id_producto: prod2, cantidad: 2 }] })).data.venta;
const datosFiscales = { rfc: 'URE180429TM6', razon_social: 'Universidad Robotica Española', regimen_fiscal: '601', codigo_postal: '86991', uso_cfdi: 'G03' };

test('solicitud de factura exige régimen fiscal y código postal (CFDI 4.0)', async () => {
  const v = await vender(clientePrueba);
  const sin = await api('caj', 'POST', `/ventas/${v.id_venta}/solicitud-factura`, { rfc: 'URE180429TM6' });
  assert.equal(sin.status, 400);
  const ok = await api('caj', 'POST', `/ventas/${v.id_venta}/solicitud-factura`, datosFiscales);
  assert.equal(ok.status, 201);
  const sf = (await api('caj', 'GET', `/ventas/${v.id_venta}/factura`)).data;
  assert.equal(sf.estado_cfdi, 'pendiente');
  assert.equal(sf.razon_social, 'UNIVERSIDAD ROBOTICA ESPAÑOLA');
});

test('timbra el CFDI de prueba: desglosa IVA, cuadra con la venta y guarda el UUID', async () => {
  const v = await vender(clientePrueba);
  await api('caj', 'POST', `/ventas/${v.id_venta}/solicitud-factura`, datosFiscales);
  const t = await api('caj', 'POST', `/ventas/${v.id_venta}/factura/timbrar`);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.match(t.data.uuid, /^[0-9A-F-]{36}$/);
  const c = recibidos.at(-1);
  assert.equal(c.Issuer.Rfc, 'EKU9003173C9');
  assert.equal(c.PaymentForm, '04');
  assert.equal(c.Folio, String(v.folio));
  const totalCfdi = c.Items.reduce((s, i) => s + i.Total, 0);
  assert.ok(Math.abs(totalCfdi - Number(v.total)) <= 0.02, `CFDI ${totalCfdi} vs venta ${v.total}`);
  const sf = (await api('caj', 'GET', `/ventas/${v.id_venta}/factura`)).data;
  assert.equal(sf.estado_cfdi, 'timbrada');
  assert.equal(sf.uuid, t.data.uuid);
  // No se puede timbrar dos veces
  assert.equal((await api('caj', 'POST', `/ventas/${v.id_venta}/factura/timbrar`)).status, 409);
  // Descarga de XML y PDF
  const xml = await api('caj', 'GET', `/ventas/${v.id_venta}/factura/xml`);
  assert.equal(xml.status, 200);
  assert.match(xml.data.toString(), /cfdi:Comprobante/);
  assert.match(xml.disp, /CFDI-prueba-.*\.xml/);
  const pdf = await api('caj', 'GET', `/ventas/${v.id_venta}/factura/pdf`);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
});

test('si el PAC rechaza, se guarda el error y se puede corregir y reintentar', async () => {
  const v = await vender(clienteFalso);
  await api('caj', 'POST', `/ventas/${v.id_venta}/solicitud-factura`, { ...datosFiscales, rfc: 'XYZ010101AB1', razon_social: 'Cliente' });
  const t = await api('caj', 'POST', `/ventas/${v.id_venta}/factura/timbrar`);
  assert.equal(t.status, 502);
  assert.match(t.data.error, /RFC del receptor/);
  const sf = (await api('caj', 'GET', `/ventas/${v.id_venta}/factura`)).data;
  assert.equal(sf.estado_cfdi, 'error');
  assert.match(sf.mensaje_pac, /RFC del receptor/);
  const pdf = await api('caj', 'GET', `/ventas/${v.id_venta}/factura/pdf`);
  assert.equal(pdf.status, 409);
});

test('sin credenciales del PAC la solicitud sigue pendiente y no se marca como rechazada', async () => {
  const v = await vender(clientePrueba);
  await api('caj', 'POST', `/ventas/${v.id_venta}/solicitud-factura`, datosFiscales);
  const guardado = process.env.FACTURAMA_PASSWORD;
  delete process.env.FACTURAMA_PASSWORD;
  try {
    const t = await api('caj', 'POST', `/ventas/${v.id_venta}/factura/timbrar`);
    assert.equal(t.status, 503);
    assert.match(t.data.error, /no está configurado/);
  } finally { process.env.FACTURAMA_PASSWORD = guardado; }
  const sf = (await api('caj', 'GET', `/ventas/${v.id_venta}/factura`)).data;
  assert.equal(sf.estado_cfdi, 'pendiente');
  assert.equal(sf.mensaje_pac, null);
});

test('reporte de ventas en Excel real (.xlsx) con fórmula de total', async () => {
  const r = await api('adm', 'GET', '/reportes/ventas/exportar?formato=xlsx&agrupar=producto');
  assert.equal(r.status, 200);
  assert.match(r.tipo, /spreadsheetml/);
  assert.match(r.disp, /reporte-ventas-producto-.*\.xlsx/);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(r.data);
  const hoja = libro.getWorksheet('Ventas');
  assert.match(String(hoja.getCell('A1').value), /Papelería U5/);
  let formula = null;
  hoja.eachRow((fila) => fila.eachCell((c) => { if (c.formula) formula = c.formula; }));
  assert.match(formula, /^SUM\(D\d+:D\d+\)$/);
});

test('reportes de ventas, inventario y bitácora en PDF', async () => {
  for (const url of ['/reportes/ventas/exportar?formato=pdf', '/reportes/inventario/exportar?formato=pdf', '/bitacora/exportar?formato=pdf']) {
    const r = await api('adm', 'GET', url);
    assert.equal(r.status, 200, url);
    assert.equal(r.tipo, 'application/pdf');
    assert.equal(r.data.subarray(0, 4).toString(), '%PDF');
  }
  const inv = (await api('adm', 'GET', '/reportes/inventario')).data;
  assert.equal(inv.resumen.por_reabastecer, 1); // la pluma quedó abajo del mínimo
  assert.equal((await api('adm', 'GET', '/reportes/ventas/exportar?formato=doc')).status, 400);
  assert.equal((await api('caj', 'GET', '/reportes/inventario/exportar?formato=pdf')).status, 403);
});

test('reporte de ventas por categoría: cada categoría con sus productos, subtotal y filtros', async () => {
  const q = 'desde=2026-01-01&hasta=2099-12-31';
  const r = (await api('adm', 'GET', `/reportes/ventas?agrupar=categoria&${q}`)).data;
  assert.equal(r.agrupar, 'categoria');
  assert.ok(r.categorias.length >= 1);
  for (const c of r.categorias) {
    const suma = c.productos.reduce((s, p) => s + Number(p.total), 0);
    assert.ok(Math.abs(suma - Number(c.total)) < 0.02, `subtotal de ${c.categoria}`);
    assert.equal(c.productos.reduce((s, p) => s + Number(p.piezas), 0), Number(c.piezas));
  }
  const totalCats = r.categorias.reduce((s, c) => s + Number(c.total), 0);
  assert.ok(Math.abs(totalCats - Number(r.resumen.total)) < 0.02);
  // Filtros: categoría, empleado y forma de pago
  const op = (await api('adm', 'GET', '/reportes/opciones')).data;
  const cat = op.categorias.find((c) => c.nombre === r.categorias[0].categoria);
  const soloCat = (await api('adm', 'GET', `/reportes/ventas?agrupar=categoria&categoria=${cat.id}&${q}`)).data;
  assert.equal(soloCat.categorias.length, 1);
  assert.match(soloCat.filtros.join(), /categoría/);
  const caj = op.empleados.find((e) => e.rol === 'capturista');
  const porEmpleado = (await api('adm', 'GET', `/reportes/ventas?agrupar=dia&empleado=${caj.id}&${q}`)).data;
  assert.ok(Number(porEmpleado.resumen.ventas) >= 1);
  const tarjeta = (await api('adm', 'GET', `/reportes/ventas?agrupar=dia&metodo=transferencia&${q}`)).data;
  assert.equal(Number(tarjeta.resumen.ventas), 0);
  assert.equal((await api('adm', 'GET', `/reportes/ventas?metodo=cheque&${q}`)).status, 400);
  // Excel: subtotales por categoría como fórmula y total como suma de subtotales
  const x = await api('adm', 'GET', `/reportes/ventas/exportar?formato=xlsx&agrupar=categoria&${q}`);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(x.data);
  const formulas = [];
  libro.getWorksheet('Ventas').eachRow((fila) => fila.eachCell((c) => { if (c.formula) formulas.push(c.formula); }));
  assert.ok(formulas.some((f) => /^SUM\(D\d+:D\d+\)$/.test(f)), 'subtotal por categoría');
  assert.ok(formulas.some((f) => /^SUM\(D\d+(,D\d+)*\)$/.test(f) && !f.includes(':')), 'total de subtotales');
  const pdf = await api('adm', 'GET', `/reportes/ventas/exportar?formato=pdf&agrupar=categoria&${q}`);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
});

test('inventario dividido por categoría con subtotales y filtro de reabastecer', async () => {
  const inv = (await api('adm', 'GET', '/reportes/inventario')).data;
  assert.ok(inv.categorias.length >= 1);
  for (const c of inv.categorias) {
    assert.equal(c.existencia, c.lista.reduce((s, p) => s + Number(p.existencia), 0));
  }
  const bajos = (await api('adm', 'GET', '/reportes/inventario?reabastecer=1')).data;
  assert.ok(bajos.filas.every((p) => p.alerta === 'Reabastecer'));
  const x = await api('adm', 'GET', '/reportes/inventario/exportar?formato=xlsx&reabastecer=1');
  assert.equal(x.status, 200);
});
