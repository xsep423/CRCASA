// Pantalla de captura (carátula) del capturista: venta directa o cotización
requerirSesion();

const $ = (id) => document.getElementById(id);
const estado = {
  cliente: null,          // { id_cliente, codigo, nombre, porcentaje_descuento }
  partidas: [],           // { id_producto, codigo, nombre, precio_unitario, existencia, cantidad }
  pct: 0,                 // descuento del cliente (fijo: lo asigna el administrador)
  productos: [],          // catálogo completo de la papelería
  categoria: '',          // filtro de categoría del catálogo
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
  $('cliente-info').innerHTML = `<div class="d-flex justify-content-between align-items-center">
    <div><strong>${esc(c.nombre)}</strong><br><small class="text-muted">${esc(c.codigo)}${c.rfc ? ' · RFC ' + esc(c.rfc) : ''}</small></div>
    <span class="badge text-bg-${Number(c.porcentaje_descuento) > 0 ? 'success' : 'secondary'}">Descuento ${Number(c.porcentaje_descuento)}%</span></div>`;
  pintar();
}

async function cargarClientePorCodigo(codigo) {
  try {
    ponerCliente(await API.get(`/clientes/codigo/${encodeURIComponent(codigo)}`));
  } catch (err) {
    avisarError(err);
  }
}

async function buscarClientes() {
  const q = $('q-cliente').value.trim();
  const lista = await API.get('/clientes' + (q ? `?buscar=${encodeURIComponent(q)}` : ''));
  $('lista-clientes').innerHTML = lista.map((c) => `
    <button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-codigo="${esc(c.codigo)}">
      <span><strong>${esc(c.nombre)}</strong><br><small class="text-muted">${esc(c.codigo)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</small></span>
      <span class="badge text-bg-${Number(c.porcentaje_descuento) > 0 ? 'success' : 'light'}">${Number(c.porcentaje_descuento)}%</span>
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
// Se cargan TODOS los productos de la papelería y se eligen de la lista; el buscador y las
// categorías solo filtran. Escribir un código exacto y presionar Enter también lo agrega.
async function cargarCatalogo() {
  estado.productos = await API.get('/productos');
  const cats = [...new Set(estado.productos.map((p) => p.clasificacion))].sort();
  $('categorias').innerHTML = ['', ...cats].map((c) => `<button class="btn btn-sm ${c === estado.categoria ? 'btn-primary' : 'btn-outline-secondary'}" data-cat="${esc(c)}">${c ? esc(c) : 'Todas'}</button>`).join('');
  pintarCatalogo();
}

function enLista(id) {
  return estado.partidas.find((p) => p.id_producto === id)?.cantidad || 0;
}

function pintarCatalogo() {
  const q = $('buscar-producto').value.trim().toLowerCase();
  const lista = estado.productos.filter((p) => (!estado.categoria || p.clasificacion === estado.categoria)
    && (!q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)));
  $('conteo-productos').textContent = `${lista.length} de ${estado.productos.length}`;
  $('catalogo').innerHTML = lista.map((p) => {
    const lleva = enLista(p.id_producto);
    const agotado = p.existencia <= 0;
    return `<tr data-id="${p.id_producto}" class="${agotado ? 'agotado' : ''}">
      <td><code>${esc(p.codigo)}</code></td>
      <td>${esc(p.nombre)}<br><small class="text-muted">${esc(p.clasificacion)}</small></td>
      <td class="money">${dinero(p.precio_venta)}</td>
      <td class="text-end ${p.existencia <= p.existencia_minima ? 'text-danger fw-bold' : ''}">${agotado ? 'Agotado' : p.existencia}</td>
      <td class="text-end">${lleva ? `<span class="badge text-bg-primary me-1">${lleva}</span>` : ''}<button class="btn btn-sm btn-primary" ${agotado ? 'disabled' : ''} title="Agregar"><i class="bi bi-plus-lg"></i></button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">Ningún producto coincide</td></tr>';
}

function agregar(prod, cantidad = 1) {
  const ya = estado.partidas.find((p) => p.id_producto === prod.id_producto);
  if (ya) ya.cantidad += cantidad;
  else estado.partidas.push({
    id_producto: prod.id_producto, codigo: prod.codigo, nombre: prod.nombre,
    precio_unitario: Number(prod.precio_venta ?? prod.precio_unitario), existencia: prod.existencia, cantidad,
  });
  pintar();
}

$('catalogo').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr || tr.classList.contains('agotado')) return;
  agregar(estado.productos.find((p) => p.id_producto === Number(tr.dataset.id)));
});
$('categorias').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  estado.categoria = b.dataset.cat;
  $('categorias').querySelectorAll('[data-cat]').forEach((x) => x.className = `btn btn-sm ${x === b ? 'btn-primary' : 'btn-outline-secondary'}`);
  pintarCatalogo();
});
$('buscar-producto').addEventListener('input', pintarCatalogo);
$('buscar-producto').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = e.target.value.trim().toLowerCase();
  const exacto = estado.productos.find((p) => p.codigo.toLowerCase() === q);
  const visibles = estado.productos.filter((p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q));
  const prod = exacto || (visibles.length === 1 ? visibles[0] : null);
  if (prod && prod.existencia > 0) { agregar(prod); e.target.value = ''; pintarCatalogo(); }
});

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

// ---------------- Totales ----------------
// El descuento es el que el administrador asignó al cliente: se muestra pero no se puede cambiar.
function pintar() {
  $('partidas').innerHTML = estado.partidas.map((p, i) => {
    const falta = p.cantidad > p.existencia;
    return `<tr class="${falta ? 'table-warning' : ''}">
      <td>${esc(p.nombre)}<br><small class="text-muted">${esc(p.codigo)} · ${dinero(p.precio_unitario)}</small>
        ${falta ? `<br><small class="text-danger">Solo hay ${p.existencia} pzas</small>` : ''}</td>
      <td><input type="number" min="0" class="form-control form-control-sm cantidad" data-i="${i}" value="${p.cantidad}"></td>
      <td class="money">${dinero(p.precio_unitario * p.cantidad)}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-quitar="${i}" title="Quitar"><i class="bi bi-x-lg"></i></button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">Elige productos de la lista</td></tr>';

  const subtotal = r2(estado.partidas.reduce((s, p) => s + p.precio_unitario * p.cantidad, 0));
  const descuento = r2(subtotal * estado.pct / 100);
  $('t-subtotal').textContent = dinero(subtotal);
  $('t-pct').innerHTML = `<i class="bi bi-lock-fill"></i> ${estado.pct}%`;
  $('t-descuento').textContent = '-' + dinero(descuento);
  $('t-total').textContent = dinero(subtotal - descuento);
  estado.total = r2(subtotal - descuento);
  actualizarCambio();
  $('faltantes').classList.add('d-none');
  if (estado.productos.length) pintarCatalogo();
}

// ---------------- Cobro en efectivo ----------------
function actualizarCambio() {
  const efectivo = $('metodo').value === 'efectivo';
  $('cobro').classList.toggle('d-none', !efectivo);
  const pago = Number($('pago-con').value);
  const cambio = pago - (estado.total || 0);
  const el = $('t-cambio');
  if (!$('pago-con').value) { el.textContent = dinero(0); el.className = 'fs-4 fw-bold money'; return; }
  el.textContent = cambio >= 0 ? dinero(cambio) : `Faltan ${dinero(-cambio)}`;
  el.className = `fs-4 fw-bold money ${cambio >= 0 ? 'text-success' : 'text-danger'}`;
}
$('pago-con').addEventListener('input', actualizarCambio);
$('metodo').addEventListener('change', actualizarCambio);

// ---------------- Guardar ----------------
function cuerpo() {
  if (!estado.cliente) throw new Error('Selecciona un cliente');
  if (!estado.partidas.length) throw new Error('Agrega al menos un producto');
  return {
    id_cliente: estado.cliente.id_cliente,
    partidas: estado.partidas.map((p) => ({ id_producto: p.id_producto, cantidad: p.cantidad })),
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
    if (body.metodo_pago === 'efectivo' && $('pago-con').value) body.pago_con = Number($('pago-con').value);
    let idVenta;
    if (estado.idCotizacion) {
      // Primero guarda los cambios de la cotización y luego la convierte
      await API.put(`/cotizaciones/${estado.idCotizacion}`, body);
      const r = await API.post(`/cotizaciones/${estado.idCotizacion}/convertir`, body);
      idVenta = r.id_venta;
    } else {
      idVenta = (await API.post('/ventas', body)).venta.id_venta;
    }
    const v = await API.get(`/ventas/${idVenta}`);
    const recoger = body.tipo_entrega === 'recoger';
    listo(`Venta folio ${v.folio} registrada`,
      `Total ${dinero(v.total)}${v.cambio !== null && v.cambio !== undefined ? ` · Pagó con ${dinero(v.pago_con)} · Cambio ${dinero(v.cambio)}` : ''}${recoger ? ' · Pedido pendiente de entrega' : ''}`,
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
    listo(`Cotización folio ${c.folio} ${estado.idCotizacion ? 'actualizada' : 'guardada'}`,
      `Total ${dinero(c.total)} · Vigente hasta ${fechaCorta(c.vigencia)}`, `/nota.html?tipo=cotizacion&id=${c.id_cotizacion}`);
  } catch (err) { avisarError(err); }
}

function limpiar() {
  if (estado.idCotizacion) { location.href = '/venta.html'; return; }
  estado.partidas = [];
  $('metodo').value = 'efectivo';
  $('pago-con').value = '';
  $('entrega').value = 'mostrador';
  $('buscar-producto').value = '';
  cargarClientePorCodigo('PG');
  cargarCatalogo().catch(avisarError); // las existencias cambiaron con la venta
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
    await cargarCatalogo();
    const id = new URLSearchParams(location.search).get('cotizacion');
    if (id) {
      const c = await API.get(`/cotizaciones/${id}`);
      if (c.estado !== 'vigente') {
        avisar(`La cotización folio ${c.folio} está ${c.estado} y ya no se puede editar`, 'warning');
        return cargarClientePorCodigo('PG');
      }
      estado.idCotizacion = c.id_cotizacion;
      $('num-cot').textContent = c.folio;
      $('banner-cotizacion').classList.remove('d-none');
      $('btn-venta').querySelector('span').textContent = 'Convertir en venta';
      $('btn-cotizacion').querySelector('span').textContent = 'Guardar cambios';
      estado.partidas = c.partidas.map((p) => ({ ...p, precio_unitario: Number(p.precio_unitario) }));
      ponerCliente(await API.get(`/clientes/${c.id_cliente}`));
    } else {
      await cargarClientePorCodigo('PG');
    }
  } catch (err) { avisarError(err); }
})();
