// Helpers compartidos por todas las páginas
const API = {
  token: () => localStorage.getItem('token'),
  usuario: () => JSON.parse(localStorage.getItem('usuario') || 'null'),

  async request(url, opciones = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (API.token()) headers.Authorization = `Bearer ${API.token()}`;
    const res = await fetch(url, { ...opciones, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error inesperado');
    return data;
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

// Pinta la barra de usuario en el navbar (si existe #nav-usuario)
function pintarNavUsuario() {
  const cont = document.getElementById('nav-usuario');
  if (!cont) return;
  const u = API.usuario();
  if (u) {
    cont.innerHTML = `<span class="navbar-text me-3">Hola, ${u.nombre} <span class="badge bg-light text-dark">${u.rol}</span></span>
      <button class="btn btn-outline-light btn-sm" onclick="API.cerrarSesion()">Salir</button>`;
  } else {
    cont.innerHTML = `<a class="btn btn-outline-light btn-sm me-2" href="/login.html">Iniciar sesión</a>
      <a class="btn btn-light btn-sm" href="/registro.html">Registrarse</a>`;
  }
}
document.addEventListener('DOMContentLoaded', pintarNavUsuario);
