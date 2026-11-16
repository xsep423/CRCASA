// Crea (o actualiza la contraseña de) un empleado desde la terminal.
// El primer usuario debe ser de soporte; después los demás se crean desde la pantalla Usuarios.
// Uso: npm run crear-usuario -- <usuario> <password> <rol> ["Nombre completo"] [id_papeleria]
//   rol: capturista | administrador | soporte
//   id_papeleria: obligatorio para capturista y administrador (1, 2 o 3 con los datos de prueba)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

(async () => {
  const [usuario, password, rol, nombre, papeleria] = process.argv.slice(2);
  const roles = ['capturista', 'administrador', 'soporte'];
  if (!usuario || !password || password.length < 8 || !roles.includes(rol)) {
    console.log('Uso: npm run crear-usuario -- <usuario> <password (mín. 8)> <capturista|administrador|soporte> ["Nombre"] [id_papeleria]');
    process.exit(1);
  }
  const idPap = rol === 'soporte' ? null : Number(papeleria);
  if (rol !== 'soporte' && !idPap) {
    console.log('Para capturista y administrador indica la papelería (ej. 1, 2 o 3) como quinto dato');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuarios (id_papeleria, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = VALUES(rol),
       id_papeleria = VALUES(id_papeleria), activo = 1`,
    [idPap, nombre || usuario, usuario.toLowerCase(), hash, rol]
  );
  console.log(`Usuario listo: ${usuario} (${rol}${idPap ? `, papelería ${idPap}` : ', todas las papelerías'})`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
