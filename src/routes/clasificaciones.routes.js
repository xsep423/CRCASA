const router = require('express').Router();
const pool = require('../config/db');

// GET /api/clasificaciones (público, para el filtro del catálogo)
// TODO: agregar POST/PUT/DELETE solo para admin (igual que productos)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clasificaciones ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener clasificaciones' });
  }
});

module.exports = router;
