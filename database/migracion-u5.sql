-- Migración del Avance 5 (no borra datos). Agrega el timbrado de prueba de CFDI.
-- Se corre una sola vez sobre una base que ya existe:  npm run migrar
USE papeleria_crcasa;

ALTER TABLE solicitudes_factura
  ADD COLUMN regimen_fiscal VARCHAR(3) NOT NULL DEFAULT '601',
  ADD COLUMN codigo_postal VARCHAR(5) NOT NULL DEFAULT '',
  ADD COLUMN estado_cfdi ENUM('pendiente','timbrada','error') NOT NULL DEFAULT 'pendiente',
  ADD COLUMN uuid VARCHAR(36),
  ADD COLUMN id_cfdi_pac VARCHAR(60),
  ADD COLUMN fecha_timbrado TIMESTAMP NULL,
  ADD COLUMN mensaje_pac VARCHAR(500);

INSERT IGNORE INTO clientes (id_papeleria, codigo, nombre, email, rfc, porcentaje_descuento)
SELECT id_papeleria, 'C-PRUEBA', 'UNIVERSIDAD ROBOTICA ESPAÑOLA', 'facturas@ure.test', 'URE180429TM6', 0 FROM papelerias;
