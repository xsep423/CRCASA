// Funciones compartidas por todas las pantallas del sistema CRCASA
const API = {
  token: () => localStorage.getItem('token'),
  usuario: () => JSON.parse(localStorage.getItem('usuario') || 'null'),

  async request(url, opciones = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (API.token()) headers.Authorization = `Bearer ${API.token()}`;
    const body = opciones.body && typeof opciones.body !== 'string' ? JSON.stringify(opciones.body) : opciones.body;
    const res = await fetch('/api' + url, { ...opciones, headers, body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/auth/login')) {
      API.cerrarSesion();
      throw new Error('Tu sesión expiró');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Error inesperado');
      Object.assign(err, data, { status: res.status });
      throw err;
    }
    return data;
  },
  get: (url) => API.request(url),
  post: (url, body = {}) => API.request(url, { method: 'POST', body }),
  put: (url, body) => API.request(url, { method: 'PUT', body }),
  del: (url) => API.request(url, { method: 'DELETE' }),

  guardarSesion({ token, usuario }) {
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
  },
  cerrarSesion() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    location.href = '/';
  },
};

const ES_ADMIN = () => ['administrador', 'soporte'].includes(API.usuario()?.rol);

// Menú según el rol del empleado
const MENU = [
  { href: '/venta.html', texto: 'Captura', icono: 'cart3', roles: ['capturista', 'administrador', 'soporte'] },
  { href: '/cotizaciones.html', texto: 'Cotizaciones', icono: 'file-earmark-text', roles: ['capturista', 'administrador', 'soporte'] },
  { href: '/ventas.html', texto: 'Ventas', icono: 'receipt', roles: ['capturista', 'administrador', 'soporte'] },
  { href: '/clientes.html', texto: 'Clientes', icono: 'people', roles: ['capturista', 'administrador', 'soporte'] },
  { href: '/productos.html', texto: 'Productos', icono: 'box-seam', roles: ['capturista', 'administrador', 'soporte'] },
  { href: '/compras.html', texto: 'Compras', icono: 'truck', roles: ['administrador', 'soporte'] },
  { href: '/proveedores.html', texto: 'Proveedores', icono: 'building', roles: ['administrador', 'soporte'] },
  { href: '/panel.html', texto: 'Panel', icono: 'speedometer2', roles: ['administrador', 'soporte'] },
  { href: '/usuarios.html', texto: 'Usuarios', icono: 'person-gear', roles: ['soporte'] },
];

const ETIQUETA_ROL = { capturista: 'Capturista', administrador: 'Administrador', soporte: 'Soporte técnico' };

// Llamar al inicio de cada pantalla: revisa sesión y permisos, y pinta el menú
function requerirSesion(roles) {
  const u = API.usuario();
  if (!u || !API.token()) { location.href = '/'; throw new Error('Sin sesión'); }
  if (roles && !roles.includes(u.rol)) { location.href = '/venta.html'; throw new Error('Sin permiso'); }
  const nav = document.getElementById('nav');
  if (nav) {
    const links = MENU.filter((m) => m.roles.includes(u.rol)).map((m) =>
      `<li class="nav-item"><a class="nav-link ${location.pathname === m.href ? 'active' : ''}" href="${m.href}">
         <i class="bi bi-${m.icono}"></i> ${m.texto}</a></li>`).join('');
    nav.innerHTML = `
      <nav class="navbar navbar-dark navbar-expand-lg no-print">
        <div class="container-fluid">
          <a class="navbar-brand fw-bold" href="/venta.html">CRCASA</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu"><span class="navbar-toggler-icon"></span></button>
          <div class="collapse navbar-collapse" id="menu">
            <ul class="navbar-nav me-auto">${links}</ul>
            <span class="navbar-text text-white me-3"><i class="bi bi-person-circle"></i> ${esc(u.nombre)}
              <span class="badge bg-light text-dark">${ETIQUETA_ROL[u.rol]}</span></span>
            <button class="btn btn-outline-light btn-sm" onclick="API.cerrarSesion()">Salir</button>
          </div>
        </div>
      </nav>`;
  }
  return u;
}

// ---------- Formato ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fecha = (f) => (f ? new Date(f.replace(' ', 'T')).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fechaCorta = (f) => (f ? new Date(f.slice(0, 10) + 'T12:00').toLocaleDateString('es-MX') : '');

const ESTADOS = {
  vigente: ['Vigente', 'primary'], convertida: ['Convertida en venta', 'success'], vencida: ['Vencida', 'secondary'],
  cancelada: ['Cancelada', 'danger'], pagada: ['Pagada', 'success'], pendiente_entrega: ['Pendiente de entrega', 'warning'],
  entregada: ['Entregada', 'success'],
};
const badgeEstado = (e) => `<span class="badge text-bg-${(ESTADOS[e] || [e, 'secondary'])[1]}">${(ESTADOS[e] || [e])[0]}</span>`;

// ---------- Avisos ----------
function avisar(mensaje, tipo = 'success') {
  let cont = document.getElementById('avisos');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'avisos';
    cont.className = 'toast-container position-fixed top-0 end-0 p-3 no-print';
    document.body.appendChild(cont);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${tipo} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(mensaje)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  cont.appendChild(el);
  new bootstrap.Toast(el, { delay: tipo === 'danger' ? 6000 : 3000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
const avisarError = (err) => avisar(err.message || String(err), 'danger');

// ---------- Catálogo genérico (tabla + formulario en modal) ----------
// Se usa en clientes, productos, proveedores, usuarios y clasificaciones.
//   columnas: [{ campo, titulo, formato(valor, fila), clase }]
//   campos:   [{ campo, etiqueta, tipo, opciones:[[valor,texto]], requerido, soloAdmin, soloAlCrear, ayuda, col }]
function Catalogo(cfg) {
  const cont = document.querySelector(cfg.contenedor);
  const idModal = `modal-${cfg.endpoint.replace(/\W/g, '')}`;
  let filas = [];
  let editando = null;

  cont.innerHTML = `
    <div class="d-flex flex-wrap gap-2 mb-3">
      ${cfg.buscar !== false ? `<input class="form-control buscar" style="max-width:340px" placeholder="${cfg.placeholder || 'Buscar...'}">` : ''}
      ${cfg.puedeCrear !== false ? `<button class="btn btn-primary ms-auto nuevo"><i class="bi bi-plus-lg"></i> ${cfg.textoNuevo || 'Nuevo'}</button>` : ''}
    </div>
    <div class="card"><div class="table-responsive">
      <table class="table table-hover mb-0">
        <thead class="table-light"><tr>${cfg.columnas.map((c) => `<th class="${c.clase || ''}">${c.titulo}</th>`).join('')}<th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div></div>
    <div class="modal fade" id="${idModal}" tabindex="-1"><div class="modal-dialog modal-lg"><form class="modal-content" novalidate>
      <div class="modal-header"><h5 class="modal-title"></h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body"><div class="row g-3 campos"></div></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary">Guardar</button></div>
    </form></div></div>`;

  const tbody = cont.querySelector('tbody');
  const modalEl = cont.querySelector('.modal');
  const modal = new bootstrap.Modal(modalEl);
  const form = modalEl.querySelector('form');

  function campoHTML(f, valor) {
    const deshabilitado = (f.soloAdmin && !ES_ADMIN()) || (f.soloAlCrear && editando) ? 'disabled' : '';
    const req = f.requerido ? 'required' : '';
    const v = esc(valor ?? f.porDefecto ?? '');
    let input;
    if (f.tipo === 'select') {
      const ops = (typeof f.opciones === 'function' ? f.opciones() : f.opciones)
        .map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(valor ?? f.porDefecto ?? '') ? 'selected' : ''}>${esc(txt)}</option>`).join('');
      input = `<select class="form-select" name="${f.campo}" ${req} ${deshabilitado}>${f.requerido ? '' : '<option value="">—</option>'}${ops}</select>`;
    } else {
      input = `<input class="form-control" name="${f.campo}" type="${f.tipo || 'text'}" value="${v}" ${f.paso ? `step="${f.paso}"` : ''} ${req} ${deshabilitado} ${f.min !== undefined ? `min="${f.min}"` : ''}>`;
    }
    const ayuda = (f.soloAlCrear && editando) ? '' : (f.ayuda || (f.soloAdmin && !ES_ADMIN() ? 'Solo el administrador puede cambiar este dato' : ''));
    return `<div class="col-md-${f.col || 6}"><label class="form-label">${f.etiqueta}${f.requerido ? ' *' : ''}</label>${input}
      ${ayuda ? `<div class="form-text">${ayuda}</div>` : ''}</div>`;
  }

  function abrir(fila = null) {
    editando = fila;
    modalEl.querySelector('.modal-title').textContent = fila ? `Editar ${cfg.nombre}` : `Nuevo ${cfg.nombre}`;
    const campos = cfg.campos.filter((f) => !(f.soloEditar && !fila) && !(f.ocultarAlEditar && fila));
    modalEl.querySelector('.campos').innerHTML = campos.map((f) => campoHTML(f, fila ? fila[f.campo] : undefined)).join('');
    modal.show();
    setTimeout(() => form.querySelector('input:not([disabled]),select:not([disabled])')?.focus(), 300);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    const body = editando ? { ...editando } : {};
    new FormData(form).forEach((v, k) => { body[k] = v; });
    try {
      const datos = cfg.transformar ? cfg.transformar(body, editando) : body;
      const r = editando
        ? await API.put(`${cfg.endpoint}/${editando[cfg.id]}`, datos)
        : await API.post(cfg.endpoint, datos);
      modal.hide();
      form.classList.remove('was-validated');
      avisar(r.mensaje || 'Guardado');
      cargar();
      cfg.alGuardar?.(r);
    } catch (err) { avisarError(err); }
  });

  async function cargar() {
    try {
      const q = cont.querySelector('.buscar')?.value.trim();
      filas = await API.get(cfg.endpoint + (q ? `?buscar=${encodeURIComponent(q)}` : ''));
      tbody.innerHTML = filas.length ? filas.map((f, i) => `<tr>
        ${cfg.columnas.map((c) => `<td class="${c.clase || ''}">${c.formato ? c.formato(f[c.campo], f) : esc(f[c.campo])}</td>`).join('')}
        <td class="text-end text-nowrap">
          ${(cfg.puedeEditar ? cfg.puedeEditar(f) : true) ? `<button class="btn btn-sm btn-outline-primary" data-editar="${i}" title="Editar"><i class="bi bi-pencil"></i></button>` : ''}
          ${(cfg.puedeEliminar ? cfg.puedeEliminar(f) : false) ? `<button class="btn btn-sm btn-outline-danger" data-eliminar="${i}" title="Dar de baja"><i class="bi bi-trash"></i></button>` : ''}
        </td></tr>`).join('')
        : `<tr><td colspan="${cfg.columnas.length + 1}" class="text-center text-muted py-4">Sin registros</td></tr>`;
    } catch (err) { avisarError(err); }
  }

  tbody.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editar]');
    const el = e.target.closest('[data-eliminar]');
    if (ed) abrir(filas[ed.dataset.editar]);
    if (el) {
      const fila = filas[el.dataset.eliminar];
      if (!confirm(`¿Dar de baja "${fila.nombre}"?`)) return;
      try { avisar((await API.del(`${cfg.endpoint}/${fila[cfg.id]}`)).mensaje); cargar(); } catch (err) { avisarError(err); }
    }
  });
  cont.querySelector('.nuevo')?.addEventListener('click', () => abrir());
  let t;
  cont.querySelector('.buscar')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 250); });

  cargar();
  return { cargar, abrir };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('resultados-busqueda')?.classList.add('d-none');
});
