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

  // Descarga un archivo generado por el servidor (Excel, PDF, XML) con la sesión del empleado
  async descargar(url) {
    const res = await fetch('/api' + url, { headers: { Authorization: `Bearer ${API.token()}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo generar el archivo');
    }
    const nombre = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'archivo';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

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

// Menú según el rol del empleado. Lo de administración va agrupado en un submenú.
const T = ['capturista', 'administrador', 'soporte'];
const A = ['administrador', 'soporte'];
const MENU = [
  { href: '/venta.html', texto: 'Captura', icono: 'cart3', roles: T },
  { href: '/cotizaciones.html', texto: 'Cotizaciones', icono: 'file-earmark-text', roles: T },
  { href: '/ventas.html', texto: 'Ventas', icono: 'receipt', roles: T },
  { href: '/clientes.html', texto: 'Clientes', icono: 'people', roles: T },
  { href: '/productos.html', texto: 'Productos', icono: 'box-seam', roles: T },
  { href: '/corte.html', texto: 'Mi caja', icono: 'cash-stack', roles: T },
  { href: '/panel.html', texto: 'Panel', icono: 'speedometer2', roles: A },
  { href: '/compras.html', texto: 'Compras', icono: 'truck', roles: A, grupo: true },
  { href: '/proveedores.html', texto: 'Proveedores', icono: 'building', roles: A, grupo: true },
  { href: '/reportes.html', texto: 'Reportes', icono: 'bar-chart', roles: A, grupo: true },
  { href: '/bitacora.html', texto: 'Bitácora', icono: 'journal-text', roles: A, grupo: true },
  { href: '/usuarios.html', texto: 'Usuarios', icono: 'person-gear', roles: ['soporte'], grupo: true },
  { href: '/papelerias.html', texto: 'Papelerías', icono: 'shop', roles: ['soporte'], grupo: true },
];

const ETIQUETA_ROL = { capturista: 'Capturista', administrador: 'Administrador', soporte: 'Soporte técnico' };

// Llamar al inicio de cada pantalla: revisa sesión y permisos, y pinta el menú
function requerirSesion(roles) {
  const u = API.usuario();
  if (!u || !API.token()) { location.href = '/'; throw new Error('Sin sesión'); }
  if (roles && !roles.includes(u.rol)) { location.href = '/venta.html'; throw new Error('Sin permiso'); }
  const nav = document.getElementById('nav');
  if (nav) {
    const mios = MENU.filter((m) => m.roles.includes(u.rol));
    const link = (m) => `<li class="nav-item"><a class="nav-link ${location.pathname === m.href ? 'active' : ''}" href="${m.href}">
         <i class="bi bi-${m.icono}"></i> ${m.texto}</a></li>`;
    const grupo = mios.filter((m) => m.grupo);
    const enGrupo = grupo.some((m) => m.href === location.pathname);
    nav.innerHTML = `
      <nav class="navbar navbar-dark navbar-expand-xl no-print">
        <div class="container-fluid">
          <a class="navbar-brand fw-bold" href="/venta.html">CRCASA</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu"><span class="navbar-toggler-icon"></span></button>
          <div class="collapse navbar-collapse" id="menu">
            <ul class="navbar-nav me-auto">${mios.filter((m) => !m.grupo).map(link).join('')}
              ${grupo.length ? `<li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle ${enGrupo ? 'active' : ''}" href="#" role="button" data-bs-toggle="dropdown"><i class="bi bi-gear"></i> Administración</a>
                <ul class="dropdown-menu">${grupo.map((m) => `<li><a class="dropdown-item ${location.pathname === m.href ? 'active' : ''}" href="${m.href}"><i class="bi bi-${m.icono}"></i> ${m.texto}</a></li>`).join('')}</ul>
              </li>` : ''}
            </ul>
            ${u.rol === 'soporte'
              ? `<select id="cambiar-papeleria" class="form-select form-select-sm me-3" style="width:200px" title="Papelería con la que trabajas">
                   <option>${esc(u.papeleria || 'Selecciona papelería')}</option></select>`
              : `<span class="navbar-text text-white me-3 papeleria-actual" title="${esc(u.papeleria || '')}"><i class="bi bi-shop"></i> ${esc(u.papeleria || '')}</span>`}
            ${u.id_papeleria ? '<a id="estado-caja" href="/corte.html" class="btn btn-sm me-2 btn-outline-light" title="Estado de tu caja"><i class="bi bi-cash-stack"></i> Caja…</a>' : ''}
            <div class="dropdown">
              <button class="btn btn-outline-light btn-sm dropdown-toggle" data-bs-toggle="dropdown">
                <i class="bi bi-person-circle"></i> ${esc(u.nombre)}</button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><h6 class="dropdown-header">${ETIQUETA_ROL[u.rol]}${u.papeleria ? ` · ${esc(u.papeleria)}` : ''}</h6></li>
                <li><a class="dropdown-item" href="#" id="menu-password"><i class="bi bi-key"></i> Cambiar mi contraseña</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="API.cerrarSesion()"><i class="bi bi-box-arrow-right"></i> Salir</a></li>
              </ul>
            </div>
          </div>
        </div>
      </nav>`;
    if (u.rol === 'soporte') prepararCambioPapeleria(u);
    document.getElementById('menu-password').addEventListener('click', (e) => { e.preventDefault(); abrirCambioPassword(); });
    if (u.id_papeleria) refrescarCaja().catch(() => {});
  }
  return u;
}

// ---------- Caja del empleado (apertura, estado y corte) ----------
// Estado de la caja que comparten el menú y las pantallas. refrescarCaja() lo vuelve a pedir al servidor.
let _caja = null;
async function refrescarCaja() {
  _caja = API.get('/caja');
  const c = await _caja;
  const b = document.getElementById('estado-caja');
  if (b) {
    b.className = `btn btn-sm me-2 ${c.abierta ? (c.de_otro_dia ? 'btn-warning' : 'btn-success') : 'btn-outline-warning'}`;
    b.innerHTML = c.abierta
      ? `<i class="bi bi-unlock"></i> Caja abierta · ${dinero(c.efectivo_esperado)}`
      : '<i class="bi bi-lock"></i> Caja cerrada';
    b.title = c.abierta
      ? `Abierta desde ${fecha(c.abierto_en)}. Efectivo que debería haber: ${dinero(c.efectivo_esperado)}${c.de_otro_dia ? '. ¡Es de otro día: haz tu corte!' : ''}`
      : 'Abre tu caja para poder registrar ventas';
  }
  document.dispatchEvent(new CustomEvent('caja', { detail: c }));
  return c;
}
const estadoCaja = () => _caja || refrescarCaja();

// Contador de efectivo: el empleado puede anotar cuántos billetes y monedas tiene de cada uno
// (el total se calcula solo) o escribir directamente el total.
const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
function contadorEfectivo(cont, { nombre = 'efectivo', alCambiar } = {}) {
  const etiqueta = (d) => (d >= 20 ? `$${d}` : d === 0.5 ? '50¢' : `$${d}`);
  cont.innerHTML = `
    <div class="input-group input-group-lg mb-2">
      <span class="input-group-text">$</span>
      <input type="number" min="0" step="0.5" class="form-control text-end fw-bold contador-total" name="${nombre}" placeholder="0.00" required>
    </div>
    <button type="button" class="btn btn-link btn-sm p-0 mb-2 contador-toggle"><i class="bi bi-calculator"></i> Contar por billetes y monedas</button>
    <div class="contador-denoms d-none">
      <div class="row g-1">${DENOMINACIONES.map((d) => `
        <div class="col-6 col-sm-4"><div class="input-group input-group-sm">
          <span class="input-group-text denom ${d >= 20 ? 'billete' : 'moneda'}">${etiqueta(d)}</span>
          <input type="number" min="0" step="1" class="form-control text-end" data-den="${d}" placeholder="0" aria-label="Piezas de ${etiqueta(d)}">
        </div></div>`).join('')}
      </div>
      <p class="form-text mb-0">Escribe cuántas piezas tienes de cada uno; el total se suma solo.</p>
    </div>`;
  const total = cont.querySelector('.contador-total');
  const piezas = [...cont.querySelectorAll('[data-den]')];
  cont.querySelector('.contador-toggle').addEventListener('click', () => {
    cont.querySelector('.contador-denoms').classList.toggle('d-none');
    piezas[0].focus();
  });
  piezas.forEach((i) => i.addEventListener('input', () => {
    const suma = piezas.reduce((s, x) => s + Number(x.dataset.den) * (parseInt(x.value, 10) || 0), 0);
    total.value = Math.round(suma * 100) / 100;
    alCambiar?.();
  }));
  // si escribe el total a mano, el desglose ya no aplica
  total.addEventListener('input', () => { piezas.forEach((x) => { x.value = ''; }); alCambiar?.(); });
  return {
    input: total,
    total: () => (total.value === '' ? null : Number(total.value)),
    desglose: () => {
      const d = {};
      piezas.forEach((x) => { const n = parseInt(x.value, 10); if (n > 0) d[x.dataset.den] = n; });
      return Object.keys(d).length ? d : undefined;
    },
    poner: (v) => { piezas.forEach((x) => { x.value = ''; }); total.value = v ?? ''; alCambiar?.(); },
  };
}

// Modal de apertura de caja: se usa al entrar a la captura y desde "Mi caja"
function abrirCaja({ obligatorio = false } = {}) {
  return new Promise((resolve) => {
    let el = document.getElementById('modal-abrir-caja');
    if (el) el.remove();
    el = document.createElement('div');
    el.className = 'modal fade'; el.id = 'modal-abrir-caja'; el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog"><form class="modal-content" novalidate>
      <div class="modal-header"><h5 class="modal-title"><i class="bi bi-unlock"></i> Abrir mi caja</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <p class="mb-2">Antes de vender, <strong>cuenta el efectivo que hay en tu caja</strong> (el fondo para dar cambio).
          Al cerrar tu turno, el corte se compara contra esta cantidad.</p>
        <div class="alert alert-light border small py-2 mb-3 d-none sugerencia"></div>
        <label class="form-label fw-semibold">¿Con cuánto efectivo empiezas?</label>
        <div class="contador"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${obligatorio ? 'Solo cotizar por ahora' : 'Cancelar'}</button>
        <button class="btn btn-success"><i class="bi bi-unlock"></i> Abrir caja</button>
      </div>
    </form></div>`;
    document.body.appendChild(el);
    const contador = contadorEfectivo(el.querySelector('.contador'), { nombre: 'fondo_inicial' });
    const modal = new bootstrap.Modal(el, { backdrop: obligatorio ? 'static' : true });
    let abierta = null;
    estadoCaja().then((c) => {
      if (c.abierta) return;
      const s = el.querySelector('.sugerencia');
      s.innerHTML = `<i class="bi bi-lightbulb"></i> El fondo de caja habitual es <strong>${dinero(c.fondo_sugerido)}</strong>
        <button type="button" class="btn btn-sm btn-outline-primary ms-2 py-0">Usar ${dinero(c.fondo_sugerido)}</button>
        ${c.ultimo_corte ? `<br>Tu último corte (${fecha(c.ultimo_corte.hasta)}) cerró con ${dinero(c.ultimo_corte.efectivo_contado)} contados.` : ''}`;
      s.classList.remove('d-none');
      s.querySelector('button').addEventListener('click', () => contador.poner(c.fondo_sugerido));
    }).catch(() => {});
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (contador.total() === null) { contador.input.focus(); return avisar('Escribe con cuánto efectivo empiezas (puede ser 0)', 'warning'); }
      try {
        const r = await API.post('/caja/abrir', { fondo_inicial: contador.total(), desglose: contador.desglose() });
        avisar(r.mensaje);
        abierta = r.caja;
        modal.hide();
      } catch (err) { avisarError(err); }
    });
    el.addEventListener('shown.bs.modal', () => contador.input.focus());
    el.addEventListener('hidden.bs.modal', async () => {
      el.remove();
      if (abierta) await refrescarCaja().catch(() => {});
      resolve(abierta);
    });
    modal.show();
  });
}

// Cada empleado puede cambiar su propia contraseña desde el menú de su nombre
function abrirCambioPassword() {
  let el = document.getElementById('modal-password');
  if (!el) {
    el = document.createElement('div');
    el.className = 'modal fade'; el.id = 'modal-password'; el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog"><form class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Cambiar mi contraseña</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-2"><label class="form-label">Contraseña actual</label><input name="actual" type="password" class="form-control" required autocomplete="current-password"></div>
        <div class="mb-2"><label class="form-label">Nueva contraseña</label><input name="nueva" type="password" class="form-control" required minlength="8" autocomplete="new-password"></div>
        <div class="mb-2"><label class="form-label">Repite la nueva contraseña</label><input name="repetir" type="password" class="form-control" required minlength="8" autocomplete="new-password"></div>
        <p class="form-text mb-0">Mínimo 8 caracteres.</p>
      </div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary">Guardar</button></div>
    </form></div>`;
    document.body.appendChild(el);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.nueva.value !== f.repetir.value) return avisar('Las contraseñas nuevas no coinciden', 'warning');
      try {
        avisar((await API.post('/auth/password', { actual: f.actual.value, nueva: f.nueva.value })).mensaje);
        f.reset();
        bootstrap.Modal.getInstance(el).hide();
      } catch (err) { avisarError(err); }
    });
  }
  bootstrap.Modal.getOrCreateInstance(el).show();
}

// Soporte técnico atiende a todas las papelerías: elige con cuál trabajar
async function prepararCambioPapeleria(u) {
  const sel = document.getElementById('cambiar-papeleria');
  try {
    const lista = (await API.get('/papelerias')).filter((p) => p.activo);
    sel.innerHTML = lista.map((p) => `<option value="${p.id_papeleria}" ${p.id_papeleria === u.id_papeleria ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
    sel.addEventListener('change', async () => {
      API.guardarSesion(await API.post('/auth/papeleria', { id_papeleria: Number(sel.value) }));
      location.reload();
    });
  } catch (err) { avisarError(err); }
}

// ---------- Formato ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fecha = (f) => (f ? new Date(f.replace(' ', 'T')).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fechaCorta = (f) => (f ? new Date(f.slice(0, 10) + 'T12:00').toLocaleDateString('es-MX') : '');

const ESTADOS = {
  vigente: ['Vigente', 'primary'], convertida: ['Convertida en venta', 'success'],
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
