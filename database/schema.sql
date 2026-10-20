SET NAMES utf8mb4;
-- =========================================================
-- Papelería en línea CRCASA - Esquema de base de datos
-- Programación Web (AEB-1055) - TecNM Campus Tijuana
-- =========================================================
DROP DATABASE IF EXISTS papeleria_crcasa;
CREATE DATABASE papeleria_crcasa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE papeleria_crcasa;

-- ---------- USUARIOS ----------
CREATE TABLE usuarios (
  id_usuario     INT AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(100) NOT NULL,
  email          VARCHAR(120) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  telefono       VARCHAR(20),
  empresa        VARCHAR(120),                -- solo aplica a mayoristas
  rol            ENUM('cliente','mayorista','vendedor','admin') NOT NULL DEFAULT 'cliente',
  activo         TINYINT(1) NOT NULL DEFAULT 1,
  creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- CLASIFICACIONES ----------
CREATE TABLE clasificaciones (
  id_clasificacion INT AUTO_INCREMENT PRIMARY KEY,
  nombre           VARCHAR(60) NOT NULL UNIQUE,
  descripcion      VARCHAR(255)
);

-- ---------- PROVEEDORES ----------
CREATE TABLE proveedores (
  id_proveedor  INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  contacto      VARCHAR(100),
  telefono      VARCHAR(20),
  email         VARCHAR(120),
  direccion     VARCHAR(255)
);

-- ---------- PRODUCTOS ----------
CREATE TABLE productos (
  id_producto      INT AUTO_INCREMENT PRIMARY KEY,
  nombre           VARCHAR(120) NOT NULL,
  descripcion      TEXT,
  precio           DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  stock            INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  imagen_url       VARCHAR(255),
  id_clasificacion INT NOT NULL,
  id_proveedor     INT,
  activo           TINYINT(1) NOT NULL DEFAULT 1,
  creado_en        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_clasif FOREIGN KEY (id_clasificacion)
    REFERENCES clasificaciones(id_clasificacion) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_prod_prov FOREIGN KEY (id_proveedor)
    REFERENCES proveedores(id_proveedor) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------- VENTAS ----------
CREATE TABLE ventas (
  id_venta     INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario   INT NOT NULL,
  fecha        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total        DECIMAL(10,2) NOT NULL,
  metodo_pago  ENUM('tienda','transferencia','simulado') NOT NULL DEFAULT 'simulado',
  estado       ENUM('pendiente','pagada','cancelada') NOT NULL DEFAULT 'pendiente',
  CONSTRAINT fk_venta_usuario FOREIGN KEY (id_usuario)
    REFERENCES usuarios(id_usuario) ON DELETE RESTRICT
);

CREATE TABLE detalle_venta (
  id_detalle       INT AUTO_INCREMENT PRIMARY KEY,
  id_venta         INT NOT NULL,
  id_producto      INT NOT NULL,
  cantidad         INT NOT NULL CHECK (cantidad > 0),
  precio_unitario  DECIMAL(10,2) NOT NULL,
  subtotal         DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dv_venta FOREIGN KEY (id_venta)
    REFERENCES ventas(id_venta) ON DELETE CASCADE,
  CONSTRAINT fk_dv_producto FOREIGN KEY (id_producto)
    REFERENCES productos(id_producto) ON DELETE RESTRICT
);

-- ---------- COTIZACIONES (mayoristas) ----------
CREATE TABLE cotizaciones (
  id_cotizacion  INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario     INT NOT NULL,                 -- cliente mayorista que la solicita
  id_vendedor    INT,                          -- vendedor que la atiende
  fecha          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal       DECIMAL(10,2) NOT NULL,
  descuento      DECIMAL(10,2) NOT NULL DEFAULT 0,
  total          DECIMAL(10,2) NOT NULL,
  estado         ENUM('solicitada','revisada','aceptada','rechazada') NOT NULL DEFAULT 'solicitada',
  vigencia       DATE,
  CONSTRAINT fk_cot_usuario FOREIGN KEY (id_usuario)
    REFERENCES usuarios(id_usuario) ON DELETE RESTRICT,
  CONSTRAINT fk_cot_vendedor FOREIGN KEY (id_vendedor)
    REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);

CREATE TABLE detalle_cotizacion (
  id_detalle           INT AUTO_INCREMENT PRIMARY KEY,
  id_cotizacion        INT NOT NULL,
  id_producto          INT NOT NULL,
  cantidad             INT NOT NULL CHECK (cantidad > 0),
  precio_unitario      DECIMAL(10,2) NOT NULL,
  porcentaje_descuento DECIMAL(5,2) NOT NULL DEFAULT 0,
  subtotal             DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dc_cot FOREIGN KEY (id_cotizacion)
    REFERENCES cotizaciones(id_cotizacion) ON DELETE CASCADE,
  CONSTRAINT fk_dc_producto FOREIGN KEY (id_producto)
    REFERENCES productos(id_producto) ON DELETE RESTRICT
);

-- Índices útiles para catálogo y reportes
CREATE INDEX idx_prod_clasif ON productos(id_clasificacion);
CREATE INDEX idx_venta_fecha ON ventas(fecha);
CREATE INDEX idx_cot_fecha   ON cotizaciones(fecha);
