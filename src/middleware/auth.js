const jwt = require('jsonwebtoken');

// Roles de los EMPLEADOS (los clientes no inician sesión)
//  capturista    -> mostrador: ventas, cotizaciones, clientes
//  administrador -> dueño/encargado de la papelería: catálogos, compras, descuentos, reportes
//  soporte       -> equipo de desarrollo: todo, incluyendo usuarios y configuración técnica
const ROLES = {
  TODOS: ['capturista', 'administrador', 'soporte'],
  ADMIN: ['administrador', 'soporte'],
  SOPORTE: ['soporte'],
};

// Verifica que la petición traiga un token válido: Authorization: Bearer <token>
function verificarToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET); // { id, nombre, rol }
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

// Restringe una ruta a ciertos roles. Ej: permitirRoles(...ROLES.ADMIN)
function permitirRoles(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

const esAdmin = (usuario) => ROLES.ADMIN.includes(usuario?.rol);

module.exports = { ROLES, verificarToken, permitirRoles, esAdmin };
