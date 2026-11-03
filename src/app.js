require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db');
const { manejadorErrores } = require('./utils/http');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
// Bootstrap se sirve local (desde npm) para que funcione sin internet en el mostrador
const modulos = path.join(__dirname, '..', 'node_modules');
app.use('/vendor/bootstrap', express.static(path.join(modulos, 'bootstrap', 'dist')));
app.use('/vendor/icons', express.static(path.join(modulos, 'bootstrap-icons', 'font')));

// Prueba rápida de conexión a la BD (pública)
app.get('/api/salud', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, bd: 'conectada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', require('./routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(manejadorErrores);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Servidor CRCASA en http://localhost:${PORT}`));
}

module.exports = app;
