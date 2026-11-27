-- Datos de cobro de Cod&Tics editables desde el panel SuperAdmin (una sola fila, id = 1).
-- Si un campo queda vacío, la API usa el valor del .env (EMISOR_CONDICION_IVA, EMISOR_PUNTO_VENTA,
-- COBROS_COPIA_A, COBROS_DATOS_PAGO). El interruptor AVISOS_COBRO_ACTIVO sigue solo en el .env.
-- Requiere migracion-facturas-avisos.sql.
-- Aplicar con (app_user = usuario de base de la API: staging smartgym_user, producción smartgym_prod_user):
--   sudo -u postgres psql -d <base> -v ON_ERROR_STOP=1 -v app_user=<usuario> -f migracion-config-cobro.sql
-- Después: prisma generate, build, restart. Vuelta atrás: rollback-config-cobro.sql
BEGIN;

CREATE TABLE IF NOT EXISTS config_cobro (
  id                    smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  emisor_condicion_iva  varchar(25)  CHECK (emisor_condicion_iva IS NULL OR emisor_condicion_iva IN ('MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO')),
  emisor_punto_venta    integer      CHECK (emisor_punto_venta IS NULL OR emisor_punto_venta BETWEEN 1 AND 99999),
  copia_a               varchar(150),
  datos_pago            varchar(500),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE config_cobro OWNER TO :"app_user";

-- Verificación
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'config_cobro') AS columnas_config,
       (SELECT tableowner FROM pg_tables WHERE tablename = 'config_cobro') AS duenio_config;

COMMIT;
