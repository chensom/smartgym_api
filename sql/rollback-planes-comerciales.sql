-- Vuelta atrás de planes comerciales. OJO: borra el historial de pagos registrado.
-- Antes de correrlo, sacar copia: pg_dump -t pagos_suscripcion -t planes_comerciales <base> > planes-backup.sql
BEGIN;
DROP TABLE IF EXISTS pagos_suscripcion;
ALTER TABLE empresas DROP COLUMN IF EXISTS plan_comercial_id;
ALTER TABLE empresas DROP COLUMN IF EXISTS precio_acordado;
ALTER TABLE empresas DROP COLUMN IF EXISTS prueba_hasta;
ALTER TABLE empresas DROP COLUMN IF EXISTS pagado_hasta;
ALTER TABLE empresas DROP COLUMN IF EXISTS notas_cobro;
DROP TABLE IF EXISTS planes_comerciales;
COMMIT;
