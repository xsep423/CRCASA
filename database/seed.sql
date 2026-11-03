SET NAMES utf8mb4;
-- Datos de prueba (los productos son de ejemplo hasta tener el catálogo real)
-- Los usuarios se crean con: npm run crear-usuario
USE papeleria_crcasa;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
('tope_descuento', '15', 'Porcentaje máximo de descuento que puede aplicar el capturista en una operación'),
('dias_vigencia_cotizacion', '15', 'Días de vigencia de una cotización');

-- El cliente PG se usa para ventas de mostrador sin registro
INSERT INTO clientes (codigo, nombre, telefono, email, rfc, porcentaje_descuento) VALUES
('PG',     'Público en general',              NULL,           NULL,                       NULL,            0),
('C-0001', 'Escuela Primaria Benito Juárez',  '664-100-0001', 'compras@primariabj.test',  'EPB900101AB1',  10),
('C-0002', 'Despacho Contable Ríos',          '664-100-0002', 'admin@contarios.test',     'DCR050505CD2',  5),
('C-0003', 'María López Hernández',           '664-100-0003', NULL,                       NULL,            3);

INSERT INTO clasificaciones (nombre, descripcion) VALUES
('Escolar', 'Cuadernos, lápices, plumas, colores y útiles escolares'),
('Oficina', 'Papel, carpetas, engrapadoras, folders y archivo'),
('Arte', 'Pinturas, pinceles, papel para dibujo y manualidades'),
('Accesorios de cómputo', 'Calculadoras, memorias USB, mouse y cables');

INSERT INTO proveedores (nombre, contacto, telefono, email) VALUES
('Distribuidora Escolar del Norte', 'Laura Méndez', '664-000-0001', 'ventas@escolarnorte.test'),
('Papelera Industrial BC', 'Jorge Ruiz', '664-000-0002', 'contacto@papelerabc.test');

INSERT INTO productos (codigo, nombre, descripcion, precio_venta, costo, existencia, existencia_minima, id_clasificacion, id_proveedor) VALUES
('ESC-001', 'Cuaderno profesional raya 100 hojas', 'Cuaderno cosido, pasta dura', 45.00, 28.00, 200, 30, 1, 1),
('ESC-002', 'Lápiz HB No. 2 (caja 12)', 'Caja con 12 lápices de grafito', 38.50, 22.00, 150, 20, 1, 1),
('ESC-003', 'Bolígrafo azul punto mediano', 'Pluma de tinta azul', 8.00, 3.50, 500, 100, 1, 1),
('ESC-004', 'Colores de madera 24 piezas', 'Caja con 24 colores', 89.90, 55.00, 80, 15, 1, 1),
('OFI-001', 'Paquete hojas carta 500', 'Papel bond blanco 75 g', 115.00, 78.00, 120, 20, 2, 2),
('OFI-002', 'Folder tamaño carta (25 pzas)', 'Folder manila', 72.00, 45.00, 90, 15, 2, 2),
('OFI-003', 'Engrapadora estándar', 'Capacidad 20 hojas', 95.00, 60.00, 40, 5, 2, 2),
('ART-001', 'Set de acuarelas 12 colores', 'Incluye pincel', 64.00, 38.00, 60, 10, 3, 1),
('ART-002', 'Block de dibujo 30 hojas', 'Papel marquilla', 52.00, 30.00, 70, 10, 3, 1),
('CMP-001', 'Calculadora científica', '240 funciones', 289.00, 190.00, 25, 5, 4, 2),
('CMP-002', 'Memoria USB 32 GB', 'USB 3.0', 149.00, 95.00, 35, 5, 4, 2);
