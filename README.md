# CRCASA · Sistema de ventas e inventario para papelería

Sistema web de punto de venta y control de inventario para una papelería de artículos escolares y de oficina. Lo usan los **empleados** de la papelería (principalmente el capturista en mostrador) para registrar ventas, elaborar cotizaciones, administrar clientes y registrar compras a proveedores. **Los clientes no entran al sistema.**

**Materia:** Programación Web (AEB-1055) · TecNM Campus Tijuana · Ago–Dic 2026
**Equipo CRCASA:** Carretero Ocaña Kevin Isaac · Cruz Cárdenas Luis Ángel · Sánchez Sánchez Ximena Montserrat
**Profesor:** Rogelio Escobedo Mitre

## Conceptos (corregidos en la revisión)

| Término | Significado | Efecto en inventario |
|---|---|---|
| **Usuario** | Empleado que usa el sistema (capturista, administrador, soporte) | — |
| **Cliente** | A quien le vendemos. Está en el catálogo de clientes, no inicia sesión | — |
| **Proveedor** | A quien le compramos mercancía | — |
| **Venta** | Operación con un cliente | **Resta** existencia |
| **Compra** | Operación con un proveedor | **Suma** existencia |
| **Cotización** | Propuesta de precio para un cliente | **No afecta** |
| **Factura** | Documento fiscal que se emite al cliente sobre una venta | — |

## Roles

| Rol | Quién es | Qué puede hacer |
|---|---|---|
| Capturista | Empleado de mostrador | Captura de ventas y cotizaciones, alta de clientes, consulta de productos, marcar pedidos entregados, registrar facturas, ajustar el descuento de una operación hasta el tope |
| Administrador | Dueño o encargado de la papelería | Todo lo anterior + productos, clasificaciones, proveedores, compras, asignar % de descuento a clientes, tope de descuento, cancelar ventas, panel de resumen |
| Soporte técnico | Equipo de desarrollo | Todo + usuarios del sistema. Es el único que crea o desactiva empleados |

## Reglas de negocio

- **Descuento asignado por cliente:** cada cliente tiene un porcentaje fijo que asigna el administrador en el catálogo de clientes. Al teclear el código del cliente en la captura aparece su descuento y se aplica al total. **Los descuentos no se acumulan.**
- **El capturista tiene la última palabra:** puede cambiar o quitar el descuento de una operación, de 0% hasta el tope que fija el administrador (15% por defecto).
- **Cotizaciones:** tienen vigencia (15 días por defecto). Mientras estén vigentes se pueden editar: quitar, agregar o cambiar cantidades, y todo se recalcula. Los productos que ya estaban conservan el precio cotizado. No apartan mercancía.
- **Convertir cotización en venta:** se valida la existencia; si falta algún producto, el sistema lista qué falta y el capturista decide si ajusta la cantidad o lo quita. Solo al convertirla se descuenta el inventario.
- **Pedido para recoger:** se registra como venta con estado *pendiente de entrega* y se marca como *entregada* cuando el cliente pasa por él.
- **Cancelar una venta** (solo administrador) regresa la mercancía a la existencia. Una venta facturada no se cancela.
- La existencia de un producto solo cambia por ventas, compras y cancelaciones; no se edita a mano.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript, Bootstrap 5 (servido local desde npm) |
| Backend | Node.js + Express |
| Base de datos | MySQL / MariaDB |
| Autenticación | JWT + contraseñas con bcrypt |

## Estructura

```
database/        schema.sql (13 tablas) y seed.sql (datos de prueba)
scripts/         crear-usuario.js
src/
  app.js         servidor Express
  config/        conexión a MySQL y helper de transacciones
  middleware/    verificación de token y roles
  services/      cálculo de partidas, descuentos y existencia
  controllers/   lógica de cada módulo
  routes/        endpoints de la API
public/          pantallas (HTML + JS)
tests/           prueba de punta a punta de los flujos principales
```

## Cómo correrlo

```bash
git clone https://github.com/xsep423/CRCASA.git
cd CRCASA
npm install
cp .env.example .env          # pon tu usuario/contraseña de MySQL
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
npm run crear-usuario -- soporte Soporte2026 soporte "Soporte CRCASA"
npm run crear-usuario -- admin Admin2026x administrador "Dueño de la papelería"
npm run crear-usuario -- caja1 Caja2026xx capturista "Capturista 1"
npm run dev
```

Abrir http://localhost:3000 · Probar conexión: http://localhost:3000/api/salud · Pruebas: `npm test`

> Ojo: `schema.sql` borra y vuelve a crear la base de datos `papeleria_crcasa`.

## Pantallas

| Pantalla | Archivo | Roles |
|---|---|---|
| Inicio de sesión (empleados) | `index.html` | Todos |
| Captura de venta / cotización (carátula) | `venta.html` | Todos |
| Cotizaciones | `cotizaciones.html` | Todos |
| Ventas, pedidos para recoger y facturas | `ventas.html` | Todos (cancelar: admin) |
| Clientes | `clientes.html` | Todos (descuento y baja: admin) |
| Productos | `productos.html` | Consulta todos, edición admin |
| Compras a proveedores | `compras.html` | Admin |
| Proveedores | `proveedores.html` | Admin |
| Panel (resumen, reglas de descuento, clasificaciones) | `panel.html` | Admin |
| Usuarios | `usuarios.html` | Soporte |
| Nota de venta / cotización imprimible | `nota.html` | Todos |

**Atajos en la captura:** Enter agrega el producto (acepta lector de código de barras) · F2 registra la venta · F4 guarda la cotización.

## API

Todo requiere `Authorization: Bearer <token>` excepto el login.

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/login` | Público |
| GET | `/api/productos?buscar=&clasificacion=&bajo_minimo=1` · `/api/productos/codigo/:codigo` | Todos |
| POST / PUT / DELETE | `/api/productos/:id` | Admin |
| GET / POST / PUT | `/api/clientes` · `/api/clientes/codigo/:codigo` | Todos (el % solo lo cambia admin) |
| CRUD | `/api/clasificaciones`, `/api/proveedores` | Admin (consulta de clasificaciones: todos) |
| GET / POST / PUT | `/api/cotizaciones` | Todos |
| POST | `/api/cotizaciones/:id/convertir` · `/api/cotizaciones/:id/cancelar` | Todos |
| GET / POST | `/api/ventas` | Todos |
| POST | `/api/ventas/:id/entregar` · `/api/ventas/:id/factura` | Todos |
| POST | `/api/ventas/:id/cancelar` | Admin |
| GET / POST | `/api/compras` | Admin |
| GET / PUT | `/api/configuracion` | Consulta todos, cambio admin |
| GET | `/api/resumen` | Admin |
| GET / POST / PUT | `/api/usuarios` | Soporte |

## Limitaciones

- Los clientes no tienen acceso al sistema ni compran en línea; no hay pago en línea ni envíos.
- No se muestran imágenes de productos.
- La factura se registra, pero no se timbra ante el SAT.
- La fidelidad no se calcula sola: el descuento lo asigna el administrador.
- Una sola sucursal.

## Flujo de trabajo en equipo

1. Nunca trabajar directo en `main`. Cada quien crea su rama: `git checkout -b feature/nombre`
2. Commits pequeños y claros.
3. Subir la rama y abrir un **Pull Request** en GitHub; otro integrante lo revisa antes del merge.
4. Antes de empezar a trabajar: `git checkout main && git pull`
