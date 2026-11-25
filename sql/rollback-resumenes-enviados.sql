-- Vuelta atrás del resumen mensual (borra el registro de envíos).
BEGIN;
DROP TABLE IF EXISTS resumenes_enviados;
COMMIT;
