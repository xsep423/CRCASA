# 📚 Papelería en línea CRCASA

Tienda en línea de artículos escolares y de oficina con ventas para clientes individuales y cotizaciones por volumen para mayoristas.

**Materia:** Programación Web (AEB-1055) · TecNM Campus Tijuana · Ago–Dic 2026
**Equipo CRCASA:** Carretero Ocaña Kevin Isaac · Cruz Cárdenas Luis Ángel · Sánchez Sánchez Ximena Montserrat
**Profesor:** Rogelio Escobedo Mitre

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript, Bootstrap 5 |
| Backend | Node.js + Express |
| Base de datos | MySQL |
| Autenticación | JWT + contraseñas con bcrypt |

## Estructura

```
database/        schema.sql (8 tablas) y seed.sql (datos de prueba)
scripts/         crear-admin.js
src/
  app.js         servidor Express
  config/        conexión a MySQL
  middleware/    verificación de token y roles
  controllers/   lógica de cada módulo
  routes/        endpoints de la API
public/          páginas HTML, CSS y JS del frontend
```

## Cómo correrlo

```bash
git clone https://github.com/<usuario>/crcasa-papeleria.git
cd crcasa-papeleria
npm install
cp .env.example .env          # edita tu usuario/contraseña de MySQL
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
npm run crear-admin -- admin@crcasa.test Admin12345 "Administrador"
npm run dev
```

Abrir http://localhost:3000 · Probar conexión: http://localhost:3000/api/salud

## API actual

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/registro` | Público (cliente / mayorista) |
| POST | `/api/auth/login` | Público |
| GET | `/api/auth/perfil` | Con token |
| GET | `/api/clasificaciones` | Público |
| GET | `/api/productos?clasificacion=&buscar=` | Público |
| GET | `/api/productos/:id` | Público |
| POST / PUT / DELETE | `/api/productos/:id` | Admin |

## Avance

- [x] Base de datos con las 8 tablas e integridad referencial
- [x] Registro e inicio de sesión con roles (bcrypt + JWT)
- [x] Catálogo público con filtro por categoría y búsqueda
- [x] API CRUD de productos (solo admin)
- [ ] CRUD de clasificaciones y proveedores
- [ ] Carrito de compras y módulo de ventas (descuento de stock)
- [ ] Módulo de cotizaciones mayoristas con descuentos escalonados
- [ ] Panel de administración
- [ ] Historial de compras y cotizaciones por usuario
- [ ] Reportes básicos

## Flujo de trabajo en equipo

1. Nunca trabajar directo en `main`. Cada quien crea su rama: `git checkout -b feature/carrito`
2. Hacer commits pequeños y claros: `git commit -m "Agrega endpoint para crear venta"`
3. Subir la rama (`git push -u origin feature/carrito`) y abrir un **Pull Request** en GitHub.
4. Otro integrante revisa y aprueba el PR antes de hacer merge.
5. Antes de empezar a trabajar: `git checkout main && git pull`
