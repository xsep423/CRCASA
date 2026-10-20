const router = require('express').Router();
const ctrl = require('../controllers/productos.controller');
const { verificarToken, permitirRoles } = require('../middleware/auth');

// Públicas (catálogo)
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);

// Solo administrador
router.post('/', verificarToken, permitirRoles('admin'), ctrl.crear);
router.put('/:id', verificarToken, permitirRoles('admin'), ctrl.actualizar);
router.delete('/:id', verificarToken, permitirRoles('admin'), ctrl.eliminar);

module.exports = router;
