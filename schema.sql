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
    -- Asignación que entrega RRHH. Sirve de valor por defecto al pedir:
    -- el empleado puede cubrir otro turno sin que esto cambie.
    zona_default    VARCHAR,                   -- zona_vdc | zona_refris
    turno_default   VARCHAR,                   -- turno_a | turno_b
    creado_en       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Si la tabla ya existía sin estas columnas, ejecutar:
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS zona_default  VARCHAR;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS turno_default VARCHAR;
CREATE INDEX IF NOT EXISTS idx_empleados_numero ON empleados (numero_empleado);

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

-- El teléfono es la llave primaria del empleado y a veces hay que corregirlo
-- (dedo al capturar, cambio de número). Con ON UPDATE CASCADE los pedidos
-- siguen al empleado solos y se conserva su historial; sin esto la única
-- salida sería borrarlo y recrearlo, y el ON DELETE CASCADE se llevaría todos
-- sus pedidos. Idempotente: se puede volver a correr sin romper nada.
DO $$
DECLARE nombre_fk TEXT;
BEGIN
  FOR nombre_fk IN
    SELECT DISTINCT con.conname
      FROM pg_constraint con
      JOIN pg_attribute  att ON att.attrelid = con.conrelid
                            AND att.attnum   = ANY (con.conkey)
     WHERE con.conrelid = 'pedidos'::regclass
       AND con.contype  = 'f'
       AND att.attname  = 'empleado_telefono'
  LOOP
    EXECUTE format('ALTER TABLE pedidos DROP CONSTRAINT %I', nombre_fk);
  END LOOP;

  ALTER TABLE pedidos
    ADD CONSTRAINT pedidos_empleado_telefono_fkey
    FOREIGN KEY (empleado_telefono) REFERENCES empleados(telefono)
    ON DELETE CASCADE ON UPDATE CASCADE;
END $$;

-- Confirmación de entrega (se escanea el QR de la etiqueta al entregar).
-- entregado_en guarda la hora REAL del escaneo, no la de sincronización:
-- el reparto ocurre sin señal y los datos suben después.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_pedidos_entrega ON pedidos (fecha_menu, entregado_en);

-- Motivo que elige el chofer cuando la entrega sale tardía (solo entonces).
-- Se guarda el id del catálogo MOTIVOS_TARDIA de services/menu.js.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_tardia VARCHAR;

-- Calificación del platillo. La captura el empleado en la página de pedidos
-- cuando vuelve y su pedido anterior ya fue entregado: si | tal_vez | no
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS rating VARCHAR;

-- ════════════════════════════════════════════════════════════════════
-- EVIDENCIA DE ENTREGA
--
-- El contrato descuenta el 30% del costo de los box lunch "entregados de
-- forma extemporánea", y castiga aparte la cantidad no entregada. Las
-- columnas de aquí abajo existen para poder sostener las dos cosas con algo
-- más que la palabra del repartidor.
-- ════════════════════════════════════════════════════════════════════

-- Dónde se escaneó cada entrega. Es lo que rebate "lo escanearon en ruta":
-- veinte escaneos en un racimo de metros son un reparto en sitio; un rastro
-- que avanza por la carretera es otra cosa muy distinta.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_lat         DOUBLE PRECISION;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_lon         DOUBLE PRECISION;
-- Precisión del fix en metros. Se guarda porque una coordenada de ±1500 m
-- parece evidencia y no prueba nada: sin este dato no hay forma de saberlo.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_precision_m REAL;

-- A quién se le entregó. Sin esto, la comida que el empleado no recogió se
-- registraba como NO ENTREGADA — evidencia en contra del proveedor por algo
-- que sí cocinó y sí llevó. 'empleado' | 'supervisor'
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_a  VARCHAR;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recibido_por TEXT;

-- Hora en que el registro llegó al SERVIDOR. No sustituye a entregado_en,
-- que es el momento real del escaneo y se captura sin señal; la acota. Es el
-- único dato de esta tabla que no viene del reloj del repartidor, así que es
-- lo que responde a "le movieron la hora a la tablet". Si la diferencia
-- saliera negativa, es imposible y delata manipulación.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_recibido_en TIMESTAMP WITH TIME ZONE;

-- Quién abrió la app y consultó el menú de un día, haya pedido o no.
--
-- Sin esto, "no ordenó" tapa dos problemas opuestos: quien miró el menú y no
-- le gustó (problema de cocina) y quien nunca supo que la app existe (problema
-- de difusión). En el arranque del servicio, la segunda es casi siempre la
-- explicación, y no había forma de distinguirlas.
--
-- Se registra al identificarse con el número de empleado. Una fila por persona
-- y fecha de servicio: la primera vez que miró, la última, y cuántas veces.
CREATE TABLE IF NOT EXISTS accesos (
    fecha_menu        DATE    NOT NULL,
    empleado_telefono VARCHAR NOT NULL,
    visto_en          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- la primera
    ultima_vez        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    veces             INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (fecha_menu, empleado_telefono)
);
-- Sin llave foránea a propósito: esta bitácora es de consulta, no de negocio.
-- Un empleado dado de baja no debe llevarse el registro de que sí miraba el
-- menú, y una consulta no puede fallar por integridad referencial.
CREATE INDEX IF NOT EXISTS idx_accesos_fecha ON accesos (fecha_menu);

-- ════════════════════════════════════════════════════════════════════
-- REPARTIDORES
--
-- Antes todos los equipos compartían una sola ENTREGA_KEY, así que una
-- entrega no se podía atribuir a nadie: solo "alguien con la clave". Con dos
-- repartidores trabajando a la vez y una penalización contractual de por
-- medio, eso ya no alcanza.
--
-- La clave la asigna el administrador; el repartidor no crea la suya.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS repartidores (
    id             BIGSERIAL PRIMARY KEY,
    nombre         TEXT    NOT NULL,
    -- NUNCA la clave en claro. Formato scrypt$N$r$p$sal$hash (services/sesion.js),
    -- con los parámetros dentro para poder endurecerlos después sin invalidar
    -- las claves ya entregadas.
    clave_hash     TEXT    NOT NULL,
    -- Zonas autorizadas. Un arreglo y no dos banderas porque mañana puede
    -- haber un tercer comedor y la restricción de abajo lo absorbe sola.
    zonas          TEXT[]  NOT NULL DEFAULT '{}',
    activo         BOOLEAN NOT NULL DEFAULT true,
    -- Se sube al restablecer la clave o desactivar al repartidor: cualquier
    -- token emitido antes deja de valer, sin llevar lista de revocados.
    version_sesion INTEGER NOT NULL DEFAULT 1,
    creado_en      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Solo zonas del catálogo. Sin esto un error de captura deja a alguien con una
-- zona que no existe y sin poder entrar, o peor, entrando a donde no debe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repartidores_zonas_validas') THEN
    ALTER TABLE repartidores ADD CONSTRAINT repartidores_zonas_validas
      CHECK (zonas <@ ARRAY['zona_vdc','zona_refris']::TEXT[]);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_repartidores_activo ON repartidores (activo);

-- Quién confirmó cada entrega. El id sirve para cruzar; el nombre se guarda
-- como fotografía del momento porque un reporte de hace seis meses debe seguir
-- diciendo quién entregó aunque esa persona ya no esté en la plantilla.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_por_id     BIGINT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_por_nombre TEXT;

-- ON DELETE SET NULL y no CASCADE: borrar a un repartidor jamás debe borrar
-- entregas. Se pierde el vínculo, nunca la evidencia.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_entregado_por_fkey') THEN
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_entregado_por_fkey
      FOREIGN KEY (entregado_por_id) REFERENCES repartidores(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pedidos_repartidor ON pedidos (entregado_por_id);

-- Llegada del repartidor al punto de entrega.
--
-- Es el evento que decide la puntualidad, y no el escaneo: repartir 30 box
-- lunch toma diez minutos o más, así que medir comida por comida garantiza
-- que la última siempre salga tarde aunque el vehículo haya llegado a tiempo.
-- El contrato coincide: penaliza "los box lunch entregados de forma
-- extemporánea" en bloque, no por unidad.
CREATE TABLE IF NOT EXISTS llegadas (
    id           BIGSERIAL PRIMARY KEY,
    fecha_menu   DATE    NOT NULL,
    zona         VARCHAR NOT NULL,               -- zona_vdc | zona_refris
    turno        VARCHAR NOT NULL,               -- turno_a | turno_b
    -- Vacío por defecto. El contrato nombra "REFIS 1, 2 y 3": si el reparto
    -- resulta ser tres paradas, cada una se distingue aquí sin migrar nada.
    punto        VARCHAR NOT NULL DEFAULT '',
    llegada_en   TIMESTAMP WITH TIME ZONE NOT NULL,      -- reloj del equipo
    recibido_en  TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- reloj del servidor
    lat          DOUBLE PRECISION,
    lon          DOUBLE PRECISION,
    precision_m  REAL,
    -- La primera llegada es la buena. Reenviar desde la cola no la mueve.
    CONSTRAINT unica_llegada UNIQUE (fecha_menu, zona, turno, punto)
);
CREATE INDEX IF NOT EXISTS idx_llegadas_fecha ON llegadas (fecha_menu, zona);

-- Puntos de entrega del contrato, contra los que se mide la distancia.
--   Patio LZC VDC: Calle Volcán Ajusco s/n, Col. Isla del Cayacal, C.P. 60950
--   REFIS 1, 2 y 3: Calle Bulevar de las Bahías, C.P. 60950
-- Las coordenadas NO se ponen a mano desde un mapa: un pin a ojo se va 20 o
-- 30 metros y ese error entra directo en la cifra que se le presenta al
-- cliente. Se capturan paradas en el sitio, con la misma tablet y la misma
-- precisión con la que después se miden las entregas.
CREATE TABLE IF NOT EXISTS puntos_entrega (
    zona           VARCHAR NOT NULL,
    punto          VARCHAR NOT NULL DEFAULT '',
    nombre         TEXT,
    direccion      TEXT,
    lat            DOUBLE PRECISION,
    lon            DOUBLE PRECISION,
    radio_m        INTEGER DEFAULT 150,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (zona, punto)
);

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
