-- ═══════════════════════════════════════════════════════════════════
-- 1) AUDITORÍA AUTOMÁTICA de roles/permisos — de ahora en más, CUALQUIER
--    cambio a estas tablas (desde la app O desde SQL directo) queda
--    registrado solo, sin depender de que el código de la app lo llame.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_auditar_cambio()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_id UUID;
BEGIN
  BEGIN
    v_empresa_id := COALESCE(NEW.empresa_id, OLD.empresa_id);
  EXCEPTION WHEN OTHERS THEN
    -- Algunas tablas (rol_permisos, usuario_roles) no tienen empresa_id
    -- directo; lo sacamos a través del rol relacionado.
    IF TG_TABLE_NAME = 'rol_permisos' THEN
      SELECT r.empresa_id INTO v_empresa_id FROM roles r WHERE r.id = COALESCE(NEW.rol_id, OLD.rol_id);
    ELSIF TG_TABLE_NAME = 'usuario_roles' THEN
      SELECT u.empresa_id INTO v_empresa_id FROM usuarios u WHERE u.id = COALESCE(NEW.usuario_id, OLD.usuario_id);
    END IF;
  END;

  INSERT INTO auditoria (empresa_id, tabla, operacion, registro_id, datos_antes, datos_despues)
  VALUES (
    COALESCE(v_empresa_id, '00000000-0000-0000-0000-000000000000'),
    TG_TABLE_NAME,
    TG_OP,
    COALESCE((to_jsonb(NEW)->>'id'), (to_jsonb(OLD)->>'id'), 'sin-id'),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditar_roles ON roles;
CREATE TRIGGER trg_auditar_roles
AFTER INSERT OR UPDATE OR DELETE ON roles
FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio();

DROP TRIGGER IF EXISTS trg_auditar_rol_permisos ON rol_permisos;
CREATE TRIGGER trg_auditar_rol_permisos
AFTER INSERT OR UPDATE OR DELETE ON rol_permisos
FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio();

DROP TRIGGER IF EXISTS trg_auditar_usuario_roles ON usuario_roles;
CREATE TRIGGER trg_auditar_usuario_roles
AFTER INSERT OR UPDATE OR DELETE ON usuario_roles
FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio();

-- ═══════════════════════════════════════════════════════════════════
-- 2) BLOQUEO DE SEGURIDAD — impide borrar un rol si eso dejara a la
--    empresa SIN NINGÚN rol con permiso de administrador. Esto es lo que
--    habría evitado el incidente de hoy, sin importar si pasó por la app
--    o por un DELETE manual.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_proteger_admin_empresa()
RETURNS TRIGGER AS $$
DECLARE
  quedan_admins INT;
BEGIN
  SELECT COUNT(*) INTO quedan_admins
  FROM roles r
  JOIN rol_permisos rp ON rp.rol_id = r.id
  JOIN permisos p ON p.id = rp.permiso_id
  WHERE r.empresa_id = OLD.empresa_id
    AND r.id != OLD.id
    AND r.activo = true
    AND p.codigo = 'configuracion.editar';

  IF quedan_admins = 0 THEN
    RAISE EXCEPTION 'No se puede eliminar este rol: dejaría a la empresa sin ningún rol con permiso de administrador (configuracion.editar)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_admin_empresa ON roles;
CREATE TRIGGER trg_proteger_admin_empresa
BEFORE DELETE ON roles
FOR EACH ROW EXECUTE FUNCTION fn_proteger_admin_empresa();
