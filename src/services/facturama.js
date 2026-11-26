// TIMBRADO DE CFDI 4.0 EN MODO DE PRUEBAS con el PAC Facturama (API Multiemisor, ambiente sandbox).
// Los CFDI que se generan aquí NO tienen validez fiscal: sirven para demostrar el flujo completo
// venta -> solicitud de factura -> timbrado -> descarga de XML y PDF.
//
// Variables de entorno (se configuran en Vercel y en .env, nunca en el código):
//   FACTURAMA_USUARIO, FACTURAMA_PASSWORD  cuenta gratuita de sandbox (dev.facturama.mx)
//   FACTURAMA_URL                          por defecto https://apisandbox.facturama.mx
const { HttpError } = require('../utils/http');

const SANDBOX = 'https://apisandbox.facturama.mx';

function config() {
  const usuario = process.env.FACTURAMA_USUARIO;
  const password = process.env.FACTURAMA_PASSWORD;
  if (!usuario || !password) {
    throw new HttpError(503, 'El timbrado de prueba no está configurado: faltan FACTURAMA_USUARIO y FACTURAMA_PASSWORD en el servidor');
  }
  const url = (process.env.FACTURAMA_URL || SANDBOX).replace(/\/$/, '');
  // Candado: este proyecto solo timbra en el ambiente de pruebas
  if (!/apisandbox\.facturama\.mx|localhost|127\.0\.0\.1/.test(url)) {
    throw new HttpError(503, 'Solo se permite el ambiente de pruebas (sandbox) del PAC');
  }
  return { url, auth: 'Basic ' + Buffer.from(`${usuario}:${password}`).toString('base64') };
}

// Junta en un texto los errores que regresa Facturama ({ Message, ModelState: { campo: [errores] } })
function mensajeError(data, status) {
  if (!data || typeof data !== 'object') return `El PAC respondió ${status}`;
  const partes = [];
  if (data.Message) partes.push(data.Message);
  for (const errores of Object.values(data.ModelState || {})) partes.push(...[].concat(errores));
  return partes.join(' · ').slice(0, 480) || `El PAC respondió ${status}`;
}

async function llamar(metodo, ruta, cuerpo) {
  const { url, auth } = config();
  let res;
  try {
    res = await fetch(url + ruta, {
      method: metodo,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new HttpError(502, `No se pudo conectar con el PAC: ${e.message}`);
  }
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  if (!res.ok) throw new HttpError(502, mensajeError(data, res.status), { pac: true });
  return data;
}

// Claves del SAT para la forma de pago (catálogo c_FormaPago)
const FORMA_PAGO = { efectivo: '01', transferencia: '03', tarjeta: '04' };
const r2 = (n) => Math.round(n * 100) / 100;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// Arma el CFDI de ingreso a partir de una venta. Los precios de mostrador YA incluyen IVA,
// así que se desglosa: base = importe / 1.16 y el IVA es el 16 % de la base.
function armarCfdi({ venta, solicitud, emisor }) {
  const factor = 1 - Number(venta.porcentaje_descuento) / 100;
  const items = venta.partidas.map((p) => {
    const conIva = Number(p.importe) * factor;
    const cantidad = Number(p.cantidad);
    const precio = r6(conIva / 1.16 / cantidad);
    const subtotal = r2(precio * cantidad);
    const iva = r2(subtotal * 0.16);
    return {
      ProductCode: '01010101', // "No existe en el catálogo": en producción cada producto llevaría su clave del SAT
      IdentificationNumber: p.codigo,
      Description: p.nombre,
      Unit: 'Pieza',
      UnitCode: 'H87',
      UnitPrice: precio,
      Quantity: cantidad,
      Subtotal: subtotal,
      TaxObject: '02',
      Taxes: [{ Name: 'IVA', Rate: 0.16, Base: subtotal, Total: iva, IsRetention: false }],
      Total: r2(subtotal + iva),
    };
  });
  return {
    NameId: '1',
    CfdiType: 'I',
    Currency: 'MXN',
    Serie: 'V',
    Folio: String(venta.folio),
    PaymentForm: FORMA_PAGO[venta.metodo_pago] || '01',
    PaymentMethod: 'PUE',
    ExpeditionPlace: emisor.cp,
    Exportation: '01',
    Observations: `Venta folio ${venta.folio} · CFDI de PRUEBA sin validez fiscal`,
    Issuer: { Rfc: emisor.rfc, Name: emisor.nombre, FiscalRegime: emisor.regimen },
    Receiver: {
      Rfc: solicitud.rfc,
      Name: solicitud.razon_social,
      CfdiUse: solicitud.uso_cfdi,
      FiscalRegime: solicitud.regimen_fiscal,
      TaxZipCode: solicitud.codigo_postal,
    },
    Items: items,
  };
}

async function timbrar(cfdi) {
  const r = await llamar('POST', '/api-lite/3/cfdis', cfdi);
  const uuid = (r && ((r.Complement && r.Complement.TaxStamp && r.Complement.TaxStamp.Uuid) || (r.TaxStamp && r.TaxStamp.Uuid))) || null;
  if (!r || !r.Id || !uuid) throw new HttpError(502, 'El PAC no regresó el folio fiscal (UUID)');
  return { id: r.Id, uuid, total: r.Total };
}

// Regresa el archivo (pdf o xml) como Buffer
async function descargar(formato, idPac) {
  const r = await llamar('GET', `/cfdi/${formato}/issuedLite/${encodeURIComponent(idPac)}`);
  if (!r || !r.Content) throw new HttpError(502, 'El PAC no regresó el archivo');
  return Buffer.from(r.Content, 'base64');
}

module.exports = { armarCfdi, timbrar, descargar, FORMA_PAGO };
