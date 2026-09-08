BEGIN;

-- 1) Tabla de gastos
CREATE TABLE IF NOT EXISTS gastos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL REFERENCES empresas(id),
  sucursal_id      UUID REFERENCES sucursales(id),
  tipo             VARCHAR(20) NOT NULL,
  categoria        VARCHAR(60) NOT NULL,
  descripcion      TEXT,
  monto            DECIMAL(12,2) NOT NULL,
  fecha            DATE NOT NULL,
  medio_pago_id    UUID REFERENCES medios_pago(id),
  comprobante_url  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gastos_tipo_check CHECK (tipo IN ('FIJO', 'VARIABLE'))
);

CREATE INDEX IF NOT EXISTS idx_gastos_empresa_fecha ON gastos(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_empresa_tipo ON gastos(empresa_id, tipo);

GRANT SELECT, INSERT, UPDATE, DELETE ON gastos TO smartgym_user;

-- 2) Permisos nuevos del módulo Gastos
INSERT INTO permisos (codigo, modulo) VALUES
  ('gastos.ver', 'gastos'),
  ('gastos.editar', 'gastos')
ON CONFLICT (codigo) DO NOTHING;

-- 3) Backfill: dar estos permisos nuevos a TODOS los roles existentes
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE p.codigo IN ('gastos.ver', 'gastos.editar')
ON CONFLICT DO NOTHING;

COMMIT;
