SET NAMES utf8mb4;
-- Datos de prueba: 3 papelerías que usan el mismo sistema, cada una con sus propios datos.
-- Los productos son de ejemplo hasta tener el catálogo real de cada negocio.
-- Los usuarios se crean con: npm run crear-usuario
USE papeleria_crcasa;

INSERT INTO papelerias (id_papeleria, nombre, giro, direccion, telefono) VALUES
(1, 'Papelería El Estudiante', 'Artículos escolares y de oficina', 'Av. Revolución 1520, Zona Centro', '664-200-1001'),
(2, 'Papelería La Pluma',      'Papelería, copias y regalos',      'Blvd. Díaz Ordaz 3410, La Mesa',  '664-200-2002'),
(3, 'Papelería Arcoíris',      'Material escolar, de arte y oficina', 'Calle Segunda 890, Otay',     '664-200-3003');

-- Reglas de cada papelería (cada administrador puede cambiarlas desde su panel)
INSERT INTO configuracion (id_papeleria, clave, valor, descripcion)
SELECT id_papeleria, 'tope_descuento', IF(id_papeleria = 3, '10', '15'),
       'Porcentaje máximo de descuento que puede aplicar el capturista en una operación' FROM papelerias;
INSERT INTO configuracion (id_papeleria, clave, valor, descripcion)
SELECT id_papeleria, 'dias_vigencia_cotizacion', IF(id_papeleria = 2, '10', '15'),
       'Días de vigencia de una cotización' FROM papelerias;

-- Cada papelería tiene su cliente PG para ventas de mostrador sin registro
INSERT INTO clientes (id_papeleria, codigo, nombre, porcentaje_descuento)
SELECT id_papeleria, 'PG', 'Público en general', 0 FROM papelerias ORDER BY id_papeleria;

INSERT INTO clientes (id_papeleria, codigo, nombre, telefono, email, rfc, porcentaje_descuento) VALUES
(1, 'C-0001', 'Escuela Primaria Benito Juárez',  '664-100-0001', 'compras@primariabj.test',  'EPB900101AB1', 10),
(1, 'C-0002', 'Despacho Contable Ríos',          '664-100-0002', 'admin@contarios.test',     'DCR050505CD2', 5),
(1, 'C-0003', 'María López Hernández',           '664-100-0003', NULL,                       NULL,           3),
(2, 'C-0001', 'Secundaria Técnica 45',           '664-110-0001', 'direccion@est45.test',     'STF850202EF3', 8),
(2, 'C-0002', 'Notaría Pública 12',              '664-110-0002', 'oficina@notaria12.test',   'NPD010303GH4', 5),
(3, 'C-0001', 'Colegio Arcángel',                '664-120-0001', 'compras@arcangel.test',    'CAR920404IJ5', 10),
(3, 'C-0002', 'Taller de Arte Pinceladas',       '664-120-0002', NULL,                       NULL,           5);

-- Cliente con un RFC de PRUEBA del SAT: es el que acepta el sandbox del PAC para timbrar facturas de prueba
INSERT INTO clientes (id_papeleria, codigo, nombre, email, rfc, porcentaje_descuento)
SELECT id_papeleria, 'C-PRUEBA', 'UNIVERSIDAD ROBOTICA ESPAÑOLA', 'facturas@ure.test', 'URE180429TM6', 0 FROM papelerias ORDER BY id_papeleria;

INSERT INTO clasificaciones (id_papeleria, nombre, descripcion)
SELECT p.id_papeleria, c.nombre, c.descripcion FROM papelerias p CROSS JOIN (
  SELECT 1 AS orden, 'Escolar' AS nombre, 'Cuadernos, lápices, plumas, colores y útiles escolares' AS descripcion
  UNION ALL SELECT 2, 'Oficina', 'Papel, carpetas, engrapadoras, folders y archivo'
  UNION ALL SELECT 3, 'Arte', 'Pinturas, pinceles, papel para dibujo y manualidades'
  UNION ALL SELECT 4, 'Accesorios de cómputo', 'Calculadoras, memorias USB, mouse y cables') c
ORDER BY p.id_papeleria, c.orden;

INSERT INTO proveedores (id_papeleria, nombre, contacto, telefono, email)
SELECT p.id_papeleria, v.nombre, v.contacto, v.telefono, v.email FROM papelerias p CROSS JOIN (
  SELECT 1 AS orden, 'Distribuidora Escolar del Norte' AS nombre, 'Laura Méndez' AS contacto, '664-000-0001' AS telefono, 'ventas@escolarnorte.test' AS email
  UNION ALL SELECT 2, 'Papelera Industrial BC', 'Jorge Ruiz', '664-000-0002', 'contacto@papelerabc.test') v
ORDER BY p.id_papeleria, v.orden;

-- Catálogo base; cada papelería maneja sus propios precios y existencias
CREATE TABLE tmp_catalogo (codigo VARCHAR(30), nombre VARCHAR(120), descripcion VARCHAR(255), precio DECIMAL(10,2),
  costo DECIMAL(10,2), existencia INT, minima INT, clasif VARCHAR(60), proveedor VARCHAR(120));
INSERT INTO tmp_catalogo VALUES
('ESC-001', 'Cuaderno profesional raya 100 hojas', 'Cuaderno cosido, pasta dura', 45.00, 28.00, 200, 30, 'Escolar', 'Distribuidora Escolar del Norte'),
('ESC-002', 'Lápiz HB No. 2 (caja 12)', 'Caja con 12 lápices de grafito', 38.50, 22.00, 150, 20, 'Escolar', 'Distribuidora Escolar del Norte'),
('ESC-003', 'Bolígrafo azul punto mediano', 'Pluma de tinta azul', 8.00, 3.50, 500, 100, 'Escolar', 'Distribuidora Escolar del Norte'),
('ESC-004', 'Colores de madera 24 piezas', 'Caja con 24 colores', 89.90, 55.00, 80, 15, 'Escolar', 'Distribuidora Escolar del Norte'),
('OFI-001', 'Paquete hojas carta 500', 'Papel bond blanco 75 g', 115.00, 78.00, 120, 20, 'Oficina', 'Papelera Industrial BC'),
('OFI-002', 'Folder tamaño carta (25 pzas)', 'Folder manila', 72.00, 45.00, 90, 15, 'Oficina', 'Papelera Industrial BC'),
('OFI-003', 'Engrapadora estándar', 'Capacidad 20 hojas', 95.00, 60.00, 40, 5, 'Oficina', 'Papelera Industrial BC'),
('ART-001', 'Set de acuarelas 12 colores', 'Incluye pincel', 64.00, 38.00, 60, 10, 'Arte', 'Distribuidora Escolar del Norte'),
('ART-002', 'Block de dibujo 30 hojas', 'Papel marquilla', 52.00, 30.00, 70, 10, 'Arte', 'Distribuidora Escolar del Norte'),
('CMP-001', 'Calculadora científica', '240 funciones', 289.00, 190.00, 25, 5, 'Accesorios de cómputo', 'Papelera Industrial BC'),
('CMP-002', 'Memoria USB 32 GB', 'USB 3.0', 149.00, 95.00, 35, 5, 'Accesorios de cómputo', 'Papelera Industrial BC');

INSERT INTO productos (id_papeleria, codigo, nombre, descripcion, precio_venta, costo, existencia, existencia_minima, id_clasificacion, id_proveedor)
SELECT p.id_papeleria, t.codigo, t.nombre, t.descripcion,
       ROUND(t.precio * CASE p.id_papeleria WHEN 2 THEN 1.05 WHEN 3 THEN 0.95 ELSE 1 END, 2),
       t.costo, t.existencia - (p.id_papeleria - 1) * 5, t.minima, c.id_clasificacion, pr.id_proveedor
FROM papelerias p
CROSS JOIN tmp_catalogo t
JOIN clasificaciones c ON c.id_papeleria = p.id_papeleria AND c.nombre = t.clasif
JOIN proveedores pr ON pr.id_papeleria = p.id_papeleria AND pr.nombre = t.proveedor
ORDER BY p.id_papeleria, t.codigo;

DROP TABLE tmp_catalogo;

-- Existencia inicial de cada producto en el kárdex
INSERT INTO movimientos_inventario (id_papeleria, id_producto, tipo, cantidad, existencia, referencia)
SELECT id_papeleria, id_producto, 'inicial', existencia, existencia, 'Existencia inicial' FROM productos ORDER BY id_producto;
