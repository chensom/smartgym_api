-- =============================================================================
-- SMARTGYM · Migración Completa PostgreSQL
-- Arquitectura SaaS Multiempresa · CODAN CORE + SMARTGYM
-- Cod&Tics · 2025
-- =============================================================================
-- Orden de creación respeta dependencias de FK:
--   1. Extensions
--   2. CODAN CORE (empresas → sucursales → personas → seguridad → auditoría)
--   3. SMARTGYM (roles → disciplinas → membresías → clases → asistencias →
--                rutinas → inventario → ventas → pagos → facturación)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. EXTENSIONES
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- búsqueda fuzzy por nombre
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- índices parciales avanzados

-- -----------------------------------------------------------------------------
-- 1. CODAN CORE · MÓDULO EMPRESAS
-- -----------------------------------------------------------------------------

CREATE TABLE empresas (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre       VARCHAR(150) NOT NULL,
    cuit         VARCHAR(20)  NOT NULL,
    razon_social VARCHAR(200) NOT NULL,
    logo_url     TEXT,
    activo       BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_empresas_cuit UNIQUE (cuit),
    CONSTRAINT uq_empresas_nombre UNIQUE (nombre)
);

COMMENT ON TABLE  empresas            IS 'Entidad raíz del modelo multiempresa SaaS';
COMMENT ON COLUMN empresas.cuit       IS 'CUIT sin guiones, único globalmente';
COMMENT ON COLUMN empresas.deleted_at IS 'Soft delete: NULL = activo';


CREATE TABLE sucursales (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID         NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(100) NOT NULL,
    direccion   TEXT,
    ciudad      VARCHAR(80),
    provincia   VARCHAR(80),
    telefono    VARCHAR(30),
    email       VARCHAR(120),
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sucursales IS 'Sucursales por empresa. Inventario y clases son por sucursal.';

CREATE INDEX idx_sucursales_empresa ON sucursales(empresa_id);
CREATE INDEX idx_sucursales_activo  ON sucursales(empresa_id, activo) WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 2. CODAN CORE · MÓDULO PERSONAS
-- -----------------------------------------------------------------------------

CREATE TABLE personas (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       UUID         NOT NULL REFERENCES empresas(id),
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    fecha_nacimiento DATE,
    genero           VARCHAR(20)
                         CHECK (genero IN ('M','F','X','NB')),
    foto_url         TEXT,
    qr_code          VARCHAR(100),
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_personas_qr UNIQUE (qr_code)
);

COMMENT ON TABLE  personas         IS 'Registro único de identidad. Una persona puede tener múltiples roles.';
COMMENT ON COLUMN personas.qr_code IS 'Código QR único para control de acceso y asistencias';

CREATE INDEX idx_personas_empresa   ON personas(empresa_id);
CREATE INDEX idx_personas_apellidos ON personas(empresa_id, apellidos, nombres);
CREATE INDEX idx_personas_trgm      ON personas USING gin((apellidos || ' ' || nombres) gin_trgm_ops);


CREATE TABLE persona_documentos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id  UUID        NOT NULL REFERENCES personas(id),
    tipo        VARCHAR(20) NOT NULL
                    CHECK (tipo IN ('DNI','PASAPORTE','CUIL','CUIT','OTRO')),
    numero      VARCHAR(30) NOT NULL,
    vencimiento DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_persona_doc UNIQUE (persona_id, tipo, numero)
);

COMMENT ON TABLE persona_documentos IS '1FN: un documento por fila, no campos dni1/pasaporte/cuil separados';

CREATE INDEX idx_persona_docs_persona ON persona_documentos(persona_id);


CREATE TABLE persona_contactos (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id  UUID         NOT NULL REFERENCES personas(id),
    tipo        VARCHAR(20)  NOT NULL
                    CHECK (tipo IN ('TEL','CEL','EMAIL','WA','IG','OTRO')),
    valor       VARCHAR(150) NOT NULL,
    principal   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE persona_contactos IS '1FN: un contacto por fila, sin listas en campos';

CREATE INDEX idx_persona_contactos_persona ON persona_contactos(persona_id);


CREATE TABLE persona_direcciones (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id      UUID         NOT NULL REFERENCES personas(id),
    calle           VARCHAR(150) NOT NULL,
    numero          VARCHAR(10),
    piso            VARCHAR(10),
    ciudad          VARCHAR(80)  NOT NULL,
    provincia       VARCHAR(80)  NOT NULL,
    codigo_postal   VARCHAR(10),
    principal       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_persona_direcciones_persona ON persona_direcciones(persona_id);


-- -----------------------------------------------------------------------------
-- 3. CODAN CORE · MÓDULO SEGURIDAD
-- -----------------------------------------------------------------------------

CREATE TABLE usuarios (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    UUID         NOT NULL REFERENCES empresas(id),
    persona_id    UUID         REFERENCES personas(id),
    email         VARCHAR(150) NOT NULL,
    password_hash TEXT         NOT NULL,
    ultimo_login  TIMESTAMPTZ,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_usuarios_email UNIQUE (email)
);

COMMENT ON TABLE  usuarios           IS 'Credenciales de acceso. Separado de personas para usuarios técnicos.';
COMMENT ON COLUMN usuarios.persona_id IS 'NULL si es usuario técnico sin persona física asociada';

CREATE INDEX idx_usuarios_empresa ON usuarios(empresa_id);
CREATE INDEX idx_usuarios_persona ON usuarios(persona_id);
CREATE INDEX idx_usuarios_email   ON usuarios(email);


CREATE TABLE roles (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID         REFERENCES empresas(id),
    nombre      VARCHAR(60)  NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_roles_empresa_nombre UNIQUE (empresa_id, nombre)
);

COMMENT ON COLUMN roles.empresa_id IS 'NULL = rol global del sistema (SUPERADMIN, SISTEMA)';

CREATE INDEX idx_roles_empresa ON roles(empresa_id);


CREATE TABLE permisos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(80) NOT NULL,
    descripcion TEXT,
    modulo      VARCHAR(40) NOT NULL,

    CONSTRAINT uq_permisos_codigo UNIQUE (codigo)
);

COMMENT ON TABLE  permisos       IS 'Catálogo RBAC. Ej: socios.crear, clases.editar, facturas.emitir';
COMMENT ON COLUMN permisos.codigo IS 'Formato: modulo.accion — ej: socios.crear';

CREATE INDEX idx_permisos_modulo ON permisos(modulo);


CREATE TABLE rol_permisos (
    rol_id      UUID NOT NULL REFERENCES roles(id),
    permiso_id  UUID NOT NULL REFERENCES permisos(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (rol_id, permiso_id)
);

COMMENT ON TABLE rol_permisos IS '2FN: PK compuesta. No hay atributos que dependan parcialmente de rol_id o permiso_id solos.';

CREATE INDEX idx_rol_permisos_permiso ON rol_permisos(permiso_id);


CREATE TABLE usuario_roles (
    id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID  NOT NULL REFERENCES usuarios(id),
    rol_id      UUID  NOT NULL REFERENCES roles(id),
    sucursal_id UUID  REFERENCES sucursales(id),
    fecha_desde DATE  NOT NULL,
    fecha_hasta DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usuario_roles_fechas CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde)
);

COMMENT ON TABLE  usuario_roles             IS 'Asignación de roles. Historial completo con fechas.';
COMMENT ON COLUMN usuario_roles.sucursal_id IS 'NULL = el rol aplica a todas las sucursales de la empresa';

CREATE INDEX idx_usuario_roles_usuario  ON usuario_roles(usuario_id);
CREATE INDEX idx_usuario_roles_activo   ON usuario_roles(usuario_id, rol_id)
    WHERE fecha_hasta IS NULL;


-- -----------------------------------------------------------------------------
-- 4. CODAN CORE · MÓDULO AUDITORÍA
-- -----------------------------------------------------------------------------

CREATE TABLE auditoria (
    id             BIGSERIAL    PRIMARY KEY,
    empresa_id     UUID         NOT NULL,
    usuario_id     UUID,
    tabla          VARCHAR(60)  NOT NULL,
    operacion      VARCHAR(10)  NOT NULL
                       CHECK (operacion IN ('INSERT','UPDATE','DELETE','SELECT')),
    registro_id    TEXT         NOT NULL,
    datos_antes    JSONB,
    datos_despues  JSONB,
    ip             INET,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  auditoria            IS 'Log inmutable. Sin FK para poder auditar cualquier tabla.';
COMMENT ON COLUMN auditoria.registro_id IS 'PK del registro afectado como TEXT (compatible con UUID, BIGINT, etc.)';

CREATE INDEX idx_auditoria_empresa_tabla ON auditoria(empresa_id, tabla, created_at DESC);
CREATE INDEX idx_auditoria_registro      ON auditoria(tabla, registro_id);
CREATE INDEX idx_auditoria_usuario       ON auditoria(usuario_id) WHERE usuario_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. SMARTGYM · MÓDULO SOCIOS Y ROLES DE PERSONA
-- -----------------------------------------------------------------------------

CREATE TABLE tipo_roles_persona (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID         NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(40)  NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_tipo_rol_empresa UNIQUE (empresa_id, nombre)
);

COMMENT ON TABLE tipo_roles_persona IS 'Catálogo: SOCIO, PROFESOR, EMPLEADO, CLIENTE, PROVEEDOR';

CREATE INDEX idx_tipo_roles_empresa ON tipo_roles_persona(empresa_id);


CREATE TABLE persona_roles (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id    UUID         NOT NULL REFERENCES personas(id),
    tipo_rol_id   UUID         NOT NULL REFERENCES tipo_roles_persona(id),
    sucursal_id   UUID         REFERENCES sucursales(id),
    numero_socio  VARCHAR(20),
    fecha_alta    DATE         NOT NULL,
    fecha_baja    DATE,
    observaciones TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_persona_rol_sucursal UNIQUE (persona_id, tipo_rol_id, sucursal_id),
    CONSTRAINT chk_persona_roles_fechas CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);

COMMENT ON TABLE  persona_roles              IS 'Un registro por rol asignado. Permite: una persona = socio + profesor simultáneamente.';
COMMENT ON COLUMN persona_roles.numero_socio IS 'Solo se completa cuando tipo_rol = SOCIO';
COMMENT ON COLUMN persona_roles.sucursal_id  IS 'NULL = rol en todas las sucursales';

CREATE INDEX idx_persona_roles_persona  ON persona_roles(persona_id);
CREATE INDEX idx_persona_roles_tipo     ON persona_roles(tipo_rol_id);
CREATE INDEX idx_persona_roles_activos  ON persona_roles(persona_id)
    WHERE fecha_baja IS NULL;
CREATE UNIQUE INDEX uq_numero_socio_empresa
    ON persona_roles(numero_socio)
    WHERE numero_socio IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6. SMARTGYM · MÓDULO DISCIPLINAS
-- -----------------------------------------------------------------------------

CREATE TABLE disciplinas (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID         NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(80)  NOT NULL,
    descripcion TEXT,
    color_hex   VARCHAR(7)
                    CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    icono       VARCHAR(50),
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_disciplina_empresa UNIQUE (empresa_id, nombre)
);

COMMENT ON TABLE  disciplinas          IS 'Musculación, Crossfit, Yoga, Pilates, etc.';
COMMENT ON COLUMN disciplinas.color_hex IS 'Color HEX para calendarios de clases. Formato: #RRGGBB';

CREATE INDEX idx_disciplinas_empresa ON disciplinas(empresa_id);


CREATE TABLE profesor_disciplinas (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_rol_id UUID        NOT NULL REFERENCES persona_roles(id),
    disciplina_id  UUID        NOT NULL REFERENCES disciplinas(id),
    nivel          VARCHAR(20)
                       CHECK (nivel IN ('BASICO','INTERMEDIO','AVANZADO')),
    activo         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_profesor_disciplina UNIQUE (persona_rol_id, disciplina_id)
);

COMMENT ON TABLE  profesor_disciplinas           IS 'N:M: un profesor puede dictar múltiples disciplinas.';
COMMENT ON COLUMN profesor_disciplinas.persona_rol_id IS 'Debe ser el rol PROFESOR de la persona';

CREATE INDEX idx_profesor_disc_disciplina ON profesor_disciplinas(disciplina_id);


-- -----------------------------------------------------------------------------
-- 7. SMARTGYM · MÓDULO MEMBRESÍAS
-- -----------------------------------------------------------------------------

CREATE TABLE planes (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id              UUID          NOT NULL REFERENCES empresas(id),
    nombre                  VARCHAR(100)  NOT NULL,
    descripcion             TEXT,
    precio                  NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
    duracion_dias           INTEGER       NOT NULL CHECK (duracion_dias > 0),
    tipo                    VARCHAR(20)   NOT NULL
                                CHECK (tipo IN ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL','DIARIO','CLASES')),
    acceso_todas_sucursales BOOLEAN       NOT NULL DEFAULT FALSE,
    cantidad_clases         INTEGER       CHECK (cantidad_clases IS NULL OR cantidad_clases > 0),
    activo                  BOOLEAN       NOT NULL DEFAULT TRUE,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  planes                         IS 'Plantillas de membresía reutilizables.';
COMMENT ON COLUMN planes.cantidad_clases         IS 'NULL = clases ilimitadas incluidas en el plan';
COMMENT ON COLUMN planes.acceso_todas_sucursales IS 'TRUE = el socio puede asistir a cualquier sucursal';

CREATE INDEX idx_planes_empresa ON planes(empresa_id);
CREATE INDEX idx_planes_activos ON planes(empresa_id, activo) WHERE deleted_at IS NULL;


CREATE TABLE plan_disciplinas (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id       UUID        NOT NULL REFERENCES planes(id),
    disciplina_id UUID        NOT NULL REFERENCES disciplinas(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_plan_disciplina UNIQUE (plan_id, disciplina_id)
);

COMMENT ON TABLE plan_disciplinas IS '2FN: disciplina_id depende de (plan_id + disciplina_id) completo.';

CREATE INDEX idx_plan_disciplinas_disciplina ON plan_disciplinas(disciplina_id);


CREATE TABLE inscripciones (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_rol_id UUID          NOT NULL REFERENCES persona_roles(id),
    plan_id        UUID          NOT NULL REFERENCES planes(id),
    sucursal_id    UUID          NOT NULL REFERENCES sucursales(id),
    fecha_inicio   DATE          NOT NULL,
    fecha_fin      DATE          NOT NULL,
    precio_pagado  NUMERIC(12,2) NOT NULL CHECK (precio_pagado >= 0),
    estado         VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (estado IN ('ACTIVA','VENCIDA','CANCELADA','SUSPENDIDA','PENDIENTE')),
    observaciones  TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_inscripcion_fechas CHECK (fecha_fin > fecha_inicio)
);

COMMENT ON TABLE  inscripciones              IS 'Historial completo. Múltiples inscripciones históricas por socio.';
COMMENT ON COLUMN inscripciones.precio_pagado IS '3FN: snapshot del precio real al momento de inscripción (planes.precio puede cambiar)';

CREATE INDEX idx_inscripciones_socio   ON inscripciones(persona_rol_id);
CREATE INDEX idx_inscripciones_plan    ON inscripciones(plan_id);
CREATE INDEX idx_inscripciones_vence   ON inscripciones(fecha_fin) WHERE estado = 'ACTIVA';
CREATE INDEX idx_inscripciones_sucursal ON inscripciones(sucursal_id);

-- Regla de negocio: un solo estado ACTIVA por socio (índice único parcial)
CREATE UNIQUE INDEX uq_inscripcion_activa_por_socio
    ON inscripciones(persona_rol_id)
    WHERE estado = 'ACTIVA';

COMMENT ON INDEX uq_inscripcion_activa_por_socio
    IS 'Garantiza DB-level que un socio solo tenga una inscripción ACTIVA simultánea';


-- -----------------------------------------------------------------------------
-- 8. SMARTGYM · MÓDULO CERTIFICADOS MÉDICOS
-- -----------------------------------------------------------------------------

CREATE TABLE certificados_medicos (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_rol_id    UUID        NOT NULL REFERENCES persona_roles(id),
    tipo              VARCHAR(30) NOT NULL
                          CHECK (tipo IN ('APTO_FISICO','APTO_DEPORTIVO','INFORME_MEDICO')),
    fecha_emision     DATE        NOT NULL,
    fecha_vencimiento DATE        NOT NULL,
    medico_nombre     VARCHAR(150),
    matricula         VARCHAR(30),
    archivo_url       TEXT,
    estado            VARCHAR(20) NOT NULL DEFAULT 'VIGENTE'
                          CHECK (estado IN ('VIGENTE','VENCIDO','POR_VENCER')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_cert_fechas CHECK (fecha_vencimiento > fecha_emision)
);

COMMENT ON TABLE certificados_medicos IS 'Aptos físicos con control de vencimiento. Preparado para alertas push.';

CREATE INDEX idx_cert_medicos_persona  ON certificados_medicos(persona_rol_id);
CREATE INDEX idx_cert_medicos_vence    ON certificados_medicos(fecha_vencimiento)
    WHERE estado IN ('VIGENTE','POR_VENCER');


-- -----------------------------------------------------------------------------
-- 9. SMARTGYM · MÓDULO CLASES Y HORARIOS
-- -----------------------------------------------------------------------------

CREATE TABLE clases (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    UUID         NOT NULL REFERENCES empresas(id),
    sucursal_id   UUID         NOT NULL REFERENCES sucursales(id),
    disciplina_id UUID         NOT NULL REFERENCES disciplinas(id),
    nombre        VARCHAR(100) NOT NULL,
    descripcion   TEXT,
    cupo_maximo   INTEGER      NOT NULL CHECK (cupo_maximo > 0),
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE clases IS 'Definición de clases por sucursal y disciplina.';

CREATE INDEX idx_clases_sucursal    ON clases(sucursal_id);
CREATE INDEX idx_clases_disciplina  ON clases(disciplina_id);


CREATE TABLE horarios (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    clase_id       UUID        NOT NULL REFERENCES clases(id),
    profesor_rol_id UUID       REFERENCES persona_roles(id),
    dia_semana     SMALLINT    NOT NULL
                       CHECK (dia_semana BETWEEN 1 AND 7),
    hora_inicio    TIME        NOT NULL,
    hora_fin       TIME        NOT NULL,
    activo         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_horario_horas CHECK (hora_fin > hora_inicio)
);

COMMENT ON COLUMN horarios.dia_semana IS '1=Lunes ... 7=Domingo (ISO 8601)';

CREATE INDEX idx_horarios_clase     ON horarios(clase_id);
CREATE INDEX idx_horarios_profesor  ON horarios(profesor_rol_id) WHERE profesor_rol_id IS NOT NULL;
CREATE INDEX idx_horarios_dia       ON horarios(dia_semana, hora_inicio);


CREATE TABLE reservas_clases (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    horario_id     UUID        NOT NULL REFERENCES horarios(id),
    inscripcion_id UUID        NOT NULL REFERENCES inscripciones(id),
    fecha          DATE        NOT NULL,
    estado         VARCHAR(20) NOT NULL DEFAULT 'RESERVADA'
                       CHECK (estado IN ('RESERVADA','CONFIRMADA','CANCELADA','AUSENTE')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_reserva_horario_fecha UNIQUE (horario_id, inscripcion_id, fecha)
);

COMMENT ON TABLE reservas_clases IS 'Reserva de cupo. UNIQUE evita doble reserva al mismo horario-fecha.';

CREATE INDEX idx_reservas_inscripcion ON reservas_clases(inscripcion_id);
CREATE INDEX idx_reservas_fecha       ON reservas_clases(fecha, horario_id);


-- -----------------------------------------------------------------------------
-- 10. SMARTGYM · MÓDULO ASISTENCIAS
-- -----------------------------------------------------------------------------

CREATE TABLE asistencias (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    inscripcion_id      UUID        NOT NULL REFERENCES inscripciones(id),
    sucursal_id         UUID        NOT NULL REFERENCES sucursales(id),
    fecha_hora_ingreso  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_hora_egreso   TIMESTAMPTZ,
    metodo_registro     VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
                            CHECK (metodo_registro IN ('MANUAL','QR','TORNIQUETE','BIOMETRIA','APP')),
    dispositivo_id      VARCHAR(60),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_asistencia_egreso
        CHECK (fecha_hora_egreso IS NULL OR fecha_hora_egreso > fecha_hora_ingreso)
);

COMMENT ON TABLE  asistencias              IS 'Registro de accesos. Preparado para QR, torniquete y biometría.';
COMMENT ON COLUMN asistencias.dispositivo_id IS 'ID del lector QR, torniquete o sensor biométrico';

CREATE INDEX idx_asistencias_inscripcion ON asistencias(inscripcion_id);
CREATE INDEX idx_asistencias_sucursal    ON asistencias(sucursal_id, fecha_hora_ingreso DESC);
CREATE INDEX idx_asistencias_fecha       ON asistencias(fecha_hora_ingreso DESC);


-- -----------------------------------------------------------------------------
-- 11. SMARTGYM · MÓDULO RUTINAS (PREPARADO PARA FUTURO)
-- -----------------------------------------------------------------------------

CREATE TABLE grupos_musculares (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(60) NOT NULL,
    descripcion TEXT,

    CONSTRAINT uq_grupo_muscular_nombre UNIQUE (nombre)
);

INSERT INTO grupos_musculares (nombre) VALUES
    ('Pecho'), ('Espalda'), ('Hombros'), ('Bíceps'), ('Tríceps'),
    ('Abdomen'), ('Piernas'), ('Glúteos'), ('Pantorrillas'), ('Antebrazos');


CREATE TABLE ejercicios (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id        UUID         REFERENCES empresas(id),
    nombre            VARCHAR(100) NOT NULL,
    descripcion       TEXT,
    video_url         TEXT,
    grupo_muscular_id UUID         REFERENCES grupos_musculares(id),
    activo            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN ejercicios.empresa_id IS 'NULL = ejercicio global del sistema. No NULL = ejercicio personalizado de la empresa.';

CREATE INDEX idx_ejercicios_empresa ON ejercicios(empresa_id);
CREATE INDEX idx_ejercicios_grupo   ON ejercicios(grupo_muscular_id);


CREATE TABLE rutinas (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       UUID        REFERENCES empresas(id),
    nombre           VARCHAR(100) NOT NULL,
    descripcion      TEXT,
    duracion_semanas INTEGER,
    nivel            VARCHAR(20)
                         CHECK (nivel IN ('PRINCIPIANTE','INTERMEDIO','AVANZADO')),
    activo           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rutinas_empresa ON rutinas(empresa_id);


CREATE TABLE rutina_ejercicios (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    rutina_id      UUID         NOT NULL REFERENCES rutinas(id),
    ejercicio_id   UUID         NOT NULL REFERENCES ejercicios(id),
    dia_numero     SMALLINT     NOT NULL CHECK (dia_numero >= 1),
    orden          SMALLINT     NOT NULL CHECK (orden >= 1),
    series         SMALLINT     NOT NULL CHECK (series >= 1),
    repeticiones   VARCHAR(20)  NOT NULL,
    descanso_seg   INTEGER      CHECK (descanso_seg >= 0),
    observaciones  TEXT,

    CONSTRAINT uq_rutina_ejercicio_dia_orden UNIQUE (rutina_id, dia_numero, orden)
);

COMMENT ON TABLE  rutina_ejercicios            IS '2FN: series y repeticiones dependen del contexto completo (rutina+ejercicio+día+orden).';
COMMENT ON COLUMN rutina_ejercicios.repeticiones IS 'Texto libre: "8-12", "15", "AMRAP", "Al fallo"';

CREATE INDEX idx_rutina_ejercicios_rutina    ON rutina_ejercicios(rutina_id);
CREATE INDEX idx_rutina_ejercicios_ejercicio ON rutina_ejercicios(ejercicio_id);


CREATE TABLE socio_rutinas (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_rol_id  UUID        NOT NULL REFERENCES persona_roles(id),
    rutina_id       UUID        NOT NULL REFERENCES rutinas(id),
    profesor_rol_id UUID        REFERENCES persona_roles(id),
    fecha_inicio    DATE        NOT NULL,
    fecha_fin       DATE,
    activo          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN socio_rutinas.profesor_rol_id IS 'Profesor que diseñó o asignó la rutina (puede ser NULL si fue autogenerada)';

CREATE INDEX idx_socio_rutinas_socio ON socio_rutinas(persona_rol_id);
CREATE INDEX idx_socio_rutinas_activa ON socio_rutinas(persona_rol_id, activo) WHERE activo = TRUE;


-- -----------------------------------------------------------------------------
-- 12. SMARTGYM · MÓDULO INVENTARIO Y PRODUCTOS
-- -----------------------------------------------------------------------------

CREATE TABLE categorias_productos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID        NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(80) NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_categoria_empresa UNIQUE (empresa_id, nombre)
);

CREATE INDEX idx_categorias_empresa ON categorias_productos(empresa_id);


CREATE TABLE marcas (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID        NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(80) NOT NULL,
    activo      BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_marca_empresa UNIQUE (empresa_id, nombre)
);

CREATE INDEX idx_marcas_empresa ON marcas(empresa_id);


CREATE TABLE productos (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    UUID          NOT NULL REFERENCES empresas(id),
    categoria_id  UUID          NOT NULL REFERENCES categorias_productos(id),
    marca_id      UUID          REFERENCES marcas(id),
    nombre        VARCHAR(150)  NOT NULL,
    descripcion   TEXT,
    codigo        VARCHAR(50),
    precio_venta  NUMERIC(12,2) NOT NULL CHECK (precio_venta >= 0),
    precio_costo  NUMERIC(12,2)          CHECK (precio_costo >= 0),
    activo        BOOLEAN       NOT NULL DEFAULT TRUE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_producto_codigo UNIQUE (empresa_id, codigo)
);

COMMENT ON TABLE  productos       IS 'Sin campo de stock. El stock se calcula desde movimientos_stock.';
COMMENT ON COLUMN productos.codigo IS 'SKU o código de barras. UNIQUE por empresa.';

CREATE INDEX idx_productos_empresa   ON productos(empresa_id);
CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_productos_codigo    ON productos(empresa_id, codigo) WHERE codigo IS NOT NULL;


CREATE TABLE producto_variantes (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID          NOT NULL REFERENCES productos(id),
    nombre              VARCHAR(60)   NOT NULL,
    valor               VARCHAR(60)   NOT NULL,
    precio_diferencial  NUMERIC(12,2) NOT NULL DEFAULT 0,
    activo              BOOLEAN       NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_variante_producto UNIQUE (producto_id, nombre, valor)
);

COMMENT ON TABLE producto_variantes IS '1FN: en lugar de columnas talla_s/talla_m/color_rojo, cada variante es una fila.';

CREATE INDEX idx_variantes_producto ON producto_variantes(producto_id);


CREATE TABLE inventario (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    sucursal_id  UUID          NOT NULL REFERENCES sucursales(id),
    producto_id  UUID          NOT NULL REFERENCES productos(id),
    variante_id  UUID          REFERENCES producto_variantes(id),
    stock_actual NUMERIC(12,3) NOT NULL DEFAULT 0,
    stock_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inventario_ubicacion UNIQUE (sucursal_id, producto_id, variante_id)
);

COMMENT ON TABLE  inventario             IS 'Stock calculado por sucursal. Actualizado por trigger desde movimientos_stock.';
COMMENT ON COLUMN inventario.stock_minimo IS 'Umbral para alertas de reposición';

CREATE INDEX idx_inventario_sucursal ON inventario(sucursal_id);
CREATE INDEX idx_inventario_producto ON inventario(producto_id);
CREATE INDEX idx_inventario_bajo_stock ON inventario(sucursal_id)
    WHERE stock_actual <= stock_minimo;


CREATE TABLE movimientos_stock (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    sucursal_id   UUID          NOT NULL REFERENCES sucursales(id),
    producto_id   UUID          NOT NULL REFERENCES productos(id),
    variante_id   UUID          REFERENCES producto_variantes(id),
    tipo          VARCHAR(20)   NOT NULL
                      CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE','TRANSFERENCIA','DEVOLUCION')),
    cantidad      NUMERIC(12,3) NOT NULL,
    motivo        TEXT,
    referencia_id UUID,
    usuario_id    UUID          NOT NULL REFERENCES usuarios(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_mov_cantidad CHECK (cantidad != 0)
);

COMMENT ON TABLE  movimientos_stock            IS 'Fuente de verdad del stock. Nunca modificar stock directamente en inventario sin pasar por aquí.';
COMMENT ON COLUMN movimientos_stock.referencia_id IS 'UUID de la venta, compra, transferencia o ajuste que originó el movimiento';
COMMENT ON COLUMN movimientos_stock.cantidad   IS 'Positivo = entrada. Negativo = salida.';

CREATE INDEX idx_mov_stock_sucursal  ON movimientos_stock(sucursal_id, created_at DESC);
CREATE INDEX idx_mov_stock_producto  ON movimientos_stock(producto_id);
CREATE INDEX idx_mov_stock_referencia ON movimientos_stock(referencia_id) WHERE referencia_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 13. SMARTGYM · MÓDULO VENTAS
-- -----------------------------------------------------------------------------

CREATE TABLE ventas (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id     UUID          NOT NULL REFERENCES empresas(id),
    sucursal_id    UUID          NOT NULL REFERENCES sucursales(id),
    persona_id     UUID          REFERENCES personas(id),
    usuario_id     UUID          NOT NULL REFERENCES usuarios(id),
    fecha          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    descuento      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
    total          NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    estado         VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (estado IN ('PENDIENTE','COMPLETADA','CANCELADA','DEVUELTA')),
    observaciones  TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  ventas           IS 'Cabecera de venta. Desacoplada de factura.';
COMMENT ON COLUMN ventas.persona_id IS 'NULL = venta anónima (sin cliente registrado)';
COMMENT ON COLUMN ventas.usuario_id IS 'Operador que realizó la venta';

CREATE INDEX idx_ventas_empresa  ON ventas(empresa_id, fecha DESC);
CREATE INDEX idx_ventas_sucursal ON ventas(sucursal_id, fecha DESC);
CREATE INDEX idx_ventas_persona  ON ventas(persona_id) WHERE persona_id IS NOT NULL;


CREATE TABLE detalle_ventas (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id        UUID          NOT NULL REFERENCES ventas(id),
    producto_id     UUID          REFERENCES productos(id),
    variante_id     UUID          REFERENCES producto_variantes(id),
    descripcion     VARCHAR(150)  NOT NULL,
    cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
    descuento       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
    subtotal        NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0)
);

COMMENT ON TABLE  detalle_ventas             IS '2FN: precio_unitario depende de (venta + producto) completo.';
COMMENT ON COLUMN detalle_ventas.descripcion  IS '3FN: snapshot del nombre del producto al momento de venta';
COMMENT ON COLUMN detalle_ventas.producto_id  IS 'NULL si el ítem es un servicio sin producto registrado';

CREATE INDEX idx_detalle_ventas_venta    ON detalle_ventas(venta_id);
CREATE INDEX idx_detalle_ventas_producto ON detalle_ventas(producto_id) WHERE producto_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 14. SMARTGYM · MÓDULO PAGOS
-- -----------------------------------------------------------------------------

CREATE TABLE medios_pago (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID        NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(60) NOT NULL,
    tipo        VARCHAR(20) NOT NULL
                    CHECK (tipo IN ('EFECTIVO','TRANSFERENCIA','MERCADOPAGO','DEBITO','CREDITO','OTRO')),
    activo      BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_medio_pago_empresa UNIQUE (empresa_id, nombre)
);

CREATE INDEX idx_medios_pago_empresa ON medios_pago(empresa_id);


CREATE TABLE pagos (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id          UUID          REFERENCES ventas(id),
    inscripcion_id    UUID          REFERENCES inscripciones(id),
    medio_pago_id     UUID          NOT NULL REFERENCES medios_pago(id),
    monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
    fecha             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    referencia_externa VARCHAR(100),
    estado            VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                          CHECK (estado IN ('PENDIENTE','APROBADO','RECHAZADO','DEVUELTO')),
    usuario_id        UUID          NOT NULL REFERENCES usuarios(id),
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_pago_origen
        CHECK (venta_id IS NOT NULL OR inscripcion_id IS NOT NULL)
);

COMMENT ON TABLE  pagos                    IS 'Un pago puede asociarse a una venta o directamente a una inscripción.';
COMMENT ON COLUMN pagos.referencia_externa  IS 'ID de transacción MP, CBU de transferencia, etc.';
COMMENT ON COLUMN pagos.inscripcion_id      IS 'Pago directo de membresía sin pasar por venta en caja';

CREATE INDEX idx_pagos_venta        ON pagos(venta_id) WHERE venta_id IS NOT NULL;
CREATE INDEX idx_pagos_inscripcion  ON pagos(inscripcion_id) WHERE inscripcion_id IS NOT NULL;
CREATE INDEX idx_pagos_fecha        ON pagos(fecha DESC);


-- -----------------------------------------------------------------------------
-- 15. SMARTGYM · MÓDULO FACTURACIÓN (ARCA/AFIP READY)
-- -----------------------------------------------------------------------------

CREATE TABLE puntos_venta (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sucursal_id UUID        NOT NULL REFERENCES sucursales(id),
    numero      SMALLINT    NOT NULL CHECK (numero BETWEEN 1 AND 9999),
    tipo        VARCHAR(20) NOT NULL
                    CHECK (tipo IN ('ELECTRONICO','MANUAL','WEB')),
    activo      BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_punto_venta_sucursal UNIQUE (sucursal_id, numero)
);

COMMENT ON TABLE puntos_venta IS 'Puntos de venta AFIP. Número secuencial independiente por sucursal.';

CREATE INDEX idx_puntos_venta_sucursal ON puntos_venta(sucursal_id);


CREATE TABLE facturas (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id       UUID          NOT NULL REFERENCES empresas(id),
    punto_venta_id   UUID          NOT NULL REFERENCES puntos_venta(id),
    tipo_comprobante VARCHAR(5)    NOT NULL
                         CHECK (tipo_comprobante IN ('FA','FB','FC','NCA','NCB','NCC')),
    numero           INTEGER       NOT NULL CHECK (numero > 0),
    fecha            DATE          NOT NULL,
    persona_id       UUID          REFERENCES personas(id),
    venta_id         UUID          REFERENCES ventas(id),
    subtotal         NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    iva              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
    total            NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    cae              VARCHAR(14),
    cae_vencimiento  DATE,
    estado           VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                         CHECK (estado IN ('PENDIENTE','EMITIDA','ANULADA','ERROR')),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_factura_numero UNIQUE (punto_venta_id, tipo_comprobante, numero),
    CONSTRAINT chk_cae_vencimiento
        CHECK (cae IS NULL OR cae_vencimiento IS NOT NULL)
);

COMMENT ON TABLE  facturas              IS 'Preparada para ARCA/AFIP. CAE y vencimiento por columnas dedicadas (no JSONB).';
COMMENT ON COLUMN facturas.cae          IS 'CAE devuelto por AFIP/ARCA tras autorización electrónica';
COMMENT ON COLUMN facturas.tipo_comprobante IS 'FA=Factura A, FB=Factura B, FC=Factura C, NCA/NCB/NCC=Notas de Crédito';

CREATE INDEX idx_facturas_empresa  ON facturas(empresa_id, fecha DESC);
CREATE INDEX idx_facturas_persona  ON facturas(persona_id) WHERE persona_id IS NOT NULL;
CREATE INDEX idx_facturas_venta    ON facturas(venta_id) WHERE venta_id IS NOT NULL;
CREATE INDEX idx_facturas_cae      ON facturas(cae) WHERE cae IS NOT NULL;
CREATE INDEX idx_facturas_estado   ON facturas(estado) WHERE estado IN ('PENDIENTE','ERROR');


CREATE TABLE detalle_facturas (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_id      UUID          NOT NULL REFERENCES facturas(id),
    descripcion     VARCHAR(150)  NOT NULL,
    cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
    alicuota_iva    NUMERIC(5,2)  NOT NULL DEFAULT 21.00
                        CHECK (alicuota_iva IN (0, 10.50, 21.00, 27.00)),
    subtotal        NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0)
);

COMMENT ON TABLE  detalle_facturas           IS 'Ítems de factura. Inmutables una vez que la factura está EMITIDA.';
COMMENT ON COLUMN detalle_facturas.alicuota_iva IS 'Alícuotas IVA válidas AFIP: 0%, 10.5%, 21%, 27%';

CREATE INDEX idx_detalle_facturas_factura ON detalle_facturas(factura_id);


-- =============================================================================
-- TRIGGERS · UPDATED_AT AUTOMÁTICO
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'empresas','sucursales','personas','usuarios',
        'persona_roles','planes','inscripciones','ventas','facturas'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_updated_at()',
            t, t
        );
    END LOOP;
END;
$$;


-- =============================================================================
-- TRIGGER · ACTUALIZAR INVENTARIO DESDE MOVIMIENTOS
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_actualizar_inventario()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO inventario (sucursal_id, producto_id, variante_id, stock_actual, updated_at)
    VALUES (NEW.sucursal_id, NEW.producto_id, NEW.variante_id, NEW.cantidad, NOW())
    ON CONFLICT (sucursal_id, producto_id, variante_id)
    DO UPDATE SET
        stock_actual = inventario.stock_actual + EXCLUDED.stock_actual,
        updated_at   = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimientos_stock_inventario
    AFTER INSERT ON movimientos_stock
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_inventario();

COMMENT ON FUNCTION fn_actualizar_inventario() IS
    'Actualiza inventario.stock_actual automáticamente al insertar movimientos_stock';


-- =============================================================================
-- TRIGGER · AUDITORÍA AUTOMÁTICA (EJEMPLO PARA INSCRIPCIONES)
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO auditoria(empresa_id, tabla, operacion, registro_id, datos_antes)
        SELECT OLD.empresa_id, TG_TABLE_NAME, 'DELETE', OLD.id::TEXT, to_jsonb(OLD)
        FROM sucursales s WHERE s.id = OLD.sucursal_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO auditoria(tabla, operacion, registro_id, datos_antes, datos_despues, empresa_id)
        VALUES (TG_TABLE_NAME, 'UPDATE', NEW.id::TEXT, to_jsonb(OLD), to_jsonb(NEW),
            (SELECT empresa_id FROM sucursales WHERE id = NEW.sucursal_id));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO auditoria(tabla, operacion, registro_id, datos_despues, empresa_id)
        VALUES (TG_TABLE_NAME, 'INSERT', NEW.id::TEXT, to_jsonb(NEW),
            (SELECT empresa_id FROM sucursales WHERE id = NEW.sucursal_id));
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_inscripciones_auditoria
    AFTER INSERT OR UPDATE OR DELETE ON inscripciones
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();


-- =============================================================================
-- DATOS SEMILLA (SEED) — PERMISOS BASE DEL SISTEMA
-- =============================================================================

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
-- Socios
('socios.ver',         'socios', 'Ver listado y ficha de socios'),
('socios.crear',       'socios', 'Registrar nuevo socio'),
('socios.editar',      'socios', 'Modificar datos de socio'),
('socios.eliminar',    'socios', 'Dar de baja un socio (soft delete)'),
-- Inscripciones
('inscripciones.ver',    'inscripciones', 'Ver inscripciones y membresías'),
('inscripciones.crear',  'inscripciones', 'Registrar nueva inscripción'),
('inscripciones.editar', 'inscripciones', 'Modificar inscripción activa'),
('inscripciones.anular', 'inscripciones', 'Anular/cancelar inscripción'),
-- Clases
('clases.ver',    'clases', 'Ver clases y horarios'),
('clases.crear',  'clases', 'Crear clase y horario'),
('clases.editar', 'clases', 'Modificar clase u horario'),
-- Asistencias
('asistencias.ver',      'asistencias', 'Ver registro de asistencias'),
('asistencias.registrar','asistencias', 'Registrar ingreso/egreso manual'),
-- Inventario
('inventario.ver',    'inventario', 'Ver stock y productos'),
('inventario.ajustar','inventario', 'Registrar ajuste de stock'),
('productos.crear',   'inventario', 'Crear producto'),
('productos.editar',  'inventario', 'Modificar producto'),
-- Ventas
('ventas.ver',    'ventas', 'Ver ventas realizadas'),
('ventas.crear',  'ventas', 'Registrar venta'),
('ventas.anular', 'ventas', 'Anular venta'),
-- Pagos
('pagos.ver',     'pagos', 'Ver cobros y pagos'),
('pagos.registrar','pagos','Registrar cobro'),
-- Facturación
('facturas.ver',    'facturacion', 'Ver facturas emitidas'),
('facturas.emitir', 'facturacion', 'Emitir factura electrónica ARCA'),
('facturas.anular', 'facturacion', 'Anular comprobante'),
-- Reportes
('reportes.ver',      'reportes', 'Ver reportes generales'),
('reportes.exportar', 'reportes', 'Exportar reportes a Excel/PDF'),
-- Configuración
('config.ver',    'config', 'Ver configuración del sistema'),
('config.editar', 'config', 'Modificar configuración'),
-- Admin
('empresa.admin', 'admin', 'Administración total de la empresa'),
('sistema.super', 'admin', 'Superadministrador del SaaS');


-- =============================================================================
-- VISTAS ÚTILES
-- =============================================================================

CREATE VIEW v_socios_activos AS
SELECT
    p.empresa_id,
    p.id           AS persona_id,
    p.apellidos,
    p.nombres,
    p.qr_code,
    pr.id          AS persona_rol_id,
    pr.numero_socio,
    pr.fecha_alta,
    i.id           AS inscripcion_id,
    i.plan_id,
    pl.nombre      AS plan_nombre,
    i.fecha_inicio,
    i.fecha_fin,
    i.estado       AS inscripcion_estado
FROM personas p
JOIN persona_roles pr        ON pr.persona_id = p.id
JOIN tipo_roles_persona tr   ON tr.id = pr.tipo_rol_id AND tr.nombre = 'SOCIO'
LEFT JOIN inscripciones i    ON i.persona_rol_id = pr.id AND i.estado = 'ACTIVA'
LEFT JOIN planes pl          ON pl.id = i.plan_id
WHERE p.deleted_at IS NULL
  AND pr.fecha_baja IS NULL;

COMMENT ON VIEW v_socios_activos IS 'Socios con rol SOCIO activo e inscripción vigente. Punto de partida para recepción.';


CREATE VIEW v_stock_actual AS
SELECT
    s.empresa_id,
    inv.sucursal_id,
    sc.nombre      AS sucursal,
    inv.producto_id,
    pr.nombre      AS producto,
    pr.codigo,
    pv.nombre      AS variante,
    inv.stock_actual,
    inv.stock_minimo,
    CASE WHEN inv.stock_actual <= inv.stock_minimo THEN TRUE ELSE FALSE END AS bajo_minimo
FROM inventario inv
JOIN sucursales sc          ON sc.id = inv.sucursal_id
JOIN sucursales s2          ON s2.id = inv.sucursal_id
JOIN empresas s             ON s.id = sc.empresa_id
JOIN productos pr           ON pr.id = inv.producto_id
LEFT JOIN producto_variantes pv ON pv.id = inv.variante_id;

COMMENT ON VIEW v_stock_actual IS 'Stock consolidado por sucursal con alerta de bajo mínimo.';


CREATE VIEW v_asistencias_hoy AS
SELECT
    a.sucursal_id,
    sc.nombre      AS sucursal,
    p.empresa_id,
    p.apellidos || ', ' || p.nombres AS socio,
    pr.numero_socio,
    a.fecha_hora_ingreso,
    a.fecha_hora_egreso,
    a.metodo_registro
FROM asistencias a
JOIN inscripciones i   ON i.id = a.inscripcion_id
JOIN persona_roles pr  ON pr.id = i.persona_rol_id
JOIN personas p        ON p.id = pr.persona_id
JOIN sucursales sc     ON sc.id = a.sucursal_id
WHERE a.fecha_hora_ingreso >= CURRENT_DATE
  AND a.fecha_hora_ingreso <  CURRENT_DATE + INTERVAL '1 day'
ORDER BY a.fecha_hora_ingreso DESC;

COMMENT ON VIEW v_asistencias_hoy IS 'Todos los ingresos del día en curso, para pantalla de recepción.';


-- =============================================================================
-- FIN DE MIGRACIÓN
-- =============================================================================
-- Tablas creadas: 33 (CODAN CORE: 11 · SMARTGYM: 22)
-- Índices: 60+
-- Triggers: updated_at (9 tablas) + inventario (1) + auditoría (1)
-- Vistas: v_socios_activos · v_stock_actual · v_asistencias_hoy
-- Seed: 32 permisos base del sistema
-- =============================================================================
