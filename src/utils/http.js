// Error con código HTTP para responder mensajes claros al frontend
class HttpError extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

// Envuelve un controlador async para no repetir try/catch en cada uno
const manejar = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

// Middleware final de errores (se registra al final de app.js)
function manejadorErrores(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor (código, usuario o folio repetido)' });
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'No se puede eliminar: hay registros relacionados' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error en el servidor' });
}

const redondear = (n) => Math.round(Number(n) * 100) / 100;

module.exports = { HttpError, manejar, manejadorErrores, redondear };
