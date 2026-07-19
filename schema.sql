-- ====================================================================
-- CICSA COMEDOR — Esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query → Run
-- ====================================================================

-- Empleados (identificados por número de teléfono WhatsApp)
CREATE TABLE IF NOT EXISTS empleados (
    telefono        VARCHAR PRIMARY KEY,        -- Formato: 5215512345678 (sin +)
    nombre          TEXT    NOT NULL,
    numero_empleado VARCHAR UNIQUE NOT NULL,
    activo          BOOLEAN DEFAULT true,
    creado_en       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Menús diarios (3 opciones fijas + 3 variables)
CREATE TABLE IF NOT EXISTS menus (
    fecha     DATE PRIMARY KEY,                 -- YYYY-MM-DD. Una fila por día.
    fija_a    TEXT NOT NULL,
    fija_b    TEXT NOT NULL,
    fija_c    TEXT NOT NULL,
    var_1     TEXT NOT NULL,
    var_2     TEXT NOT NULL,
    var_3     TEXT NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pedidos (un registro por empleado por día)
CREATE TABLE IF NOT EXISTS pedidos (
    id                BIGSERIAL PRIMARY KEY,
    fecha_menu        DATE    NOT NULL REFERENCES menus(fecha) ON DELETE CASCADE,
    empleado_telefono VARCHAR NOT NULL REFERENCES empleados(telefono) ON DELETE CASCADE,
    opcion_id         VARCHAR NOT NULL,          -- fija_a|fija_b|fija_c|var_1|var_2|var_3
    opcion_texto      TEXT    NOT NULL,          -- nombre del platillo (respaldo histórico)
    zona              VARCHAR,                   -- zona_vdc | zona_refris
    turno             VARCHAR,                   -- turno_a | turno_b
    creado_en         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unico_pedido_por_dia UNIQUE (fecha_menu, empleado_telefono)
);

-- Si la tabla ya existía sin estas columnas, ejecutar:
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS zona  VARCHAR;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS turno VARCHAR;

-- Envíos del menú (registro de a quién se le mandó y su estado)
CREATE TABLE IF NOT EXISTS envios (
    id             BIGSERIAL PRIMARY KEY,
    fecha_menu     DATE    NOT NULL,
    telefono       VARCHAR NOT NULL,
    nombre         TEXT,
    estado         VARCHAR NOT NULL,             -- enviado|fallido|delivered|read|...
    message_id     VARCHAR,                      -- wamid de WhatsApp
    error          TEXT,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unico_envio_por_dia UNIQUE (fecha_menu, telefono)
);
CREATE INDEX IF NOT EXISTS idx_envios_msgid ON envios (message_id);

-- Índices para acelerar consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos (fecha_menu);
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados (activo);

-- ====================================================================
-- DATOS DE PRUEBA (opcional — descomenta para insertar)
-- ====================================================================
-- INSERT INTO empleados (telefono, nombre, numero_empleado) VALUES
--   ('5215512345678', 'Empleado de Prueba', 'EMP001');
--
-- INSERT INTO menus (fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3) VALUES
--   (CURRENT_DATE + 1,
--    'Pechuga a la plancha con arroz',
--    'Ensalada César con pollo',
--    'Bajo en calorías: verduras al vapor',
--    'Enchiladas verdes',
--    'Milanesa de res',
--    'Caldo de pollo');
