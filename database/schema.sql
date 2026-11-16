SET NAMES utf8mb4;
-- =========================================================
-- CRCASA - Sistema de punto de venta e inventario para papelería
-- Programación Web (AEB-1055) - TecNM Campus Tijuana
--
-- Conceptos (corrección de la revisión):
--   PAPELERÍA = cada negocio que usa el sistema; sus datos están separados de las demás
--   USUARIO   = empleado que usa el sistema (capturista, administrador, soporte)
--   CLIENTE   = a quien le vendemos (no entra al sistema)
--   PROVEEDOR = a quien le compramos mercancía
--   VENTA     = sale mercancía hacia un cliente  -> RESTA existencia
--   COMPRA    = entra mercancía de un proveedor  -> SUMA existencia
--   COTIZACIÓN = propuesta de precio            -> NO afecta existencia
--   NOTA DE VENTA = comprobante que entrega el sistema (no es factura)
--   SOLICITUD DE FACTURA = datos fiscales del cliente para emitir el CFDI
--     timbrado fuera del sistema (portal del SAT o un PAC)
-- Compatible con MariaDB/MySQL y con TiDB Cloud. El comentario /*T! ... */ solo lo lee TiDB:
-- hace que los folios (ventas, cotizaciones...) sean consecutivos también allá.
-- =========================================================
DROP DATABASE IF EXISTS papeleria_crcasa;
CREATE DATABASE papeleria_crcasa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE papeleria_crcasa;

-- ---------- PAPELERÍAS (cada negocio que usa el sistema) ----------
CREATE TABLE papelerias (
  id_papeleria  INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL UNIQUE,      -- aparece en la nota de venta
  giro          VARCHAR(150),
  direccion     VARCHAR(255),
  telefono      VARCHAR(20),
  rfc           VARCHAR(13),
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  creado_en     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- USUARIOS (empleados) ----------
CREATE TABLE usuarios (
  id_usuario     INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria   INT NULL,                          -- NULL solo para soporte técnico (atiende a todas)
  nombre         VARCHAR(100) NOT NULL,
  usuario        VARCHAR(40)  NOT NULL UNIQUE,      -- nombre con el que inicia sesión
  password_hash  VARCHAR(255) NOT NULL,
  rol            ENUM('capturista','administrador','soporte') NOT NULL DEFAULT 'capturista',
  activo         TINYINT(1) NOT NULL DEFAULT 1,
  creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- CONFIGURACIÓN (valores que fija el administrador de cada papelería) ----------
CREATE TABLE configuracion (
  id_papeleria INT NOT NULL,
  clave        VARCHAR(50) NOT NULL,
  valor        VARCHAR(100) NOT NULL,
  descripcion  VARCHAR(255),
  PRIMARY KEY (id_papeleria, clave),
  CONSTRAINT fk_config_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- CLIENTES (a quienes vendemos) ----------
CREATE TABLE clientes (
  id_cliente           INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria         INT NOT NULL,
  codigo               VARCHAR(20)  NOT NULL,            -- lo teclea el capturista (único por papelería)
  nombre               VARCHAR(120) NOT NULL,            -- nombre o razón social
  telefono             VARCHAR(20),
  email                VARCHAR(120),
  rfc                  VARCHAR(13),                      -- necesario solo si pide factura
  direccion            VARCHAR(255),
  porcentaje_descuento DECIMAL(5,2) NOT NULL DEFAULT 0
                       CHECK (porcentaje_descuento BETWEEN 0 AND 100),
  activo               TINYINT(1) NOT NULL DEFAULT 1,
  creado_en            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cliente_codigo (id_papeleria, codigo),
  CONSTRAINT fk_cliente_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- CLASIFICACIONES ----------
CREATE TABLE clasificaciones (
  id_clasificacion INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria     INT NOT NULL,
  nombre           VARCHAR(60) NOT NULL,
  descripcion      VARCHAR(255),
  UNIQUE KEY uq_clasif_nombre (id_papeleria, nombre),
  CONSTRAINT fk_clasif_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- PROVEEDORES (a quienes compramos) ----------
CREATE TABLE proveedores (
  id_proveedor  INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria  INT NOT NULL,
  nombre        VARCHAR(120) NOT NULL,
  contacto      VARCHAR(100),
  telefono      VARCHAR(20),
  email         VARCHAR(120),
  rfc           VARCHAR(13),
  direccion     VARCHAR(255),
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_prov_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- PRODUCTOS ----------
CREATE TABLE productos (
  id_producto      INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria     INT NOT NULL,
  codigo           VARCHAR(30)  NOT NULL,                -- código de barras o interno (único por papelería)
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
  UNIQUE KEY uq_prod_codigo (id_papeleria, codigo),
  CONSTRAINT fk_prod_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_prod_clasif FOREIGN KEY (id_clasificacion)
    REFERENCES clasificaciones(id_clasificacion) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_prod_prov FOREIGN KEY (id_proveedor)
    REFERENCES proveedores(id_proveedor) ON UPDATE CASCADE ON DELETE SET NULL
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- COTIZACIONES (no afectan existencia) ----------
CREATE TABLE cotizaciones (
  id_cotizacion        INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria         INT NOT NULL,
  folio                INT NOT NULL,                -- consecutivo propio de cada papelería
  id_cliente           INT NOT NULL,
  id_usuario           INT NOT NULL,               -- empleado que la capturó
  fecha                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  vigencia             DATE NOT NULL,
  subtotal             DECIMAL(10,2) NOT NULL,
  porcentaje_descuento DECIMAL(5,2)  NOT NULL DEFAULT 0,
  descuento            DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                DECIMAL(10,2) NOT NULL,
  estado               ENUM('vigente','convertida','cancelada') NOT NULL DEFAULT 'vigente',
  motivo_cancelacion   VARCHAR(120),               -- la cotización nunca se borra; si vence, se cancela
  notas                VARCHAR(255),
  UNIQUE KEY uq_cot_folio (id_papeleria, folio),
  CONSTRAINT fk_cot_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_cot_cliente FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente),
  CONSTRAINT fk_cot_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

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
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- VENTAS (restan existencia) ----------
CREATE TABLE ventas (
  id_venta             INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria         INT NOT NULL,
  folio                INT NOT NULL,                -- consecutivo propio de cada papelería
  id_cliente           INT NOT NULL,
  id_usuario           INT NOT NULL,               -- empleado que registró la venta
  id_cotizacion        INT NULL UNIQUE,            -- si viene de una cotización
  fecha                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal             DECIMAL(10,2) NOT NULL,
  porcentaje_descuento DECIMAL(5,2)  NOT NULL DEFAULT 0,
  descuento            DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                DECIMAL(10,2) NOT NULL,
  metodo_pago          ENUM('efectivo','tarjeta','transferencia') NOT NULL DEFAULT 'efectivo',
  pago_con             DECIMAL(10,2) NULL,          -- efectivo que entregó el cliente
  cambio               DECIMAL(10,2) NULL,
  tipo_entrega         ENUM('mostrador','recoger') NOT NULL DEFAULT 'mostrador',
  estado               ENUM('pagada','pendiente_entrega','entregada','cancelada') NOT NULL DEFAULT 'pagada',
  UNIQUE KEY uq_venta_folio (id_papeleria, folio),
  CONSTRAINT fk_venta_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_venta_cliente FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente),
  CONSTRAINT fk_venta_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
  CONSTRAINT fk_venta_cot FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones(id_cotizacion)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

CREATE TABLE detalle_venta (
  id_detalle       INT AUTO_INCREMENT PRIMARY KEY,
  id_venta         INT NOT NULL,
  id_producto      INT NOT NULL,
  cantidad         INT NOT NULL CHECK (cantidad > 0),
  precio_unitario  DECIMAL(10,2) NOT NULL,
  importe          DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dv_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
  CONSTRAINT fk_dv_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- COMPRAS A PROVEEDORES (suman existencia) ----------
CREATE TABLE compras (
  id_compra        INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria     INT NOT NULL,
  folio            INT NOT NULL,                    -- consecutivo propio de cada papelería
  id_proveedor     INT NOT NULL,
  id_usuario       INT NOT NULL,
  folio_proveedor  VARCHAR(40),                    -- folio de la factura/nota del proveedor
  fecha            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total            DECIMAL(10,2) NOT NULL,
  UNIQUE KEY uq_compra_folio (id_papeleria, folio),
  CONSTRAINT fk_compra_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_compra_prov FOREIGN KEY (id_proveedor) REFERENCES proveedores(id_proveedor),
  CONSTRAINT fk_compra_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

CREATE TABLE detalle_compra (
  id_detalle     INT AUTO_INCREMENT PRIMARY KEY,
  id_compra      INT NOT NULL,
  id_producto    INT NOT NULL,
  cantidad       INT NOT NULL CHECK (cantidad > 0),
  costo_unitario DECIMAL(10,2) NOT NULL,
  importe        DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dco_compra FOREIGN KEY (id_compra) REFERENCES compras(id_compra) ON DELETE CASCADE,
  CONSTRAINT fk_dco_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- SOLICITUDES DE FACTURA (datos fiscales del cliente sobre una venta) ----------
-- El sistema NO timbra: sin timbrado no hay factura (CFDI). Aquí solo se guardan los
-- datos para que la papelería emita el CFDI en el portal del SAT o con su PAC.
CREATE TABLE solicitudes_factura (
  id_solicitud  INT AUTO_INCREMENT PRIMARY KEY,
  id_venta      INT NOT NULL UNIQUE,               -- una venta tiene a lo más una solicitud
  rfc           VARCHAR(13)  NOT NULL,
  razon_social  VARCHAR(150) NOT NULL,
  uso_cfdi      VARCHAR(5)   NOT NULL DEFAULT 'G03',
  fecha         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  id_usuario    INT NOT NULL,
  CONSTRAINT fk_sol_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
  CONSTRAINT fk_sol_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- FOLIOS (último número usado por papelería y tipo de documento) ----------
CREATE TABLE folios (
  id_papeleria  INT NOT NULL,
  tipo          VARCHAR(20) NOT NULL,              -- venta | cotizacion | compra | corte
  ultimo        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id_papeleria, tipo),
  CONSTRAINT fk_folio_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria)
);

-- ---------- KÁRDEX: cada entrada o salida de mercancía ----------
CREATE TABLE movimientos_inventario (
  id_movimiento   INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria    INT NOT NULL,
  id_producto     INT NOT NULL,
  tipo            ENUM('inicial','venta','compra','cancelacion') NOT NULL,
  cantidad        INT NOT NULL,                     -- positiva entra, negativa sale
  existencia      INT NOT NULL,                     -- existencia que quedó después del movimiento
  referencia      VARCHAR(40),                      -- ej. "Venta 12", "Compra 4"
  id_usuario      INT NULL,
  fecha           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mov_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_mov_prod FOREIGN KEY (id_producto) REFERENCES productos(id_producto),
  CONSTRAINT fk_mov_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- CORTES DE CAJA (cierre del turno de cada empleado) ----------
CREATE TABLE cortes_caja (
  id_corte              INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria          INT NOT NULL,
  folio                 INT NOT NULL,
  id_usuario            INT NOT NULL,              -- empleado que cierra su turno
  desde                 DATETIME NOT NULL,
  hasta                 DATETIME NOT NULL,
  num_ventas            INT NOT NULL DEFAULT 0,
  ventas_efectivo       DECIMAL(10,2) NOT NULL DEFAULT 0,
  ventas_tarjeta        DECIMAL(10,2) NOT NULL DEFAULT 0,
  ventas_transferencia  DECIMAL(10,2) NOT NULL DEFAULT 0,
  canceladas            INT NOT NULL DEFAULT 0,
  fondo_inicial         DECIMAL(10,2) NOT NULL DEFAULT 0,
  efectivo_esperado     DECIMAL(10,2) NOT NULL,    -- fondo + ventas en efectivo
  efectivo_contado      DECIMAL(10,2) NOT NULL,
  diferencia            DECIMAL(10,2) NOT NULL,    -- contado - esperado (negativo = falta)
  notas                 VARCHAR(255),
  UNIQUE KEY uq_corte_folio (id_papeleria, folio),
  CONSTRAINT fk_corte_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_corte_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- BITÁCORA: quién hizo qué y cuándo ----------
CREATE TABLE bitacora (
  id_bitacora   INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria  INT NULL,
  id_usuario    INT NULL,
  accion        VARCHAR(60) NOT NULL,
  detalle       VARCHAR(255),
  fecha         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bit_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- ---------- INTENTOS DE INICIO DE SESIÓN (para bloquear ataques de fuerza bruta) ----------
CREATE TABLE intentos_login (
  id_intento  INT AUTO_INCREMENT PRIMARY KEY,
  usuario     VARCHAR(40) NOT NULL,
  ip          VARCHAR(45),
  exito       TINYINT(1) NOT NULL,
  fecha       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

CREATE INDEX idx_mov_producto ON movimientos_inventario(id_producto, fecha);
CREATE INDEX idx_bit_fecha ON bitacora(id_papeleria, fecha);
CREATE INDEX idx_intentos ON intentos_login(usuario, fecha);
CREATE INDEX idx_prod_nombre ON productos(id_papeleria, nombre);
CREATE INDEX idx_cli_nombre  ON clientes(id_papeleria, nombre);
CREATE INDEX idx_venta_fecha ON ventas(id_papeleria, fecha);
CREATE INDEX idx_cot_fecha   ON cotizaciones(id_papeleria, fecha);
CREATE INDEX idx_compra_fecha ON compras(id_papeleria, fecha);
