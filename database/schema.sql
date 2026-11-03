SET NAMES utf8mb4;
-- =========================================================
-- CRCASA - Sistema de punto de venta e inventario para papelería
-- Programación Web (AEB-1055) - TecNM Campus Tijuana
--
-- Conceptos (corrección de la revisión):
--   USUARIO   = empleado que usa el sistema (capturista, administrador, soporte)
--   CLIENTE   = a quien le vendemos (no entra al sistema)
--   PROVEEDOR = a quien le compramos mercancía
--   VENTA     = sale mercancía hacia un cliente  -> RESTA existencia
--   COMPRA    = entra mercancía de un proveedor  -> SUMA existencia
--   COTIZACIÓN = propuesta de precio            -> NO afecta existencia
--   FACTURA   = documento fiscal sobre una venta, para el cliente
-- =========================================================
DROP DATABASE IF EXISTS papeleria_crcasa;
CREATE DATABASE papeleria_crcasa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE papeleria_crcasa;

-- ---------- USUARIOS (empleados) ----------
CREATE TABLE usuarios (
  id_usuario     INT AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(100) NOT NULL,
  usuario        VARCHAR(40)  NOT NULL UNIQUE,      -- nombre con el que inicia sesión
  password_hash  VARCHAR(255) NOT NULL,
  rol            ENUM('capturista','administrador','soporte') NOT NULL DEFAULT 'capturista',
  activo         TINYINT(1) NOT NULL DEFAULT 1,
  creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- CONFIGURACIÓN (valores que fija el administrador) ----------
CREATE TABLE configuracion (
  clave        VARCHAR(50) PRIMARY KEY,
  valor        VARCHAR(100) NOT NULL,
  descripcion  VARCHAR(255)
);

-- ---------- CLIENTES (a quienes vendemos) ----------
CREATE TABLE clientes (
  id_cliente           INT AUTO_INCREMENT PRIMARY KEY,
  codigo               VARCHAR(20)  NOT NULL UNIQUE,     -- lo teclea el capturista
  nombre               VARCHAR(120) NOT NULL,            -- nombre o razón social
  telefono             VARCHAR(20),
  email                VARCHAR(120),
  rfc                  VARCHAR(13),                      -- necesario solo si pide factura
  direccion            VARCHAR(255),
  porcentaje_descuento DECIMAL(5,2) NOT NULL DEFAULT 0
                       CHECK (porcentaje_descuento BETWEEN 0 AND 100),
  activo               TINYINT(1) NOT NULL DEFAULT 1,
  creado_en            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- CLASIFICACIONES ----------
CREATE TABLE clasificaciones (
  id_clasificacion INT AUTO_INCREMENT PRIMARY KEY,
  nombre           VARCHAR(60) NOT NULL UNIQUE,
  descripcion      VARCHAR(255)
);

-- ---------- PROVEEDORES (a quienes compramos) ----------
CREATE TABLE proveedores (
  id_proveedor  INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  contacto      VARCHAR(100),
  telefono      VARCHAR(20),
  email         VARCHAR(120),
  rfc           VARCHAR(13),
  direccion     VARCHAR(255),
  activo        TINYINT(1) NOT NULL DEFAULT 1
);

-- ---------- PRODUCTOS ----------
CREATE TABLE productos (
  id_producto      INT AUTO_INCREMENT PRIMARY KEY,
  codigo           VARCHAR(30)  NOT NULL UNIQUE,         -- código de barras o interno
  nombre           VARCHAR(120) NOT NULL,
  descripcion      VARCHAR(255),
  precio_venta     DECIMAL(10,2) NOT NULL CHECK (precio_venta >= 0),
  costo            DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),  -- último costo de compra
  existencia       INT NOT NULL DEFAULT 0 CHECK (existencia >= 0),
  existencia_minima INT NOT NULL DEFAULT 0,             -- para alerta de reabastecimiento
  id_clasificacion INT NOT NULL,
  id_proveedor     INT,
  activo           TINYINT(1) NOT NULL DEFAULT 1,
  creado_en        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_clasif FOREIGN KEY (id_clasificacion)
    REFERENCES clasificaciones(id_clasificacion) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_prod_prov FOREIGN KEY (id_proveedor)
    REFERENCES proveedores(id_proveedor) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------- COTIZACIONES (no afectan existencia) ----------
CREATE TABLE cotizaciones (
  id_cotizacion        INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente           INT NOT NULL,
  id_usuario           INT NOT NULL,               -- empleado que la capturó
  fecha                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  vigencia             DATE NOT NULL,
  subtotal             DECIMAL(10,2) NOT NULL,
  porcentaje_descuento DECIMAL(5,2)  NOT NULL DEFAULT 0,
  descuento            DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                DECIMAL(10,2) NOT NULL,
  estado               ENUM('vigente','convertida','vencida','cancelada') NOT NULL DEFAULT 'vigente',
  notas                VARCHAR(255),
  CONSTRAINT fk_cot_cliente FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente),
  CONSTRAINT fk_cot_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
);

CREATE TABLE detalle_cotizacion (
  id_detalle       INT AUTO_INCREMENT PRIMARY KEY,
  id_cotizacion    INT NOT NULL,
  id_producto      INT NOT NULL,
  cantidad         INT NOT NULL CHECK (cantidad > 0),
  precio_unitario  DECIMAL(10,2) NOT NULL,
  importe          DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dc_cot FOREIGN KEY (id_cotizacion)
    REFERENCES cotizaciones(id_cotizacion) ON DELETE CASCADE,
  CONSTRAINT fk_dc_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ---------- VENTAS (restan existencia) ----------
CREATE TABLE ventas (
  id_venta             INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente           INT NOT NULL,
  id_usuario           INT NOT NULL,               -- empleado que registró la venta
  id_cotizacion        INT NULL UNIQUE,            -- si viene de una cotización
  fecha                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal             DECIMAL(10,2) NOT NULL,
  porcentaje_descuento DECIMAL(5,2)  NOT NULL DEFAULT 0,
  descuento            DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                DECIMAL(10,2) NOT NULL,
  metodo_pago          ENUM('efectivo','tarjeta','transferencia') NOT NULL DEFAULT 'efectivo',
  tipo_entrega         ENUM('mostrador','recoger') NOT NULL DEFAULT 'mostrador',
  estado               ENUM('pagada','pendiente_entrega','entregada','cancelada') NOT NULL DEFAULT 'pagada',
  CONSTRAINT fk_venta_cliente FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente),
  CONSTRAINT fk_venta_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
  CONSTRAINT fk_venta_cot FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones(id_cotizacion)
);

CREATE TABLE detalle_venta (
  id_detalle       INT AUTO_INCREMENT PRIMARY KEY,
  id_venta         INT NOT NULL,
  id_producto      INT NOT NULL,
  cantidad         INT NOT NULL CHECK (cantidad > 0),
  precio_unitario  DECIMAL(10,2) NOT NULL,
  importe          DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dv_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
  CONSTRAINT fk_dv_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ---------- COMPRAS A PROVEEDORES (suman existencia) ----------
CREATE TABLE compras (
  id_compra        INT AUTO_INCREMENT PRIMARY KEY,
  id_proveedor     INT NOT NULL,
  id_usuario       INT NOT NULL,
  folio_proveedor  VARCHAR(40),                    -- folio de la factura/nota del proveedor
  fecha            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total            DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_compra_prov FOREIGN KEY (id_proveedor) REFERENCES proveedores(id_proveedor),
  CONSTRAINT fk_compra_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
);

CREATE TABLE detalle_compra (
  id_detalle     INT AUTO_INCREMENT PRIMARY KEY,
  id_compra      INT NOT NULL,
  id_producto    INT NOT NULL,
  cantidad       INT NOT NULL CHECK (cantidad > 0),
  costo_unitario DECIMAL(10,2) NOT NULL,
  importe        DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dco_compra FOREIGN KEY (id_compra) REFERENCES compras(id_compra) ON DELETE CASCADE,
  CONSTRAINT fk_dco_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ---------- FACTURAS (al cliente, sobre una venta) ----------
CREATE TABLE facturas (
  id_factura    INT AUTO_INCREMENT PRIMARY KEY,
  id_venta      INT NOT NULL UNIQUE,               -- una venta se factura una sola vez
  rfc           VARCHAR(13)  NOT NULL,
  razon_social  VARCHAR(150) NOT NULL,
  uso_cfdi      VARCHAR(5)   NOT NULL DEFAULT 'G03',
  fecha         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  id_usuario    INT NOT NULL,
  CONSTRAINT fk_fac_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
  CONSTRAINT fk_fac_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
);

CREATE INDEX idx_prod_nombre ON productos(nombre);
CREATE INDEX idx_cli_nombre  ON clientes(nombre);
CREATE INDEX idx_venta_fecha ON ventas(fecha);
CREATE INDEX idx_cot_fecha   ON cotizaciones(fecha);
CREATE INDEX idx_compra_fecha ON compras(fecha);
