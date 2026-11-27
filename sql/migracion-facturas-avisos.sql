-- Factura de los pagos de suscripción (C de monotributo, A/B de responsable inscripto)
-- y registro de avisos de vencimiento por mail. Requiere migracion-planes-comerciales.sql.
-- Aplicar con (app_user = usuario de base de la API: staging smartgym_user, producción smartgym_prod_user):
--   sudo -u postgres psql -d <base> -v ON_ERROR_STOP=1 -v app_user=<usuario> -f migracion-facturas-avisos.sql
-- Después: prisma generate, build, restart.
-- Vuelta atrás: rollback-facturas-avisos.sql
BEGIN;

-- 1) Datos fiscales y de contacto del gimnasio para facturarle
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS condicion_iva varchar(25)
  CHECK (condicion_iva IS NULL OR condicion_iva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL'));
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_cobro varchar(150);

-- 2) Factura de cada pago. Origen MANUAL = hecha en ARCA a mano y cargada acá; ARCA = emitida por web service.
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_tipo        char(1) CHECK (factura_tipo IS NULL OR factura_tipo IN ('A', 'B', 'C'));
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_punto_venta integer CHECK (factura_punto_venta IS NULL OR factura_punto_venta BETWEEN 1 AND 99999);
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_numero      integer CHECK (factura_numero IS NULL OR factura_numero BETWEEN 1 AND 99999999);
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_fecha       date;
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_cae         varchar(14);
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_cae_vto     date;
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_origen      varchar(6) CHECK (factura_origen IS NULL OR factura_origen IN ('MANUAL', 'ARCA'));
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_pdf         bytea;
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS factura_pdf_nombre  varchar(120);
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS enviado_at          timestamptz;
ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS enviado_a           text;
-- Un mismo comprobante (tipo + punto de venta + número) no se puede cargar en dos pagos
CREATE UNIQUE INDEX IF NOT EXISTS pagos_suscripcion_factura_key
  ON pagos_suscripcion(factura_tipo, factura_punto_venta, factura_numero)
  WHERE factura_numero IS NOT NULL;

-- 3) Avisos de vencimiento mandados (uno por gimnasio, tipo y "pagado hasta": no se repiten)
CREATE TABLE IF NOT EXISTS avisos_cobro (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid        NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  tipo          varchar(12) NOT NULL CHECK (tipo IN ('POR_VENCER', 'VENCE_HOY', 'VENCIDO')),
  pagado_hasta  date        NOT NULL,
  estado        varchar(20) NOT NULL CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'ERROR', 'SIN_DESTINATARIOS')),
  intentos      smallint    NOT NULL DEFAULT 1,
  destinatarios text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avisos_cobro_empresa_id_tipo_pagado_hasta_key UNIQUE (empresa_id, tipo, pagado_hasta)
);

-- La tabla nueva queda a nombre del usuario de la API (si no, la API no la puede usar)
ALTER TABLE avisos_cobro OWNER TO :"app_user";

-- Verificación
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'empresas' AND column_name IN ('condicion_iva', 'email_cobro')) AS columnas_empresas,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pagos_suscripcion' AND (column_name LIKE 'factura_%' OR column_name LIKE 'enviado_%')) AS columnas_factura,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'avisos_cobro') AS columnas_avisos,
       (SELECT tableowner FROM pg_tables WHERE tablename = 'avisos_cobro') AS duenio_avisos;

COMMIT;
