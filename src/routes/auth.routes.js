const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { verificarToken } = require('../middleware/auth');

router.post('/registro', ctrl.registro);
router.post('/login', ctrl.login);
router.get('/perfil', verificarToken, ctrl.perfil);

module.exports = router;
