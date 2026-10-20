SET NAMES utf8mb4;
-- Datos de prueba (los productos son de ejemplo hasta tener el catálogo real del cliente)
USE papeleria_crcasa;

INSERT INTO clasificaciones (nombre, descripcion) VALUES
('Escolar', 'Cuadernos, lápices, plumas, colores y útiles escolares'),
('Oficina', 'Papel, carpetas, engrapadoras, folders y archivo'),
('Arte', 'Pinturas, pinceles, papel para dibujo y manualidades'),
('Tecnología básica', 'Calculadoras, memorias USB, mouse y accesorios');

INSERT INTO proveedores (nombre, contacto, telefono, email) VALUES
('Distribuidora Escolar del Norte', 'Laura Méndez', '664-000-0001', 'ventas@escolarnorte.test'),
('Papelera Industrial BC', 'Jorge Ruiz', '664-000-0002', 'contacto@papelerabc.test');

INSERT INTO productos (nombre, descripcion, precio, stock, id_clasificacion, id_proveedor) VALUES
('Cuaderno profesional raya 100 hojas', 'Cuaderno cosido, pasta dura', 45.00, 200, 1, 1),
('Lápiz HB No. 2 (caja 12)', 'Caja con 12 lápices de grafito', 38.50, 150, 1, 1),
('Bolígrafo azul punto mediano', 'Pluma de tinta azul', 8.00, 500, 1, 1),
('Colores de madera 24 piezas', 'Caja con 24 colores', 89.90, 80, 1, 1),
('Paquete hojas carta 500', 'Papel bond blanco 75 g', 115.00, 120, 2, 2),
('Folder tamaño carta (25 pzas)', 'Folder manila', 72.00, 90, 2, 2),
('Engrapadora estándar', 'Capacidad 20 hojas', 95.00, 40, 2, 2),
('Set de acuarelas 12 colores', 'Incluye pincel', 64.00, 60, 3, 1),
('Block de dibujo 30 hojas', 'Papel marquilla', 52.00, 70, 3, 1),
('Calculadora científica', '240 funciones', 289.00, 25, 4, 2),
('Memoria USB 32 GB', 'USB 3.0', 149.00, 35, 4, 2);
