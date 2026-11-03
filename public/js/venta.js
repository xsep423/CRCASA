// Pantalla de captura (carátula) del capturista: venta directa o cotización
requerirSesion();

const $ = (id) => document.getElementById(id);
const estado = {
  cliente: null,          // { id_cliente, codigo, nombre, porcentaje_descuento }
  partidas: [],           // { id_producto, codigo, nombre, precio_unitario, existencia, cantidad }
  pct: 0,                 // descuento que se aplicará en esta operación
  tope: 15,
  idCotizacion: null,     // si se está editando una cotización
};
const modales = {
  buscar: new bootstrap.Modal($('modal-buscar-cliente')),
  nuevo: new bootstrap.Modal($('modal-nuevo-cliente')),
  listo: new bootstrap.Modal($('modal-listo')),
};
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------- Cliente ----------------
function ponerCliente(c, pct) {
  estado.cliente = c;
  estado.pct = pct !== undefined ? Number(pct) : Number(c.porcentaje_descuento);
  $('codigo-cliente').value = c.codigo;
  $('cliente-info').innerHTML = `<strong>${esc(c.nombre)}</strong>
    <span class="badge text-bg-${Number(c.porcentaje_descuento) > 0 ? 'success' : 'secondary'}">
      Descuento asignado: ${Number(c.porcentaje_descuento)}%</span>`;
  pintar();
}

async function cargarClientePorCodigo(codigo) {
  try {
    ponerCliente(await API.get(`/clientes/codigo/${encodeURIComponent(codigo)}`));
    $('buscar-producto').focus();
  } catch (err) {
    avisarError(err);
    $('codigo-cliente').select();
  }
}

$('codigo-cliente').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) cargarClientePorCodigo(e.target.value.trim());
});

async function buscarClientes() {
  const q = $('q-cliente').value.trim();
  const lista = await API.get('/clientes' + (q ? `?buscar=${encodeURIComponent(q)}` : ''));
  $('lista-clientes').innerHTML = lista.map((c) => `
    <button class="list-group-item list-group-item-action d-flex justify-content-between" data-codigo="${esc(c.codigo)}">
      <span><strong>${esc(c.codigo)}</strong> · ${esc(c.nombre)} <small class="text-muted">${esc(c.telefono || '')}</small></span>
      <span class="badge text-bg-light">${Number(c.porcentaje_descuento)}%</span>
    </button>`).join('') || '<p class="text-muted">Sin resultados</p>';
}
$('btn-buscar-cliente').addEventListener('click', () => { modales.buscar.show(); buscarClientes(); setTimeout(() => $('q-cliente').focus(), 300); });
$('q-cliente').addEventListener('input', buscarClientes);
$('lista-clientes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-codigo]');
  if (!b) return;
  modales.buscar.hide();
  cargarClientePorCodigo(b.dataset.codigo);
});

$('btn-nuevo-cliente').addEventListener('click', () => { $('form-cliente').reset(); modales.nuevo.show(); });
$('form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const datos = Object.fromEntries(new FormData(e.target));
    const r = await API.post('/clientes', datos);
    modales.nuevo.hide();
    avisar(`Cliente registrado con código ${r.codigo}`);
    cargarClientePorCodigo(r.codigo);
  } catch (err) { avisarError(err); }
});

// ---------------- Productos ----------------
function agregar(prod, cantidad) {
  cantidad = Math.max(1, parseInt(cantidad, 10) || 1);
  const ya = estado.partidas.find((p) => p.id_producto === prod.id_producto);
  if (ya) ya.cantidad += cantidad;
  else estado.partidas.push({
    id_producto: prod.id_producto, codigo: prod.codigo, nombre: prod.nombre,
    precio_unitario: Number(prod.precio_venta ?? prod.precio_unitario), existencia: prod.existencia, cantidad,
  });
  $('buscar-producto').value = '';
  $('cantidad').value = 1;
  $('resultados-busqueda').classList.add('d-none');
  $('buscar-producto').focus();
  pintar();
}

let resultados = [];
async function buscarProductos(q) {
  resultados = q.length >= 2 ? await API.get(`/productos?buscar=${encodeURIComponent(q)}`) : [];
  const caja = $('resultados-busqueda');
  caja.innerHTML = resultados.slice(0, 12).map((p, i) => `
    <button class="list-group-item list-group-item-action d-flex justify-content-between" data-i="${i}">
      <span><strong>${esc(p.codigo)}</strong> · ${esc(p.nombre)}</span>
      <span>${dinero(p.precio_venta)} <small class="text-muted">· ${p.existencia} pzas</small></span>
    </button>`).join('');
  caja.classList.toggle('d-none', !resultados.length);
}

let tBusqueda;
$('buscar-producto').addEventListener('input', (e) => {
  clearTimeout(tBusqueda);
  tBusqueda = setTimeout(() => buscarProductos(e.target.value.trim()).catch(avisarError), 200);
});
$('buscar-producto').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); agregarDesdeInput(); }
  if (e.key === 'ArrowDown') $('resultados-busqueda').querySelector('button')?.focus();
});
$('cantidad').addEventListener('keydown', (e) => { if (e.key === 'Enter') agregarDesdeInput(); });
$('btn-agregar').addEventListener('click', agregarDesdeInput);
$('resultados-busqueda').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) agregar(resultados[b.dataset.i], $('cantidad').value);
});

// Enter: primero intenta código exacto (lector de barras); si no, toma el único resultado
async function agregarDesdeInput() {
  const q = $('buscar-producto').value.trim();
  if (!q) return;
  try {
    agregar(await API.get(`/productos/codigo/${encodeURIComponent(q)}`), $('cantidad').value);
  } catch {
    await buscarProductos(q);
    if (resultados.length === 1) agregar(resultados[0], $('cantidad').value);
    else if (!resultados.length) avisar('No se encontró ningún producto', 'warning');
  }
}

// Cambiar cantidad o quitar un producto de la lista
$('partidas').addEventListener('change', (e) => {
  if (!e.target.matches('.cantidad')) return;
  const p = estado.partidas[e.target.dataset.i];
  const n = parseInt(e.target.value, 10);
  if (n > 0) p.cantidad = n; else estado.partidas.splice(e.target.dataset.i, 1);
  pintar();
});
$('partidas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar]');
  if (!b) return;
  estado.partidas.splice(b.dataset.quitar, 1);
  pintar();
});

// ---------------- Descuento y totales ----------------
$('pct').addEventListener('input', (e) => {
  estado.pct = Number(e.target.value) || 0;
  pintar(false);
});

function maximoDescuento() {
  return Math.max(estado.tope, Number(estado.cliente?.porcentaje_descuento || 0));
}

function pintar(actualizarInputPct = true) {
  $('partidas').innerHTML = estado.partidas.map((p, i) => {
    const falta = p.cantidad > p.existencia;
    return `<tr class="${falta ? 'table-warning' : ''}">
      <td><code>${esc(p.codigo)}</code></td>
      <td>${esc(p.nombre)} ${falta ? `<br><small class="text-danger">Existencia: ${p.existencia} pzas</small>` : ''}</td>
      <td><input type="number" min="0" class="form-control form-control-sm cantidad" data-i="${i}" value="${p.cantidad}"></td>
      <td class="money">${dinero(p.precio_unitario)}</td>
      <td class="money">${dinero(p.precio_unitario * p.cantidad)}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-quitar="${i}" title="Quitar"><i class="bi bi-x-lg"></i></button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">Escanea o escribe el código de un producto</td></tr>';

  const subtotal = r2(estado.partidas.reduce((s, p) => s + p.precio_unitario * p.cantidad, 0));
  const max = maximoDescuento();
  const pctValido = estado.pct >= 0 && estado.pct <= max;
  const descuento = pctValido ? r2(subtotal * estado.pct / 100) : 0;
  $('t-subtotal').textContent = dinero(subtotal);
  $('t-descuento').textContent = '-' + dinero(descuento);
  $('t-total').textContent = dinero(subtotal - descuento);
  if (actualizarInputPct) $('pct').value = estado.pct;
  $('pct').max = max;
  $('pct').classList.toggle('is-invalid', !pctValido);
  $('ayuda-descuento').innerHTML = estado.cliente
    ? `Asignado al cliente: <strong>${Number(estado.cliente.porcentaje_descuento)}%</strong> · Máximo permitido: ${max}%`
    : '';
  $('faltantes').classList.add('d-none');
}

// ---------------- Guardar ----------------
function cuerpo() {
  if (!estado.cliente) throw new Error('Selecciona un cliente');
  if (!estado.partidas.length) throw new Error('Agrega al menos un producto');
  if (estado.pct < 0 || estado.pct > maximoDescuento()) throw new Error(`El descuento debe estar entre 0% y ${maximoDescuento()}%`);
  return {
    id_cliente: estado.cliente.id_cliente,
    partidas: estado.partidas.map((p) => ({ id_producto: p.id_producto, cantidad: p.cantidad })),
    porcentaje_descuento: estado.pct,
  };
}

function mostrarFaltantes(err) {
  if (!err.faltantes) return avisarError(err);
  $('faltantes').innerHTML = `<strong>No hay existencia suficiente:</strong><ul class="mb-1">
    ${err.faltantes.map((f) => `<li>${esc(f.nombre)}: pidió ${f.solicitado}, hay ${f.existencia}</li>`).join('')}</ul>
    Ajusta la cantidad o quita el producto. ${estado.idCotizacion ? '' : 'También puedes guardarlo como cotización.'}`;
  $('faltantes').classList.remove('d-none');
}

function listo(titulo, detalle, url) {
  $('listo-titulo').textContent = titulo;
  $('listo-detalle').textContent = detalle;
  $('listo-imprimir').href = url;
  modales.listo.show();
}

async function registrarVenta() {
  try {
    const body = { ...cuerpo(), metodo_pago: $('metodo').value, tipo_entrega: $('entrega').value };
    let idVenta, total;
    if (estado.idCotizacion) {
      // Primero guarda los cambios de la cotización y luego la convierte
      await API.put(`/cotizaciones/${estado.idCotizacion}`, body);
      const r = await API.post(`/cotizaciones/${estado.idCotizacion}/convertir`, body);
      idVenta = r.id_venta;
      total = (await API.get(`/ventas/${idVenta}`)).total;
    } else {
      const r = await API.post('/ventas', body);
      idVenta = r.venta.id_venta;
      total = r.venta.total;
    }
    const recoger = body.tipo_entrega === 'recoger';
    listo(`Venta #${idVenta} registrada`, `Total ${dinero(total)}${recoger ? ' · Pedido pendiente de entrega' : ''}`,
      `/nota.html?tipo=venta&id=${idVenta}`);
  } catch (err) { mostrarFaltantes(err); }
}

async function guardarCotizacion() {
  try {
    const body = cuerpo();
    const r = estado.idCotizacion
      ? await API.put(`/cotizaciones/${estado.idCotizacion}`, body)
      : await API.post('/cotizaciones', body);
    const c = r.cotizacion;
    listo(`Cotización #${c.id_cotizacion} ${estado.idCotizacion ? 'actualizada' : 'guardada'}`,
      `Total ${dinero(c.total)} · Vigente hasta ${fechaCorta(c.vigencia)}`, `/nota.html?tipo=cotizacion&id=${c.id_cotizacion}`);
  } catch (err) { avisarError(err); }
}

function limpiar() {
  if (estado.idCotizacion) { location.href = '/venta.html'; return; }
  estado.partidas = [];
  $('metodo').value = 'efectivo';
  $('entrega').value = 'mostrador';
  cargarClientePorCodigo('PG');
}

$('btn-venta').addEventListener('click', registrarVenta);
$('btn-cotizacion').addEventListener('click', guardarCotizacion);
$('btn-limpiar').addEventListener('click', () => {
  if (estado.partidas.length && !confirm('¿Descartar la captura actual?')) return;
  limpiar();
});
$('listo-nueva').addEventListener('click', () => { modales.listo.hide(); estado.idCotizacion ? (location.href = '/venta.html') : limpiar(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2') { e.preventDefault(); registrarVenta(); }
  if (e.key === 'F4') { e.preventDefault(); guardarCotizacion(); }
});

// ---------------- Inicio ----------------
(async () => {
  try {
    estado.tope = (await API.get('/configuracion')).tope_descuento ?? 15;
    const id = new URLSearchParams(location.search).get('cotizacion');
    if (id) {
      const c = await API.get(`/cotizaciones/${id}`);
      if (c.estado !== 'vigente') {
        avisar(`La cotización #${id} está ${c.estado} y ya no se puede editar`, 'warning');
        return cargarClientePorCodigo('PG');
      }
      estado.idCotizacion = c.id_cotizacion;
      $('num-cot').textContent = c.id_cotizacion;
      $('banner-cotizacion').classList.remove('d-none');
      $('btn-venta').querySelector('span').textContent = 'Convertir en venta';
      $('btn-cotizacion').querySelector('span').textContent = 'Guardar cambios';
      estado.partidas = c.partidas.map((p) => ({ ...p, precio_unitario: Number(p.precio_unitario) }));
      ponerCliente(await API.get(`/clientes/${c.id_cliente}`), c.porcentaje_descuento);
    } else {
      await cargarClientePorCodigo('PG');
    }
  } catch (err) { avisarError(err); }
})();
