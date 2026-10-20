require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rutas de la API
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/productos', require('./routes/productos.routes'));
app.use('/api/clasificaciones', require('./routes/clasificaciones.routes'));
// Pendientes: /api/proveedores, /api/ventas, /api/cotizaciones, /api/reportes

// Prueba rápida de conexión a la BD
app.get('/api/salud', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, bd: 'conectada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor CRCASA en http://localhost:${PORT}`));
