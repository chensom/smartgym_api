-- Planes comerciales de SmartGym (lo que Cod&Tics le cobra a cada gimnasio) y registro de pagos.
-- Aplicar con: sudo -u postgres psql -d <base> -v ON_ERROR_STOP=1 -f migracion-planes-comerciales.sql
-- Después: npx prisma generate + npm run build + pm2 restart.
-- Vuelta atrás: rollback-planes-comerciales.sql
BEGIN;

-- 1) Catálogo de planes. max_socios NULL = sin tope. precio_mensual NULL = "a medida" (se usa el precio acordado del gimnasio).
CREATE TABLE IF NOT EXISTS planes_comerciales (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         varchar(40)   NOT NULL,
  max_socios     integer       CHECK (max_socios IS NULL OR max_socios > 0),
  precio_mensual numeric(12,2) CHECK (precio_mensual IS NULL OR precio_mensual >= 0),
  orden          smallint      NOT NULL DEFAULT 0,
  activo         boolean       NOT NULL DEFAULT true,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT planes_comerciales_nombre_key UNIQUE (nombre)
);

INSERT INTO planes_comerciales (nombre, max_socios, precio_mensual, orden) VALUES
  ('Inicial',   50,   29000, 1),
  ('Medio',     150,  49000, 2),
  ('Avanzado',  300,  79000, 3),
  ('A medida',  NULL, NULL,  4)
ON CONFLICT (nombre) DO NOTHING;

-- 2) Plan y estado de cobro de cada gimnasio
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plan_comercial_id uuid
  REFERENCES planes_comerciales(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS precio_acordado numeric(12,2)
  CHECK (precio_acordado IS NULL OR precio_acordado >= 0);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS prueba_hasta date;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS pagado_hasta date;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS notas_cobro text;
CREATE INDEX IF NOT EXISTS empresas_plan_comercial_id_idx ON empresas(plan_comercial_id);

-- 3) Pagos que hace cada gimnasio a Cod&Tics. No se borran: se anulan.
CREATE TABLE IF NOT EXISTS pagos_suscripcion (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid          NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  plan_comercial_id uuid          REFERENCES planes_comerciales(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  plan_nombre       varchar(40),
  fecha_pago        date          NOT NULL,
  monto             numeric(12,2) NOT NULL CHECK (monto > 0),
  meses             smallint      NOT NULL CHECK (meses BETWEEN 1 AND 24),
  periodo_desde     date          NOT NULL,
  periodo_hasta     date          NOT NULL,
  medio             varchar(20)   NOT NULL CHECK (medio IN ('TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO', 'OTRO')),
  referencia        varchar(100),
  notas             text,
  anulado_at        timestamptz,
  anulado_motivo    text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pagos_suscripcion_periodo_check CHECK (periodo_hasta >= periodo_desde)
);
CREATE INDEX IF NOT EXISTS pagos_suscripcion_empresa_id_periodo_hasta_idx ON pagos_suscripcion(empresa_id, periodo_hasta DESC);

-- Verificación
SELECT (SELECT count(*) FROM planes_comerciales) AS planes,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'empresas' AND column_name IN
               ('plan_comercial_id', 'precio_acordado', 'prueba_hasta', 'pagado_hasta', 'notas_cobro')) AS columnas_empresas,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'pagos_suscripcion') AS columnas_pagos;

COMMIT;
