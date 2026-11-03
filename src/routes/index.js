// Todas las rutas de la API. Todo requiere sesión de empleado salvo /auth/login.
const router = require('express').Router();
const { manejar: m } = require('../utils/http');
const { ROLES, verificarToken, permitirRoles } = require('../middleware/auth');

const auth = require('../controllers/auth.controller');
const productos = require('../controllers/productos.controller');
const clientes = require('../controllers/clientes.controller');
const { clasificaciones, proveedores } = require('../controllers/catalogos.controller');
const cotizaciones = require('../controllers/cotizaciones.controller');
const ventas = require('../controllers/ventas.controller');
const compras = require('../controllers/compras.controller');
const admin = require('../controllers/admin.controller');

const todos = permitirRoles(...ROLES.TODOS);
const soloAdmin = permitirRoles(...ROLES.ADMIN);
const soloSoporte = permitirRoles(...ROLES.SOPORTE);

// ---------- Sesión ----------
router.post('/auth/login', m(auth.login));
router.use(verificarToken); // a partir de aquí, todo requiere token
router.get('/auth/perfil', auth.perfil);

// ---------- Productos ----------
router.get('/productos', todos, m(productos.listar));
router.get('/productos/codigo/:codigo', todos, m(productos.porCodigo));
router.get('/productos/:id', todos, m(productos.obtener));
router.post('/productos', soloAdmin, m(productos.crear));
router.put('/productos/:id', soloAdmin, m(productos.actualizar));
router.delete('/productos/:id', soloAdmin, m(productos.eliminar));

// ---------- Clasificaciones ----------
router.get('/clasificaciones', todos, m(clasificaciones.listar));
router.post('/clasificaciones', soloAdmin, m(clasificaciones.crear));
router.put('/clasificaciones/:id', soloAdmin, m(clasificaciones.actualizar));
router.delete('/clasificaciones/:id', soloAdmin, m(clasificaciones.eliminar));

// ---------- Clientes (a quienes vendemos) ----------
router.get('/clientes', todos, m(clientes.listar));
router.get('/clientes/codigo/:codigo', todos, m(clientes.porCodigo));
router.get('/clientes/:id', todos, m(clientes.obtener));
router.post('/clientes', todos, m(clientes.crear));
router.put('/clientes/:id', todos, m(clientes.actualizar));
router.delete('/clientes/:id', soloAdmin, m(clientes.eliminar));

// ---------- Proveedores (a quienes compramos) ----------
router.get('/proveedores', soloAdmin, m(proveedores.listar));
router.post('/proveedores', soloAdmin, m(proveedores.crear));
router.put('/proveedores/:id', soloAdmin, m(proveedores.actualizar));
router.delete('/proveedores/:id', soloAdmin, m(proveedores.eliminar));

// ---------- Cotizaciones (no afectan existencia) ----------
router.get('/cotizaciones', todos, m(cotizaciones.listar));
router.get('/cotizaciones/:id', todos, m(cotizaciones.obtener));
router.post('/cotizaciones', todos, m(cotizaciones.crear));
router.put('/cotizaciones/:id', todos, m(cotizaciones.actualizar));
router.post('/cotizaciones/:id/cancelar', todos, m(cotizaciones.cancelar));
router.post('/cotizaciones/:id/convertir', todos, m(cotizaciones.convertir));

// ---------- Ventas (restan existencia) ----------
router.get('/ventas', todos, m(ventas.listar));
router.get('/ventas/:id', todos, m(ventas.obtener));
router.post('/ventas', todos, m(ventas.crear));
router.post('/ventas/:id/entregar', todos, m(ventas.entregar));
router.post('/ventas/:id/factura', todos, m(ventas.facturar));
router.post('/ventas/:id/cancelar', soloAdmin, m(ventas.cancelar));

// ---------- Compras a proveedores (suman existencia) ----------
router.get('/compras', soloAdmin, m(compras.listar));
router.get('/compras/:id', soloAdmin, m(compras.obtener));
router.post('/compras', soloAdmin, m(compras.crear));

// ---------- Administración ----------
router.get('/configuracion', todos, m(admin.configuracion.obtener));
router.put('/configuracion', soloAdmin, m(admin.configuracion.actualizar));
router.get('/resumen', soloAdmin, m(admin.resumen));

// ---------- Usuarios / empleados (solo soporte técnico) ----------
router.get('/usuarios', soloSoporte, m(admin.usuarios.listar));
router.post('/usuarios', soloSoporte, m(admin.usuarios.crear));
router.put('/usuarios/:id', soloSoporte, m(admin.usuarios.actualizar));

module.exports = router;
