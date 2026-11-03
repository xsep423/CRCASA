// Crea (o actualiza la contraseña de) un empleado desde la terminal.
// El primer usuario debe ser de soporte; después los demás se crean desde la pantalla Usuarios.
// Uso: npm run crear-usuario -- <usuario> <password> <rol> ["Nombre completo"]
//   rol: capturista | administrador | soporte
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

(async () => {
  const [usuario, password, rol, nombre] = process.argv.slice(2);
  const roles = ['capturista', 'administrador', 'soporte'];
  if (!usuario || !password || password.length < 8 || !roles.includes(rol)) {
    console.log('Uso: npm run crear-usuario -- <usuario> <password (mín. 8)> <capturista|administrador|soporte> ["Nombre"]');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = VALUES(rol), activo = 1`,
    [nombre || usuario, usuario.toLowerCase(), hash, rol]
  );
  console.log(`Usuario listo: ${usuario} (${rol})`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
