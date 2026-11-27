-- Migración: apertura de caja (no borra datos). Se corre una sola vez sobre una base que ya existe:  npm run migrar
-- Cada empleado ABRE su caja contando el fondo con el que empieza; sin caja abierta no puede registrar ventas.
-- Durante el turno se anotan entradas y salidas de efectivo (cambio que trajeron, pago a un proveedor, retiro...)
-- y al cerrar, el corte toma el fondo de la apertura y lo compara con lo que se contó.
USE papeleria_crcasa;

CREATE TABLE turnos_caja (
  id_turno          INT AUTO_INCREMENT PRIMARY KEY,
  id_papeleria      INT NOT NULL,
  id_usuario        INT NOT NULL,                 -- empleado dueño de la caja
  abierto_en        DATETIME NOT NULL,
  fondo_inicial     DECIMAL(10,2) NOT NULL CHECK (fondo_inicial >= 0),  -- efectivo contado al abrir
  desglose_apertura VARCHAR(500),                 -- billetes y monedas contados (JSON)
  estado            ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto',
  cerrado_en        DATETIME NULL,
  CONSTRAINT fk_turno_pap FOREIGN KEY (id_papeleria) REFERENCES papelerias(id_papeleria),
  CONSTRAINT fk_turno_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;
CREATE INDEX idx_turno_usuario ON turnos_caja(id_papeleria, id_usuario, estado);

CREATE TABLE movimientos_caja (
  id_movimiento  INT AUTO_INCREMENT PRIMARY KEY,
  id_turno       INT NOT NULL,
  id_papeleria   INT NOT NULL,
  id_usuario     INT NOT NULL,
  tipo           ENUM('entrada','salida') NOT NULL,
  monto          DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  motivo         VARCHAR(150) NOT NULL,
  fecha          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movcaja_turno FOREIGN KEY (id_turno) REFERENCES turnos_caja(id_turno),
  CONSTRAINT fk_movcaja_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) /*T![auto_id_cache] AUTO_ID_CACHE=1 */;

-- Cada venta queda ligada a la caja (turno) en la que se cobró
ALTER TABLE ventas ADD COLUMN id_turno INT NULL;
CREATE INDEX idx_venta_turno ON ventas(id_turno);

-- El corte cierra un turno y guarda las entradas/salidas y el desglose del conteo
ALTER TABLE cortes_caja
  ADD COLUMN id_turno INT NULL,
  ADD COLUMN entradas DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN salidas DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN desglose VARCHAR(500);
CREATE UNIQUE INDEX uq_corte_turno ON cortes_caja(id_turno);

-- Fondo que se sugiere al abrir la caja (cada administrador lo cambia en su panel)
INSERT IGNORE INTO configuracion (id_papeleria, clave, valor, descripcion)
SELECT id_papeleria, 'fondo_caja_sugerido', '500', 'Fondo de caja con el que normalmente se abre' FROM papelerias;
