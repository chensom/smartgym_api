-- Vuelta atrás del panel de datos de cobro. La API vuelve a usar solo el .env.
BEGIN;
DROP TABLE IF EXISTS config_cobro;
COMMIT;
