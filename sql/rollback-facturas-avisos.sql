-- Vuelta atrás de facturas y avisos. OJO: borra las facturas cargadas (PDF incluidos) y el registro de avisos.
-- Antes: pg_dump -t pagos_suscripcion -t avisos_cobro <base> > facturas-backup.sql
BEGIN;
DROP TABLE IF EXISTS avisos_cobro;
DROP INDEX IF EXISTS pagos_suscripcion_factura_key;
ALTER TABLE pagos_suscripcion
  DROP COLUMN IF EXISTS factura_tipo, DROP COLUMN IF EXISTS factura_punto_venta, DROP COLUMN IF EXISTS factura_numero,
  DROP COLUMN IF EXISTS factura_fecha, DROP COLUMN IF EXISTS factura_cae, DROP COLUMN IF EXISTS factura_cae_vto,
  DROP COLUMN IF EXISTS factura_origen, DROP COLUMN IF EXISTS factura_pdf, DROP COLUMN IF EXISTS factura_pdf_nombre,
  DROP COLUMN IF EXISTS enviado_at, DROP COLUMN IF EXISTS enviado_a;
ALTER TABLE empresas DROP COLUMN IF EXISTS condicion_iva, DROP COLUMN IF EXISTS email_cobro;
COMMIT;
