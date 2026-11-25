-- Resumen mensual al dueño: registro de envíos (una fila por gimnasio y mes).
-- Aplicar con: sudo -u postgres psql -d <base> -v ON_ERROR_STOP=1 -f migracion-resumenes-enviados.sql
-- Después: npx prisma generate + npm run build + pm2 restart.
BEGIN;

CREATE TABLE IF NOT EXISTS resumenes_enviados (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid        NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  periodo       date        NOT NULL CHECK (extract(day FROM periodo) = 1),
  estado        varchar(20) NOT NULL CHECK (estado IN ('ENVIANDO', 'ENVIADO', 'ERROR', 'SIN_DESTINATARIOS')),
  intentos      smallint    NOT NULL DEFAULT 1,
  destinatarios text,
  error         text,
  enviado_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resumenes_enviados_empresa_id_periodo_key UNIQUE (empresa_id, periodo)
);

-- Verificación
SELECT count(*) AS columnas FROM information_schema.columns WHERE table_name = 'resumenes_enviados';

COMMIT;
