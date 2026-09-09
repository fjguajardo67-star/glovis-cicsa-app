# Go Lunch — comedor CICSA · Glovis

Sistema de pedidos y entrega para el comedor de Glovis. **Se opera como web app**:
el empleado pide desde el navegador con su número de empleado, y el repartidor
confirma la entrega escaneando el QR de la etiqueta.

Vive en **https://glovis.cicsacomedores.com.mx** (Railway; push a `main` = deploy).

> **WhatsApp está construido pero no en uso.** El webhook y el envío de mensajes
> siguen en el código y funcionan, pero Meta no ha verificado el negocio, así que
> la operación real arranca por web. Cuando la verificación llegue, WhatsApp queda
> como canal adicional sin tener que reescribir nada — el pedido cae en la misma
> tabla por los dos caminos.

## Las páginas

| Página | Para quién |
|---|---|
| `/pedido.html` | El empleado — es la que abre el QR del cartel. La raíz redirige aquí |
| `/cobertura.html` | El supervisor autorizado — solicita coberturas del segundo turno |
| `/admin.html` | El encargado — empleados, menús, pedidos, reportes, comanda |
| `/entrega.html` | El repartidor — escanea y confirma entregas (instalable como app) |
| `/qr.html` | El QR de `pedido.html` para imprimir y pegar |
| `/manual.html` | Manual de operación |
| `/instalar-entrega.html` | Cómo instalar la app de entrega en el teléfono |

## Cómo funciona

**Pedir.** El empleado entra a `/pedido.html`, se identifica con su **número de
empleado** (no con su teléfono) y elige del menú de mañana. Puede cambiarlo las
veces que quiera hasta el **corte de las 20:00 hrs**.

**Cocinar.** A las **20:05** un cron genera la comanda del día siguiente. También
se pueden sacar a mano desde el panel:

- `/comanda/:fecha` — el conteo por platillo para la cocina
- `/etiquetas/:fecha` — una etiqueta por pedido, con QR

**Entregar.** Cada etiqueta lleva un QR que codifica `numero_empleado|fecha`. El
repartidor lo escanea desde `/entrega.html` y la app confirma contra el pedido de
ese día. Las entregas se mandan **en lote**, así que el escáner sigue funcionando
sin señal y sincroniza cuando vuelve.

Si la entrega pasa de la hora del turno más 15 minutos, cuenta como **tardía** y
pide un motivo del catálogo (`acceso_puerto`, `trafico`, `cliente_ausente`,
`cocina`…). Un motivo inventado no se guarda: solo los del catálogo.

Turnos: **turno A 10:00**, **turno B 17:00**.

**Cobertura del segundo turno.** Un supervisor autorizado entra con número de
empleado y clave personal, y antes de las **14:45** arma una solicitud consolidada
para personal que extenderá su jornada. Selecciona una de tres opciones rápidas
por empleado, zona y responsable. Cocina produce hasta las 16:30 y entrega a las
17:00. Las etiquetas usan `EX|uuid|fecha`, por lo que no chocan con un pedido
regular del mismo empleado. El repartidor escanea cada recipiente y confirma una
sola vez quién recibe el folio; si cambia el receptor, escanea su gafete Glovis.

## Base de datos

Postgres en Supabase, proyecto **`glovis-cicsa-app`**
(`fihjgndxgcbstqnyrygv`). Tablas propias:

```
empleados   menus   pedidos   envios
supervisores_cobertura   menus_cobertura
solicitudes_cobertura    solicitudes_cobertura_items
```

⚠ **El proyecto es COMPARTIDO con Grill Express**, que vive en las mismas bases con
sus propias tablas (`platillos`, `pedidos_grill`, `clientes`, `cupos_grill`,
`reservas_grill`). Por eso la tabla de pedidos de allá se llama `pedidos_grill`:
el nombre `pedidos` ya era de aquí. **No tocar sus tablas.**

El SQL vive en `schema.sql` y se pega a mano en el SQL Editor de Supabase.

## Endpoints

Las rutas administrativas exigen `x-admin-key`. Reparto y cobertura usan sesiones
personales firmadas y con scopes separados.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health` | Estado del servicio |
| GET | `/comanda/:fecha` | Comanda de cocina (HTML para imprimir) |
| GET | `/etiquetas/:fecha` | Etiquetas con QR (HTML para imprimir) |

**Pedido — público, sin clave.** Es lo que usa el empleado:

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/pedido/identificar` | Valida el número de empleado |
| GET | `/pedido/estado` | Menú de mañana y pedido actual |
| POST | `/pedido` | Registra o cambia el pedido |
| POST | `/pedido/rating` | Calificación de la comida |

**Entrega — clave propia.** Acepta `ENTREGA_KEY` **o** `ADMIN_KEY`. Van separadas
para poder rotar la del repartidor —si pierde el teléfono o cambia la persona— sin
tocar la de administración:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/entrega/:fecha` | Pedidos del día para el escáner |
| POST | `/api/entrega` | Confirma entregas **en lote** |

**Cobertura — sesión propia del supervisor:**

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/cobertura/login` | Inicia sesión con número y clave personal |
| GET | `/cobertura/estado` | Menú, horario y solicitud de hoy |
| GET | `/cobertura/empleado/:numero` | Confirma un empleado de la plantilla |
| POST/DELETE | `/cobertura/solicitud` | Guarda, modifica o cancela antes del corte |
| GET | `/comanda-cobertura/:fecha` | Comanda especial imprimible |
| GET | `/etiquetas-cobertura/:fecha` | Etiquetas especiales imprimibles |

**Administración — `x-admin-key`:**

| Método | Ruta | Qué hace |
|---|---|---|
| GET/POST | `/api/empleados` | Lista / crea / actualiza |
| PUT | `/api/empleados/:telefono/activo` | Activa o desactiva |
| PUT | `/api/empleados/:telefono/telefono` | Corrige el teléfono |
| DELETE | `/api/empleados/:telefono` | Elimina |
| GET/POST | `/api/menu`, `/api/menu/:fecha` | Consulta y publica menú |
| GET | `/api/menus-proximos` | Menús ya publicados |
| GET | `/api/pedidos/:fecha` · `/api/pedidos?ini=&fin=` | Pedidos por día o rango |
| GET | `/api/resumen-cocina/:fecha` | Conteo por platillo |
| GET | `/api/reportes` · `/api/dashboard/:fecha` | Reportes y tablero |
| POST | `/api/enviar-menu` | Envío masivo por WhatsApp (inactivo hasta Meta) |
| GET/POST | `/api/cobertura/supervisores` | Consulta y autoriza supervisores |
| PUT/POST | `/api/cobertura/supervisores/:id` · `/:id/clave` | Estado, vigencia y clave |
| GET/POST | `/api/cobertura/menu/:fecha` · `/api/cobertura/menu` | Menú especial del día |
| GET | `/api/cobertura/solicitudes/:fecha` | Solicitudes y conteo de cobertura |

## Variables de entorno

En Railway. Las de WhatsApp pueden ir vacías mientras Meta no verifique: la web app
no las necesita.

| Variable | Para qué |
|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | Base de datos (key `service_role`) |
| `ADMIN_KEY` | Panel y rutas `/api/*` |
| `ENTREGA_KEY` | Solo el escáner del repartidor |
| `ENTREGA_SESSION_SECRET` | Firma sesiones personales de reparto |
| `SUPERVISOR_SESSION_SECRET` | Firma sesiones de cobertura; puede heredar temporalmente la de reparto |
| `TZ` | `America/Mexico_City` (default si no se pone) |
| `CRON_COCINA` | Comanda automática de las 20:05 |
| `TELEFONO_COCINA` | A dónde llega la comanda |
| `PORT` | Lo pone Railway |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION` | WhatsApp — inactivas |
| `VERIFY_TOKEN`, `APP_SECRET` | Webhook de Meta — inactivas |

## Parámetros de operación

- **Corte de pedidos:** 20:00 hrs — se pide para el día siguiente
- **Comanda automática:** 20:05 hrs
- **Turnos de entrega:** A 10:00 · B 17:00, con 15 min de tolerancia
- **Cobertura:** solicitud hasta 14:45 · alarma e impresión de comanda al cierre · salida 16:30 · entrega 17:00
- **Zona horaria:** `America/Mexico_City` (Lázaro Cárdenas, Michoacán)
- **Escala actual:** ~125 empleados

## Correr en local

```bash
npm install
cp .env.example .env    # llena SUPABASE_URL, SUPABASE_KEY y ADMIN_KEY
npm start               # http://localhost:3000
```

Sin `.env` el servidor arranca pero cualquier ruta que toque la base falla.

## Cómo se trabaja este repo

**Push a `main` = deploy inmediato a Railway.** Nunca commitear directo a `main`:
rama → PR → merge → verificar en `/health`.

El agente **sí crea y mergea PRs**, pero **solo cuando el dueño lo pide** — nunca
por iniciativa propia. La condición viene del incidente del 23/ago/2026 en
`~/grill-express` (ver su `HANDOFF.md` §3.0): al mergear se desplegó trabajo que
el dueño no había decidido soltar. El punto no es quién puede mergear, es que el
dueño decida **qué sale y cuándo**.

Antes de mergear: revisar qué lleva la rama de verdad y ensayar el merge. Después:
comprobar que `/health` responda desde el dominio, no dar el deploy por hecho.

El SQL nuevo va a `schema.sql` y lo pega el dueño en Supabase. Y como el proyecto
es compartido, jamás tocar las tablas de Grill Express.
