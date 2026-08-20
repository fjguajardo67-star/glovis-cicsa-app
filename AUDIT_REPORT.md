# Auditoría de código — GLOVIS / CICSA Go Lunch

**Fecha de auditoría:** 2026-08-19

**Commit auditado:** `2d24e28` (`main`, igual a `origin/main` al iniciar)

**Alcance:** repositorio completo, aplicación web independiente, PWA de entrega y código WhatsApp inactivo

**Método:** lectura estática completa, trazas de ramas, pruebas locales con datos ficticios, arranque aislado, revisión de dependencias, inspección HTTP de solo lectura y pruebas responsive de producción sin autenticarse ni escribir datos
**Cambios de comportamiento realizados:** ninguno

## Recomendación ejecutiva

**NO-GO**

La aplicación tiene bases correctas —un solo pedido por empleado/fecha, validación de platillo/zona/turno en servidor, confirmación basada en la respuesta guardada y reconciliación correcta de cocina—, pero hoy no es segura para un piloto real. Dos rutas permiten modificación no autorizada de pedidos: los endpoints públicos confían únicamente en un número de empleado enumerable y el webhook acepta mensajes sin firma cuando falta `APP_SECRET`. También hay riesgos altos de fecha equivocada justo a la hora operativa, cambio silencioso de fecha/platillo desde una página abierta, sobrescritura de entregas, pérdida de historial por eliminación y reportes históricos incorrectos.

No se recomienda operar con empleados reales hasta cerrar los P0 de la sección **Fix Order** y ejecutar el plan de regresión propuesto.

## Findings Summary

| ID | Severity | Confidence | Area | Finding | Fix Complexity |
|---|---|---|---|---|---|
| GL-001 | CRITICAL | CONFIRMED | Auth / IDOR | El número de empleado funciona como credencial y permite ver/modificar pedidos y ratings ajenos | Large |
| GL-002 | CRITICAL | CONFIRMED | WhatsApp / Auth | El webhook falla abierto sin `APP_SECRET`; una secuencia forjada puede escribir pedidos | Small |
| GL-003 | HIGH | CONFIRMED | Dates / Admin | Los valores por defecto del panel saltan uno o dos días después de las 18:00 locales | Small |
| GL-004 | HIGH | CONFIRMED | Order integrity | Una página abierta puede guardar otra fecha y otro platillo distintos a los mostrados | Medium |
| GL-005 | HIGH | CONFIRMED | Cutoff | El corte solo mira la hora y reabre diariamente un mismo menú futuro | Medium |
| GL-006 | HIGH | CONFIRMED | Delivery | Repetir una confirmación sobrescribe la hora original de entrega | Small |
| GL-007 | HIGH | CONFIRMED | Delivery | Desactivar al empleado impide confirmar un pedido válido y la PWA descarta la evidencia | Medium |
| GL-008 | HIGH | CONFIRMED | Delivery / Reports | La hora del dispositivo se acepta sin validación y gobierna puntualidad/rutas | Medium |
| GL-009 | HIGH | CONFIRMED | Data retention | Eliminar un empleado borra en cascada pedidos e historial facturable | Medium |
| GL-010 | HIGH | CONFIRMED | Dashboard | “No ordenó” histórico se calcula con la plantilla activa actual | Medium |
| GL-011 | HIGH | CONFIRMED | Kitchen | La automatización solo escribe logs, no entrega la comanda y no cumple el requisito de ~7 AM ni muestra zonas | Medium |
| GL-012 | HIGH | CONFIRMED | XSS | Datos almacenados se insertan sin escape en el panel administrador | Medium |
| GL-013 | HIGH | CONFIRMED | Menu integrity | Editar un menú con pedidos existentes produce opciones con textos viejos y nuevos sin aviso | Medium |
| GL-014 | MEDIUM | CONFIRMED | Admin auth | Clave compartida sin rate limit/sesión y expuesta en URL de impresos | Medium |
| GL-015 | MEDIUM | CONFIRMED | Delivery UX | Una clave de reparto incorrecta queda persistida sin salida ni botón para reemplazarla | Small |
| GL-016 | MEDIUM | CONFIRMED | QR | El QR es predecible, no firmado e incluye número de empleado | Medium |
| GL-017 | MEDIUM | CONFIRMED | Validation / DB | Fechas, tipos, tamaños, enums y ratings carecen de validación uniforme y constraints | Medium |
| GL-018 | MEDIUM | CONFIRMED | Reports | Entregas sin turno válido se cuentan “a tiempo” y una zona horaria está hard-coded | Small |
| GL-019 | MEDIUM | CONFIRMED | Runtime / Health | No hay validación de entorno al arrancar y `/health` no comprueba la base | Small |
| GL-020 | MEDIUM | HIGH CONFIDENCE | DB operations | SQL manual, sin migraciones/rollback/auditoría, en proyecto Supabase compartido | Medium |
| GL-021 | MEDIUM | CONFIRMED | Tests | No existen pruebas, lint, typecheck ni smoke test automatizado | Medium |
| GL-022 | MEDIUM | HIGH CONFIDENCE | PWA / Network | Actualización de caché manual, CDNs críticos y éxito local antes de confirmación autoritativa | Medium |
| GL-023 | MEDIUM | CONFIRMED | Documentation | Manual/README afirman comportamientos que el código no implementa | Small |
| GL-024 | MEDIUM | CONFIRMED | UI / A11y | Controles sin label/aria-live y overflow móvil en QR/manual | Small |
| GL-025 | MEDIUM | CONFIRMED | Privacy / Model | El teléfono es PK permanente aunque la web se identifica por número de empleado | Large |
| GL-026 | MEDIUM | CONFIRMED | WhatsApp readiness | Sesiones/deduplicación en memoria y respuesta 200 antes de persistir pueden perder mensajes | Medium |
| GL-027 | LOW | CONFIRMED | Dependencies | `npm audit` reporta una vulnerabilidad DoS baja en `body-parser` transitivo | Small |
| GL-028 | LOW | CONFIRMED | Performance | Librerías CDN bloqueantes y recursos gráficos grandes elevan carga y dependencia externa | Small |
| GL-029 | LOW | CONFIRMED | Dead code | Dos PNG sin referencias ocupan ~2.4 MiB; hay configuración/documentación huérfana | Small |

## Evidencia y comandos ejecutados

- `git status --short --branch`, `git remote -v`, `git log -5`: rama `main`, limpia al inicio, sincronizada con `origin/main`.
- `node --check` sobre todos los módulos JS y service worker: sin errores.
- Parseo de JSON y scripts inline de las seis páginas: correcto.
- `npm ci --ignore-scripts` en `/tmp/glovis-audit.c6VhNx`: 79 paquetes instalados correctamente, 1 vulnerabilidad baja.
- `npm audit --omit=dev`: 1 vulnerabilidad baja en `body-parser <1.20.6`.
- `npm outdated`: Supabase 2.108.1→2.112.3; Express 4.22.2→5.2.1 mayor; dotenv 16.6.1→17.4.2 mayor. No se actualizó nada.
- Arranque aislado con Supabase ficticio y cron apagado: servidor escuchó correctamente; sin `SUPABASE_KEY` el proceso abortó antes de escuchar.
- Fixture ficticio `AUD001`–`AUD003`: repetición de pedido dejó una sola fila y la segunda selección reemplazó la primera.
- Fixture de cocina: casos 0, 1, todos iguales y mixtos reconciliaron `pedidos = suma de porciones`.
- Reloj controlado: 19:59:59 abierto; 20:00:00 cerrado; al día siguiente 08:00 vuelve a abrir.
- Producción, solo lectura: raíz `302 /pedido.html`, `/health` respondió OK; no se enviaron formularios ni claves.
- Browser responsive: 320×568, 375×667, 390×844, 430×932, 768×1024 y 1440×900 según página.
- Detector Impeccable: 5 avisos estáticos; `broken-image` fue falso positivo sobre un selector CSS y los cuatro restantes son tratamientos visuales intencionales, no defectos operativos.

## Arquitectura actual

```text
Empleado (navegador/PWA)
  -> public/pedido.html
  -> /pedido/* (sin autenticación)
  -> services/pedidos.js (reglas compartidas)
  -> services/supabase.js
  -> Supabase Postgres (service_role)

Administrador
  -> public/admin.html
  -> /api/* [x-admin-key]
  -> admin.js / cocina.js / whatsapp.js
  -> Supabase + Meta Cloud API (cuando se usa)

Repartidor
  -> public/entrega.html + service worker
  -> localStorage (lista, cola, clave, modo lector)
  -> /api/entrega/* [ENTREGA_KEY o ADMIN_KEY]
  -> pedidos.entregado_en / motivo_tardia

Meta WhatsApp (ruta desplegada, canal declarado inactivo)
  -> /webhook
  -> sesión y deduplicación en memoria
  -> services/pedidos.js / services/whatsapp.js

Railway
  -> Express 4, páginas estáticas y API en un proceso
  -> cron interno setInterval

CDNs
  -> SheetJS (admin), jsQR (entrega), qrcodejs (QR/etiquetas)
```

### Modelo de ejecución

- **Framework/backend:** Node.js ESM + Express 4.
- **Rendering:** HTML/CSS/JavaScript sin framework; vistas del servidor para comanda/etiquetas.
- **Routing:** Express; estáticos en `/`; pedido público en `/pedido`; administración en `/api`; entrega en `/api/entrega`; Meta en `/webhook`.
- **Estado cliente:** variables de módulo; entrega persiste clave, lista y cola en `localStorage`.
- **Persistencia:** PostgreSQL vía Supabase JS con service-role en servidor.
- **Autenticación:** número de empleado para cliente; secreto compartido `ADMIN_KEY`; secreto compartido `ENTREGA_KEY`; HMAC opcional para Meta.
- **Sesiones:** no existen para cliente/admin; WhatsApp usa `Map` en memoria con TTL 10 min.
- **PWA:** dos manifests y un service worker compartido; navegación network-first, assets cache-first, APIs no cacheadas.
- **Hosting:** Railway; `push main = deploy` según README. No hay configuración de Railway versionada.
- **Roles:** empleado, administrador, repartidor; la ADMIN_KEY también abre reparto e impresos.

## Repository Inventory

| Archivo/grupo | Clasificación | Rol / evidencia |
|---|---|---|
| `index.js` | ACTIVE | Entry point Express, rutas, estáticos, impresos y cron |
| `routes/pedido.js` | ACTIVE | API pública de identificación, pedido y rating |
| `routes/admin.js` | ACTIVE | Administración, dashboard, reportes y envío masivo |
| `routes/entrega.js` | ACTIVE | Descarga y sincronización de reparto |
| `routes/webhook.js` | LEGACY-ACTIVE | Ruta desplegada, canal declarado inactivo; futura Meta |
| `services/pedidos.js` | ACTIVE | Regla canónica de pedido compartida web/WhatsApp |
| `services/menu.js` | ACTIVE | Catálogos, fechas, corte y puntualidad |
| `services/supabase.js` | ACTIVE | Acceso a todas las tablas |
| `services/cocina.js` | ACTIVE | Resumen, impresos y cron |
| `services/telefono.js` | ACTIVE | Normalización mexicana |
| `services/whatsapp.js` | LEGACY-ACTIVE | Cliente Meta listo pero inactivo operacionalmente |
| `public/pedido.html` | ACTIVE | Flujo empleado |
| `public/admin.html` | ACTIVE | Panel y exportación Excel |
| `public/entrega.html` | ACTIVE | PWA offline-first de reparto |
| `public/qr.html` | SUPPORTING | Cartel/tarjetas QR de acceso |
| `public/manual.html` | SUPPORTING | Manual servido por la app |
| `public/instalar-entrega.html` | SUPPORTING | Hoja de instalación del repartidor |
| `public/sw.js` | ACTIVE | Cache y arranque offline |
| `public/app-*.webmanifest` | ACTIVE | Instalación pedido/entrega |
| favicon, iconos, `glovis-logo.png`, `golunch-{compacto,gate,lateral,mark}.png` | ACTIVE | Referencias confirmadas por HTML/manifests/SW |
| `public/golunch-logo.png`, `public/golunch.png` | DEAD | Cero referencias; 1.148 + 1.260 KiB |
| `schema.sql` | SUPPORTING | Esquema/migración manual acumulativa |
| `package.json` | ACTIVE | Runtime y único script `start` |
| `package-lock.json` | GENERATED | Lockfile v3 válido |
| `README.md` | SUPPORTING | Operación/deploy; contiene drift documentado |
| `.gitignore` | SUPPORTING | Excluye `.env` y `node_modules` |
| `CNAME` | UNKNOWN/LEGACY | Railway usa DNS externo; confirmar si GitHub Pages sigue habilitado |
| Tests/config lint/type/build | ABSENT | No existen |

## API Inventory

| Método y ruta | Auth/Authz | Entrada | Respuesta / efecto | Idempotencia y errores |
|---|---|---|---|---|
| GET `/` | Pública | — | 302 a `/pedido.html` | Idempotente |
| GET `/health` | Pública | — | estado y timestamp | No comprueba DB |
| GET `/debug` | ADMIN_KEY | header | flags y preview de URL | 401; diagnóstico |
| GET `/test-supabase` | ADMIN_KEY | header | prueba DB/fechas | Devuelve `ok:false` con detalle |
| GET `/webhook` | `VERIFY_TOKEN` | query Meta | challenge | 403 si no coincide |
| POST `/webhook` | HMAC solo si APP_SECRET existe | payload Meta | 200 inmediato; procesa estados/pedidos | Falla abierto; dedup memoria |
| GET `/pedido/estado` | Pública | — | fecha, menú, corte | 500 genérico |
| POST `/pedido/identificar` | Pública; número es identidad | `{numero_empleado}` | perfil, pedido actual, rating pendiente | Enumerable; 400/404/500 |
| POST `/pedido` | Pública; número es identidad | empleado, opción, zona, turno | upsert y confirmación | Idempotente por clave DB, pero takeover posible |
| POST `/pedido/rating` | Pública; número es identidad | empleado, fecha, rating | actualiza rating entregado | Repetible/sobrescribe |
| GET `/api/entrega/:fecha` | ENTREGA_KEY o ADMIN_KEY | fecha path | PII y lista completa | Fecha no validada; errores DB expuestos |
| POST `/api/entrega` | ENTREGA_KEY o ADMIN_KEY | fecha + lote | actualiza entregas | No idempotente; error por elemento expone detalle |
| GET `/api/empleados` | ADMIN_KEY | — | plantilla completa | Idempotente |
| POST `/api/empleados` | ADMIN_KEY | registro | upsert por teléfono | Parcialmente validado; 500 DB crudo |
| PUT `/api/empleados/:tel/activo` | ADMIN_KEY | `{activo}` | activa/desactiva | `!!"false"` activa |
| PUT `/api/empleados/:tel/telefono` | ADMIN_KEY | teléfono nuevo | mueve PK/pedidos/envíos | empleado+pedidos atómicos; envíos parcial |
| DELETE `/api/empleados/:tel` | ADMIN_KEY | path | hard delete | Repetible, pero destructivo/cascade |
| GET `/api/menu/:fecha` | ADMIN_KEY | fecha path | menú | Fecha no validada |
| POST `/api/menu` | ADMIN_KEY | fecha + 6 textos | upsert menú | Repetible; sobrescribe sin versión |
| GET `/api/menus-proximos` | ADMIN_KEY | — | 7 fechas | Idempotente |
| GET `/api/pedidos/:fecha` | ADMIN_KEY | fecha | pedidos + empleados | Fecha no validada |
| GET `/api/pedidos?ini&fin` | ADMIN_KEY | rango | pedidos | Rango no validado/limitado |
| GET `/api/resumen-cocina/:fecha` | ADMIN_KEY | fecha | conteos | Idempotente |
| GET `/api/reportes?ini&fin` | ADMIN_KEY | rango | agregados | Rango no validado/limitado |
| GET `/api/dashboard/:fecha` | ADMIN_KEY | fecha | plantilla/estados | Históricamente incorrecto |
| POST `/api/enviar-menu` | ADMIN_KEY | — | mensajes + bitácora | No idempotency key; botón activo |
| GET `/comanda/:fecha?key=` | ADMIN_KEY en URL | fecha | HTML imprimible | Idempotente; secreto en URL |
| GET `/etiquetas/:fecha?key=` | ADMIN_KEY en URL | fecha/tamaño/modo | HTML/QR | Idempotente; secreto en URL |

Los errores no tienen un esquema uniforme: unas rutas devuelven mensajes genéricos, otras `err.message`, otras 200 con `ok:false`, y el lote de entrega incluye `detalle` interno.

## Source of Truth

| Dominio | Fuente autoritativa | ¿Cliente puede sobreescribir? | Notas |
|---|---|---:|---|
| Empleado | `empleados` | No directamente; sí presenta número | Teléfono es PK; número es unique |
| Identidad web | `numero_empleado` presentado por cliente | **Sí** | No existe segundo factor/sesión |
| Menú | `menus` | Admin | Una fila por fecha; sin versión |
| Fecha de servicio | primera `menus.fecha >= mañana` | No, pero cliente no fija expectativa | Se recalcula en cada submit |
| Ventana de pedido | reloj del servidor + `hour < 20` | No | No incorpora fecha de servicio |
| Pedido | `pedidos`, unique fecha+teléfono | Sí, antes del corte | Upsert reemplaza misma fila |
| Texto histórico de platillo | `pedidos.opcion_texto` | Indirecto por opción | Snapshot correcto, pero diverge al editar menú |
| Zona/turno | valores guardados en pedido | Sí, por pedido | Catálogo solo en código; sin CHECK DB |
| Entrega | `pedidos.entregado_en` | **Sí, dispositivo la propone** | El servidor no preserva primera confirmación |
| Rating | `pedidos.rating` | Sí | Identificado solo por número y sobrescribible |
| Dashboard histórico | pedidos + empleados activos actuales | No | Población histórica incorrecta |
| Cola offline | `localStorage` del dispositivo | Sí/local | Autoritativa temporal hasta sync |

## Data Flow Trace

### Flow A — New Order

`pedido.html` carga `/pedido/estado` → usuario presenta número → `/pedido/identificar` obtiene empleado y pedido → selección en memoria → POST `/pedido` → `crearPedido` vuelve a identificar, revisa hora, vuelve a calcular fecha/menú, valida opción/zona/turno → `upsertPedido` → Postgres unique → respuesta guardada → recibo se pinta desde la respuesta.

Punto débil: el POST no incluye fecha/versión que vio la UI; por eso puede cambiar de fecha/platillo.

### Flow B — Edit Existing Order

Identificación descarga todos los pedidos de la fecha y busca por teléfono → precarga opción/zona/turno → mismo POST `/pedido` → mismo `upsert` con conflicto `(fecha_menu, empleado_telefono)` → reemplaza la fila. No crea segunda producción. El corte se revisa en servidor, pero no está ligado a la fecha.

### Flow C — Kitchen Production

`pedidos` por fecha → `resumenCocina` cuenta cada fila una vez por texto/turno/zona → comanda reagrupa por turno → HTML. Las zonas calculadas no se imprimen. Cron llama el resumen y solo lo escribe en logs.

### Flow D — Delivery Confirmation

Etiqueta QR `numero_empleado|fecha` → PWA valida fecha contra lista local → marca `entregado_en` con reloj cliente y muestra éxito → persiste cola → POST por lote → servidor busca **empleado activo** → UPDATE por fecha+teléfono → elimina cola si confirmó o si el rechazo se considera definitivo.

### Flow E — Dashboard Metrics

- `ordenaron`: filas de empleados activos actuales cuyo teléfono normalizado tiene pedido.
- `no_ordenaron`: empleados activos actuales sin pedido, no población elegible histórica.
- `entregados/tardías`: `entregado_en` comparado con turno + 15 min.
- Reporte por periodo: pedidos crudos del rango, agregado en memoria; “pendiente” es subconjunto de no entregados.

## Business Rule Matrix

| Regla | Implementada en | Probada | Server-enforced | Riesgo |
|---|---|---:|---:|---|
| Corte 8 PM | `menu.js:80-84`, `pedidos.js:76-79` | Sí, límites exactos | Sí | No usa fecha de servicio |
| Platillo requerido/válido | `pedido.js:98-100`, `pedidos.js:88-90` | Trazado | Sí | DB sin CHECK |
| Turno requerido/válido | `pedidos.js:92-100` | Trazado | Sí | Default RRHH permitido |
| Zona requerida/válida | `pedidos.js:92-100` | Trazado | Sí | Default RRHH permitido |
| Un pedido diario | `schema.sql:46`, `supabase.js:274-288` | Sí, repetición/edición | Sí + DB | Correcto |
| Editar solo abierto | `pedidos.js:76-79` | Sí | Sí | Ventana reabre diariamente |
| Fecha de servicio | `pedidos.js:30-32` | Sí | Sí | Cliente no manda expectativa |
| QR con fecha | `cocina.js:167-183`, `entrega.html:439-449` | Trazado | Parcial | Servidor recibe campos, no QR firmado |
| Una entrega inmutable | — | Sí | **No** | Sobrescribe timestamp |
| Rating entregado | `supabase.js:327-336` | Trazado | Sí | Identidad y sobrescritura débiles |
| Historial al desactivar | FK + joins | Trazado | Parcial | Dashboard omite inactivos |
| Cocina = pedidos válidos | `cocina.js:11-39` | Sí, 4 datasets | Sí | Reconciliación correcta |

### Truth table real del pedido

| Hora servidor | Pedido previo | Acción | Comportamiento real |
|---|---:|---|---|
| <20:00 | No | enviar | crea fila |
| <20:00 | Sí | enviar/cambiar | actualiza la misma fila |
| >=20:00 | No | enviar | 409 fuera de horario |
| >=20:00 | Sí | editar | 409 fuera de horario |
| Día siguiente <20:00 | Sí para un menú futuro aún seleccionado | editar | vuelve a aceptar; la ventana reabrió |
| UI vieja, fecha actual cambió | cualquiera | enviar | guarda el menú/fecha actuales del servidor |

## State and invariant audit

### Estados reales

```text
SIN_PEDIDO -> PEDIDO
PEDIDO -> PEDIDO_EDITADO (misma fila)
PEDIDO -> ENTREGADO (entregado_en != null)
ENTREGADO -> ENTREGADO (timestamp sobrescribible)
ENTREGADO -> CALIFICADO
CALIFICADO -> CALIFICADO (rating sobrescribible)
```

No existen `PREPARADO`, `EN_RUTA`, `CANCELADO` ni audit events. Offline existe un estado cliente adicional `EN_COLA`, no persistido en servidor.

| Invariante | UI | Servidor | DB | Tests actuales |
|---|---:|---:|---:|---:|
| Un pedido no representa dos empleados | parcial | sí | FK/unique | no |
| Fecha referencia menú existente | — | sí | FK | no |
| Platillo válido | sí | sí | no CHECK | no |
| Turno/zona válidos | sí | sí | no CHECK | no |
| Entrega corresponde a pedido | lista local | sí | UPDATE filtrado | no |
| Primera entrega es inmutable | local evita doble | no | no | no |
| Cocina cuenta cada pedido una vez | — | sí | unique | no |
| Edición no duplica producción | botón | sí | unique | no |
| Periodo cerrado rechaza cambios | sí | sí por hora | no | no |
| Historial sobrevive baja | — | solo desactivar | `ON DELETE CASCADE` lo rompe | no |

## Detailed Findings

### GL-001 — El número de empleado permite suplantación y modificación de pedidos

- **Severity / Confidence / Status:** CRITICAL / CONFIRMED / OPEN
- **Affected files/functions/lines:** `routes/pedido.js:29-67,76-87,96-113`; `services/supabase.js:29-38`; `public/pedido.html:313-317,480-488`.
- **Description:** cualquier persona que conozca o adivine un número de empleado puede obtener nombre, asignación, pedido actual y comida pendiente de rating; también puede reemplazar pedido y rating.
- **Why it matters:** es IDOR/broken authentication sobre órdenes reales y datos laborales.
- **Evidence:** las tres escrituras públicas reciben `numero_empleado`; `getEmpleadoPorNumero` solo comprueba existencia/activo. No hay contraseña, token, cookie, challenge, rate limit ni sesión. La respuesta distingue 404 y éxito, facilitando enumeración.
- **Reproduction:** con datos ficticios, POST `/pedido/identificar` con `AUD001`; reutilizar el número en POST `/pedido` o `/pedido/rating`. No se solicita otra prueba de identidad.
- **Expected / Actual:** esperado: solo el titular modifica su orden. Actual: el número presentado actúa como bearer credential.
- **Business impact:** pedidos cambiados, comida equivocada, ratings falsos y exposición de nombre/rutina.
- **Recommended fix:** crear una autenticación de bajo roce pero verificable (PIN individual inicial/rotado, enlace/QR personal firmado o login corporativo). Emitir sesión corta HttpOnly/SameSite; verificar ownership server-side; rate limit y respuestas no enumerables.
- **Complexity / Behavior change / Tests:** Large / Yes / Yes (ownership, enumeración, expiración, dos dispositivos, recuperación).

### GL-002 — Webhook sin APP_SECRET acepta solicitudes no firmadas

- **Severity / Confidence / Status:** CRITICAL / CONFIRMED / OPEN
- **Affected:** `routes/webhook.js:51-70,89-126,159-184`; `index.js:91-92`.
- **Description:** `firmaValida` retorna `true` si falta `APP_SECRET`. La ruta sigue montada aunque WhatsApp esté “inactivo”.
- **Why:** una secuencia forjada de platillo→zona→turno puede llegar a `pedidos.crearPedido` y escribir en la misma tabla de producción.
- **Evidence:** branch trace directo. En la copia aislada sin APP_SECRET, un POST sin firma a `/webhook` respondió HTTP 200 y el servidor registró “se omite la validación de firma”. Las sesiones se escriben antes de que falle un envío Meta.
- **Reproduction:** local, APP_SECRET vacío; POST JSON sin `X-Hub-Signature-256` devuelve 200. Con fixture de empleado/teléfono, enviar replies válidos en secuencia.
- **Expected / Actual:** esperado: fail closed/404 mientras Meta está apagado. Actual: acepta y procesa.
- **Impact:** pedidos falsos, cambios no autorizados y abuso del servicio.
- **Fix:** flag `WHATSAPP_ENABLED`; si no es `on`, no montar POST o devolver 503/404. Si está activo, APP_SECRET/VERIFY_TOKEN/token/phone ID obligatorios al arranque y firma obligatoria.
- **Complexity / Behavior / Tests:** Small / Yes / Yes (flag off, secret missing, firma válida/inválida).

### GL-003 — Fechas por defecto del panel usan UTC en la hora crítica

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `public/admin.html:727-731,745-750`; también `public/pedido.html:462-467`.
- **Description:** `toISOString().slice(0,10)` convierte a UTC. En `America/Mexico_City`, después de las 18:00 la fecha UTC ya es el día siguiente.
- **Evidence:** fixture a `2026-08-19 20:05 -06:00`: `campo_hoy=2026-08-20`; tras `setDate(+1)`, `im-fecha=2026-08-21`; esperados 19 y 20.
- **Reproduction:** abrir panel a las 20:05; revisar fecha de pedidos/cocina y fecha de impresos.
- **Expected / Actual:** “hoy” local y “mañana” local / mañana y pasado mañana.
- **Impact:** comanda/etiquetas del día equivocado justo en la rutina posterior al corte; reportes incorrectos.
- **Fix:** helper de fecha local basado en zona del comedor enviada por servidor o construcción local `getFullYear/getMonth/getDate`; nunca serializar date-only vía UTC.
- **Complexity / Behavior / Tests:** Small / Yes / Yes (17:59,18:00,20:05, medianoche, timezone distinta).

### GL-004 — Submit con estado viejo cambia fecha y platillo

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `public/pedido.html:415-417,424-469,603-629`; `services/pedidos.js:81-109`.
- **Description:** la UI conserva fecha/menú cargados, pero envía solo `opcion_id`; el servidor recalcula fecha y menú.
- **Evidence:** prueba ficticia: pantalla mostró `2026-08-20 / Pollo del jueves`; al enviar al día siguiente guardó `2026-08-21 / Pescado del viernes`.
- **Reproduction:** abrir antes de cambio de día/menú, dejar pestaña abierta, enviar después.
- **Expected / Actual:** rechazar estado obsoleto y recargar / guardar la opción homónima del nuevo menú.
- **Impact:** comida y fecha no elegidas; el recibo correcto no elimina el error operativo ya cometido.
- **Fix:** enviar `fecha_esperada` y una versión/hash de menú; validar ambos antes del upsert y responder 409 `estado_desactualizado`.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (overnight, admin edit, PWA vieja, respuesta perdida).

### GL-005 — El corte no pertenece a una fecha de servicio

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN (política de fin de semana requiere confirmación del dueño)
- **Affected:** `services/menu.js:80-84`; `services/pedidos.js:24-32,76-85`; `services/cocina.js:332-339`.
- **Description:** cualquier menú futuro está abierto cada día antes de las 20:00, cerrado después y reabierto a la mañana siguiente.
- **Evidence:** reloj: 19:59:59 true, 20:00 false, día siguiente 08:00 true. `fechaServicio` busca cualquier fecha `>= mañana` sin calcular su corte previo.
- **Reproduction:** publicar solo menú de lunes; observar viernes 20:01 cerrado, sábado 08:00 abierto, sábado 20:01 cerrado, domingo 08:00 abierto.
- **Expected / Actual:** una ventana continua y un único corte relacionado con `service_date` / cierres diarios repetidos.
- **Impact:** mensaje falso “cocina ya recibió”, reapertura de órdenes consideradas cerradas y política ambigua de fin de semana/festivo.
- **Fix:** función canónica `cutoffFor(serviceDate)` y comparación de instante; decidir regla no laborable explícita. El cron debe usar el mismo corte.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (finde, festivo, menú lejano, DST/zonas).

### GL-006 — Confirmación duplicada sobrescribe la primera hora

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `services/supabase.js:303-323`; `routes/entrega.js:67-86`.
- **Description:** cada llamada hace UPDATE incondicional de `entregado_en`.
- **Evidence:** fixture: primera 10:00 y segunda 10:40 retornaron `ok:true`; timestamp final 10:40 y dos PATCH.
- **Reproduction:** mismo empleado/fecha desde dos dispositivos o reintento después de respuesta perdida.
- **Expected / Actual:** segunda operación responde `already_delivered` y preserva 10:00 / reemplaza por 10:40.
- **Impact:** cambia puntualidad, motivo, duración de ruta y evidencia de entrega.
- **Fix:** update condicional `entregado_en IS NULL`, retorno explícito del estado existente; opcional idempotency key por escaneo.
- **Complexity / Behavior / Tests:** Small / Yes / Yes (duplicado secuencial y concurrente).

### GL-007 — La baja del empleado invalida una entrega ya ordenada

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `services/supabase.js:29-38,305-307`; `public/entrega.html:370-379`.
- **Description:** entrega resuelve número mediante consulta `activo=true`; si se dio de baja tras pedir, devuelve `empleado_no_encontrado`. La PWA clasifica ese rechazo como definitivo y borra la cola.
- **Evidence:** fixture: pedido válido + empleado inactivo → `{ok:false,motivo:'empleado_no_encontrado'}` sin UPDATE.
- **Reproduction:** crear pedido, desactivar empleado, escanear su etiqueta.
- **Expected / Actual:** entregar el pedido existente o registrar excepción / evidencia descartada definitivamente.
- **Impact:** comida entregada físicamente sin registro, merma falsa y pérdida de trazabilidad.
- **Fix:** resolver directamente pedido por `(fecha, numero_empleado snapshot/relación)` sin exigir activo; no descartar rechazos recuperables; distinguir “empleado inexistente” de “inactivo con pedido”.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-008 — Reloj cliente no confiable controla reportes

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `public/entrega.html:455-460,480-493`; `routes/entrega.js:74`; `services/supabase.js:309-319`.
- **Description:** la PWA genera ISO con reloj del dispositivo; el servidor acepta cualquier timestamp válido sin rango, monotonicidad ni relación con fecha.
- **Why:** offline requiere conservar hora de captura, pero no debe ser la única evidencia no validada.
- **Reproduction:** dispositivo con hora/zona incorrecta o request directo con timestamp pasado/futuro.
- **Expected / Actual:** conservar hora cliente con controles y hora de recepción / dato cliente autoritativo.
- **Impact:** fraude o error en puntualidad, ruta y merma; timestamps fuera de día.
- **Fix:** guardar `capturado_en_cliente`, `recibido_en_servidor`, device/session ID y desviación; validar rango y fecha; usar zona del servicio al evaluar.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-009 — Hard delete destruye historia de pedidos

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `schema.sql:39-46`; `routes/admin.js:79-85`; `public/admin.html:1460-1463`.
- **Description:** FK `pedidos.empleado_telefono` usa `ON DELETE CASCADE`; el botón DELETE es accesible con confirmación.
- **Reproduction:** en base de prueba, borrar empleado con pedidos; las filas se eliminan por FK.
- **Expected / Actual:** baja/anonimización preservando hechos facturables / pérdida irreversible desde la app.
- **Impact:** facturación, auditoría, ratings, cocina y entrega históricos incompletos.
- **Fix:** retirar hard delete operativo o bloquear si hay historia; soft delete; FK hacia ID interno estable y snapshots; procedimiento excepcional auditado.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-010 — Dashboard histórico usa empleados activos hoy

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `routes/admin.js:375-420`; `services/supabase.js:49-57,291-300`.
- **Description:** para cualquier fecha, población = `listEmpleadosActivos()` en el presente.
- **Evidence:** branch trace: empleado desactivado con pedido desaparece; alta posterior aparece como “no ordenó” antes de existir. Dashboard no reconcilia con pedidos crudos.
- **Expected / Actual:** población elegible a la fecha / roster actual.
- **Impact:** supervisión y decisiones de participación incorrectas.
- **Fix:** historial de vigencia/eligibilidad o snapshots diarios; al menos separar “pedidos existentes fuera del roster actual” y no ofrecer “no ordenó histórico” sin población válida.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-011 — Comanda automática no llega a cocina y omite zonas

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `services/cocina.js:11-39,45-76,313-354`; `README.md:32-36,119-129`.
- **Description:** cron de proceso a 20:05 solo hace `console.log`; requisito auditado indica comando completo ~7 AM. La comanda calcula `por_zona` pero no lo renderiza.
- **Evidence:** prueba con zonas mixtas: total 3 y suma 3, pero HTML no contenía VDC/REFRIS. Código tiene TODO para envío, no ejecución.
- **Expected / Actual:** artefacto completo entregado/confirmado a cocina en horario acordado / resumen efímero en logs, dependiente de setInterval Railway.
- **Impact:** cocina puede no recibir producción o distribuir mal por zona.
- **Fix:** confirmar horario; scheduler durable externo, generación idempotente, almacenamiento del artefacto/estado y acuse; incluir zona o emitir packing list separado.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (0/1/muchos, zonas, reinicio, retry).

### GL-012 — Stored XSS en panel administrador

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `public/admin.html:895-914,972-985,1103-1111,1415-1428,1488-1499`; helper disponible `1346-1349` no usado.
- **Description:** nombre, número, platillo, motivo y errores se concatenan en `innerHTML` sin escape.
- **Evidence:** una cadena persistida como `<img src=x onerror=...>` se inserta como markup en las tablas. La importación de Excel sí escapa la previa, pero después guarda el dato y la plantilla activa no lo escapa.
- **Expected / Actual:** datos como texto / ejecución HTML/JS en contexto admin.
- **Impact:** exfiltración de ADMIN_KEY en memoria, acciones administrativas, borrado o manipulación.
- **Fix:** DOM `textContent`/creación de nodos o escape central en toda interpolación; CSP sin inline handlers como defensa adicional; validar tamaños/contenido.
- **Complexity / Behavior / Tests:** Medium / No (salvo mostrar texto literal) / Yes.

### GL-013 — Editar menú divide una misma opción en platillos distintos

- **Severity / Confidence / Status:** HIGH / CONFIRMED / OPEN
- **Affected:** `routes/admin.js:99-109`; `services/supabase.js:254-269,274-288`; `services/pedidos.js:102-109`.
- **Description:** menú se sobrescribe por fecha, pero pedidos existentes conservan `opcion_texto`; pedidos nuevos toman el texto nuevo. No hay bloqueo, confirmación, migración ni versión.
- **Reproduction:** crear pedidos `fija_a=Pollo`; cambiar menú a `fija_a=Pescado`; crear otro pedido. Cocina agrupa Pollo y Pescado aunque ambos son `fija_a`.
- **Expected / Actual:** política explícita (bloquear, propagar transaccionalmente o versionar) / mezcla silenciosa.
- **Impact:** producción y expectativa del empleado inconsistentes.
- **Fix:** impedir cambios con pedidos salvo flujo explícito; mostrar impacto; transacción/versionado y notificación si se autoriza cambio.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (cambio concurrente y posterior al corte).

### GL-014 — Administración usa secreto compartido débilmente gestionado

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `routes/admin.js:13-26`; `index.js:104-150`; `public/admin.html:720-784`.
- **Description:** no hay usuario real, sesión, expiración, rate limit ni auditor; “Usuario” es decorativo. Comanda/etiquetas ponen ADMIN_KEY en query.
- **Evidence:** URL queda en historial/copias/logs; headers de producción no incluyen Referrer-Policy/CSP/HSTS/Permissions-Policy/X-Content-Type-Options.
- **Expected / Actual:** sesión revocable y secreto fuera de URL / clave global con privilegios totales.
- **Impact:** una filtración no permite atribución y exige rotación global.
- **Fix:** sesión admin HttpOnly de corta duración; eliminar campo decorativo; tokens de impresión de uso/TTL o POST; rate limit; Helmet/headers.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-015 — Clave de reparto equivocada no puede reemplazarse desde la PWA

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `public/entrega.html:270-305,394-402`.
- **Description:** clave se guarda antes de validarse, gate se oculta y un 401 dice “Bórrala”, pero no existe botón de logout/borrado.
- **Reproduction:** introducir clave incorrecta; recargar. La app la reutiliza indefinidamente.
- **Expected / Actual:** validar primero o ofrecer “Cambiar clave” / usuario debe borrar datos del sitio manualmente.
- **Impact:** rotación de ENTREGA_KEY puede dejar dispositivos operativos bloqueados en ruta.
- **Fix:** validar antes de persistir; botón visible para reemplazar/olvidar clave sin borrar cola; conservar entregas pendientes durante reautenticación.
- **Complexity / Behavior / Tests:** Small / Yes / Yes.

### GL-016 — QR de entrega no está firmado

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `services/cocina.js:167-183`; `public/entrega.html:439-453`; `routes/entrega.js:60-86`.
- **Description:** payload = número de empleado + fecha, ambos predecibles. No contiene order ID opaco, nonce o firma.
- **Controls actuales:** PWA exige que el número esté en lista y fecha coincida; API exige ENTREGA_KEY.
- **Reproduction:** modificar payload a otro empleado con pedido del mismo día; con dispositivo autorizado se marca ese otro pedido.
- **Expected / Actual:** QR ligado criptográficamente a una orden / identificadores editables.
- **Impact:** confirmación equivocada o deliberada; exposición física de identificador laboral.
- **Fix:** token opaco/firma HMAC con order ID, fecha y versión; validación server-side; mantener fallback manual auditado.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (tamper, replay, fecha, inexistente).

### GL-017 — Validación incompleta en límites de confianza

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `routes/admin.js:38-59,90-109,142-178`; `routes/entrega.js:30-88`; `schema.sql:7-105`.
- **Description:** fechas no se validan en la mayoría de APIs; strings/tamaños no limitados; teléfono y enum de empleado no se validan en alta; `!!activo` convierte `"false"` en true; lote/rango sin límite; DB no tiene CHECK para opción, zona, turno, rating, motivo.
- **Evidence:** `Boolean("false") === true`; constraints solo NOT NULL/UNIQUE/FK.
- **Expected / Actual:** esquema server y constraints DB / coerción y errores crudos.
- **Impact:** datos inválidos, 500 evitables, reportes ambiguos y abuso de recursos.
- **Fix:** validadores de request compartidos; date-only estricto y existente; enums/boolean/tamaños; límites de rango/lote; CHECK constraints.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (matriz de entradas inválidas).

### GL-018 — Reportes clasifican desconocido como puntual

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `routes/admin.js:207-252,255-267`; `services/menu.js:41-55`.
- **Description:** `esEntregaTardia` retorna null si turno/timestamp es inválido; rama `else` lo suma a `entregados`. `hhmm` fija `America/Mexico_City` en vez de TZ configurada.
- **Evidence:** prueba: turno null + entrega 23:00 → null; reporte cae en “a tiempo”.
- **Expected / Actual:** categoría “indeterminado” / “entregado a tiempo”.
- **Impact:** métricas de SLA optimistas y zona horaria inconsistente si cambia deployment.
- **Fix:** tres estados (`on_time`, `late`, `unknown`), validar timestamps y usar una sola TZ.
- **Complexity / Behavior / Tests:** Small / Yes / Yes.

### GL-019 — Configuración y health no son fail-fast/representativos

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `services/supabase.js:5-8`; `index.js:39-89,167-170`; `README.md:133-141`.
- **Description:** Supabase faltante causa excepción en import; otras claves faltantes fallan solo al usar. TZ inválida no se valida. `/health` siempre OK sin consultar DB.
- **Evidence:** arranque sin SUPABASE_KEY terminó con “supabaseKey is required”; contradice README. Con URL ficticia, `/health` seguiría OK.
- **Expected / Actual:** validación explícita y readiness separada / fallos tardíos o health verde falso.
- **Impact:** Railway puede mantener instancia no operativa y ocultar caída de DB.
- **Fix:** validar env al arranque según feature flags; `/health/live` y `/health/ready` con query barata/timeout.
- **Complexity / Behavior / Tests:** Small / Yes / Yes.

### GL-020 — Cambios de base y eventos críticos no son recuperables/auditables

- **Severity / Confidence / Status:** MEDIUM / HIGH CONFIDENCE / OPEN
- **Affected:** `schema.sql`; `services/supabase.js:59-174,254-337`; README `49-64,148-149`.
- **Description:** un SQL acumulativo se pega manualmente en un proyecto compartido; no hay tabla/versiones de migración, rollback, audit log ni `updated_at` de pedido/menú. Cambio de teléfono hace empleado/pedidos y envíos en operaciones separadas.
- **Why:** no se puede demostrar quién cambió menú/pedido/usuario ni restaurar fácilmente un error.
- **Expected / Actual:** migraciones ordenadas/repetibles y eventos mínimos / operación manual y estado final solamente.
- **Impact:** drift entre código/DB, rollback incierto y riesgo para tablas de Grill Express.
- **Fix:** migraciones versionadas y preflight; backup/restore probado; audit events mínimos; RPC/transacción para operaciones multi-tabla.
- **Complexity / Behavior / Tests:** Medium / No inicialmente / Yes.

### GL-021 — Cero cobertura automatizada

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `package.json:6-9`; repositorio completo.
- **Description:** solo existe script `start`; no tests, lint, typecheck, API smoke ni CI visible.
- **Evidence:** inventario y comandos disponibles.
- **Impact:** las reglas críticas dependen de revisión manual; cambios de fecha/entrega pueden reincidir.
- **Fix:** Node test runner + fixtures in-memory/Postgres de prueba; smoke HTTP; lint básico; CI antes de merge/deploy.
- **Complexity / Behavior / Tests:** Medium / No / Yes (es el hallazgo).

### GL-022 — PWA depende de disciplina manual y puede comunicar éxito prematuro

- **Severity / Confidence / Status:** MEDIUM / HIGH CONFIDENCE / OPEN
- **Affected:** `public/sw.js:9-17,46-69,72-139`; `public/entrega.html:455-471,694-707`.
- **Description:** versión `v2` debe subirse manualmente; jsQR es CDN crítico; `skipWaiting/clients.claim` activa código nuevo sin contrato API; la PWA muestra verde y marca entregada antes de confirmación server.
- **Controls:** cola se persiste antes del éxito visual y POST/API nunca se cachea; estrategia de navegación es network-first.
- **Expected / Actual:** actualización verificable, assets críticos propios y estados “guardado local/subido” / dependencia de bump/CDN y éxito ambiguo.
- **Impact:** escáner no disponible offline si CDN no precargó; código viejo/nuevo incompatible; entrega física sin persistencia.
- **Fix:** alojar jsQR/qrcode localmente, generar versión desde build/commit, contrato API compatible, copy/estado de sincronización explícito.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes (first install offline, update, CDN down, lost response, reconnect).

### GL-023 — Manual y README tienen drift operativo

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `README.md:32-36,119-141`; `public/manual.html:169,203,248-252,281-300`; `services/cocina.js:313-350`.
- **Description:** README llama automática a una comanda que solo va a logs; `TELEFONO_COCINA` no se usa; `.env.example` no existe y sin env no arranca; manual dice que cocina ya recibió; dashboard no implementa estados amarillo/rojo de WhatsApp.
- **Impact:** operador cree que un control inexistente funcionó.
- **Fix:** actualizar manual/README al comportamiento real después de definir cocina/Meta; añadir runbook de clave de entrega y contingencias.
- **Complexity / Behavior / Tests:** Small / No / No (sí revisión operativa).

### GL-024 — Gaps responsive y de accesibilidad

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `public/admin.html:347-370`; `public/entrega.html:200-205`; `public/qr.html:25-40`; `public/manual.html:25-48,78-86`; avisos dinámicos de todas las páginas.
- **Description:** inputs de admin/entrega solo tienen placeholder; no hay `aria-live`/roles en errores/éxitos; generador QR desborda 85 px a 320 y manual 50 px; varios targets <44 px.
- **Evidence browser:** pedido y gates sin overflow en tamaños probados; QR `scrollWidth=405` con viewport 320/390; manual `370` con viewport 320; labels ausentes detectados para `adminUser`, `adminKey`, `clave`, `formato`, `url`.
- **Expected / Actual:** controles etiquetados y operación sin scroll horizontal común / gaps descritos.
- **Impact:** errores de uso y barreras para lector de pantalla; QR admin incómodo en móvil.
- **Fix:** labels explícitos, `aria-live`, focus de error/success, targets 44px, inputs fluidos `min-width:0`, wrappers de tabla.
- **Complexity / Behavior / Tests:** Small / No / Yes (axe/keyboard/viewports).

### GL-025 — Teléfono como PK acopla identidad, privacidad y WhatsApp

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN
- **Affected:** `schema.sql:6-16,36-46`; `services/supabase.js:12-38,97-174`; `README.md:28-30`.
- **Description:** la web no usa teléfono para login, pero pedidos lo referencian como PK/FK; el dato WhatsApp se vuelve identidad permanente y obliga cascadas/migraciones.
- **Impact:** mayor exposición/retención de PII, duplicados por variantes y migración WhatsApp difícil.
- **Fix:** ID interno estable para empleado; `numero_empleado` y teléfonos como identificadores únicos/versionables; tabla de channel identities y snapshot histórico.
- **Complexity / Behavior / Tests:** Large / Yes (migración) / Yes.

### GL-026 — Procesamiento WhatsApp perderá estado/mensajes al escalar

- **Severity / Confidence / Status:** MEDIUM / CONFIRMED / OPEN (además de GL-002)
- **Affected:** `routes/webhook.js:16-35,73-126,130-226`.
- **Description:** sesiones y dedup son Map por proceso; se marca dedup antes de completar; se responde 200 antes de persistir y errores posteriores solo se loguean.
- **Reproduction:** reinicio entre pasos; dos instancias; error DB después de 200; reintento con mismo message ID.
- **Expected / Actual:** estado/dedup durable e idempotente / pérdida o conversaciones rotas.
- **Impact:** cuando Meta se habilite, pedidos y confirmaciones pueden perderse.
- **Fix:** persistir conversación/dedup o diseñar flujo stateless; inbox transaccional; ack 200 después de registrar evento durable; worker con retry.
- **Complexity / Behavior / Tests:** Medium / Yes / Yes.

### GL-027 — Vulnerabilidad transitiva baja

- **Severity / Confidence / Status:** LOW / CONFIRMED / OPEN
- **Affected:** `package-lock.json` (`body-parser 1.20.5` vía Express 4.22.2).
- **Evidence:** `npm audit --omit=dev`: GHSA-v422-hmwv-36x6, invalid limit puede desactivar enforcement; severidad low.
- **Impact:** limitado porque código no configura un límite inválido, pero debe eliminarse en mantenimiento.
- **Fix:** actualizar dentro de rama compatible después de pruebas; no ejecutar `audit fix` a ciegas.
- **Complexity / Behavior / Tests:** Small / No / Yes smoke API.

### GL-028 — Carga y dependencias externas innecesarias

- **Severity / Confidence / Status:** LOW / CONFIRMED / OPEN
- **Affected:** `public/admin.html:11`; `public/entrega.html:16`; `public/qr.html:11`; `services/cocina.js:295`; assets.
- **Description:** SheetJS se descarga antes de login; QR/jsQR bloquean parse/render; `golunch-compacto.png` ~800 KiB.
- **Impact:** primer uso más lento y funciones críticas dependen de terceros.
- **Fix:** self-host/pin con integridad, defer/lazy-load SheetJS, optimizar imágenes sin alterar impresión.
- **Complexity / Behavior / Tests:** Small / No / Yes performance/offline.

### GL-029 — Archivos/configuración huérfanos

- **Severity / Confidence / Status:** LOW / CONFIRMED / OPEN
- **Affected:** `public/golunch-logo.png`, `public/golunch.png`, `TELEFONO_COCINA`, `.env.example` referencia, `CNAME`.
- **Evidence:** búsqueda exacta dio cero referencias para ambos PNG; tamaños 1.148 y 1.260 KiB. `TELEFONO_COCINA` solo aparece en comentario/README. `.env.example` no existe. Uso de CNAME no verificable desde repo.
- **Expected / Actual:** inventario mínimo/documentación válida / residuos y candidato legacy.
- **Fix:** borrar PNG tras autorización; retirar o implementar env/documentación; comprobar GitHub Pages antes de CNAME.
- **Complexity / Behavior / Tests:** Small / No / No, salvo smoke assets.

## Operational reconciliation

| Reconciliación | Resultado |
|---|---|
| Valid orders = kitchen total | **Verified** para 0, 1, todos igual y mixto |
| Orders by meal = sum kitchen meal quantities | **Verified** en fixtures |
| Orders by time slot = sum grouped time quantities | **Verified by branch/count**; cada fila incrementa una clave |
| Orders by zone = sum grouped zone quantities | **Verified by branch/count**, pero no se imprime en comanda |
| Delivery = on-time + late + not-delivered | Se particiona, pero “unknown” se clasifica on-time |
| Dashboard orders = raw orders | **Not guaranteed**; inactivos se excluyen |
| One order = one production row | **Verified** por unique/upsert y prueba repetida |

## Data privacy

| Campo | Motivo actual | Almacenamiento/transmisión | Acceso/retención |
|---|---|---|---|
| Nombre | operación/etiqueta | empleados, joins, entrega, impresos | Admin y repartidor; sin política de retención |
| Número empleado | login/QR | empleados, QR, entrega | Público si se ve etiqueta; funciona como credencial |
| Teléfono | futuro WhatsApp/PK | empleados, pedidos FK, envíos, Excel admin, Meta | Admin/Meta; permanente por modelo |
| Zona/turno | entrega/producción | empleado default + snapshot en pedido | Admin/repartidor/cocina |
| Pedido/fecha/platillo | servicio/factura | pedidos, admin, reparto, etiquetas | Sin política de retención; hard delete posible |
| Entrega/motivo | operación/SLA | pedidos, reportes | Admin/repartidor |
| Rating | calidad | pedido identificado | Admin; asociado a empleado |

No se encontraron secretos vigentes en archivos tracked. La búsqueda histórica produjo coincidencias de asignaciones de variables en tres commits; revisión redactada confirmó referencias/variables, no JWT/private keys ni valores embebidos. La política de logs no evita explícitamente PII: WhatsApp puede registrar teléfono en errores y entrega retorna detalles internos.

## PWA, cache and network resilience

### Verified design strengths

- POST nunca se intercepta por el service worker.
- APIs GET no coinciden con la lista blanca de estáticos.
- Navegación es network-first con fallback cache.
- Precache tolera que un recurso individual falle.
- Cola se escribe antes de intentar red y conserva la fecha de captura.
- Lista server se mezcla con cola local para no “desentregar” durante reconnect.

### Unverified/risks

- El navegador de auditoría no expuso Service Worker; no se pudo ejecutar offline real, update ni installability.
- Safari/iOS, cámara, lector BT y reinicio físico requieren dispositivo.
- No hay timeout explícito en fetch cliente ni Supabase.
- Dos `sincronizar()` pueden solaparse (intervalo, online y escaneo), agravando GL-006.
- `beforeunload` no es garantía móvil; la cola ya persistida mitiga pérdida.

## UI Audit Health Score

| # | Dimension | Score | Key finding |
|---|---:|---:|---|
| 1 | Accessibility | 2/4 | labels y anuncios dinámicos incompletos |
| 2 | Performance | 3/4 | core ligero; CDNs/imagen de QR y SheetJS penalizan |
| 3 | Responsive Design | 3/4 | pedido/entrega/gates sólidos; QR/manual fallan a 320 |
| 4 | Theming | 4/4 | tokens, marca y jerarquía coherentes |
| 5 | Implementation Integrity | 2/4 | XSS, duplicación de reglas UI y estados engañosos |
| **Total** |  | **14/20 — Good** | El sistema visual es específico y coherente, pero requiere hardening |

**Implementation Integrity verdict:** PASS visual / FAIL de seguridad de implementación. La interfaz expresa Go Lunch/Glovis de forma consistente; los avisos del detector sobre bordes laterales/sombra son estilísticos. La inserción insegura de datos y los estados de entrega sí son fallas reales.

## Dependency and build audit

| Área | Resultado |
|---|---|
| Clean install | PASS en carpeta temporal, `npm ci --ignore-scripts` |
| Production build | N/A: no existe build; HTML/JS se sirve directo |
| Production start | PASS con env ficticio; cron off |
| Syntax | PASS módulos y scripts inline |
| Lint | No configurado |
| Typecheck | No TypeScript / no configurado |
| Tests | No configurados |
| Audit | 1 low transitiva |
| Outdated | Supabase patch/minor disponible; Express/dotenv majors disponibles; no actualizar sin suite |

Dependencias directas están usadas: Express (servidor), Supabase (persistencia), Luxon (fechas), dotenv (config). SheetJS/jsQR/qrcodejs son dependencias no versionadas por lockfile porque llegan de CDN.

## Dead Code Candidates

| Archivo/símbolo | Evidencia | Confianza | Riesgo de retiro |
|---|---|---:|---|
| `public/golunch-logo.png` | cero referencias; 1.148 KiB | 99% | bajo; verificar URLs externas antes |
| `public/golunch.png` | cero referencias; 1.260 KiB | 99% | bajo; verificar URLs externas antes |
| export `supabase` en `services/supabase.js:368` | ningún import interno | 95% | bajo; tests/scripts externos desconocidos |
| `TELEFONO_COCINA` | solo README/comentario; envío TODO | 100% no implementado | bajo para código; aclarar roadmap |
| `CNAME` | Railway documentado; sin consumidor runtime | 70% legacy | medio hasta verificar GitHub Pages |
| WhatsApp modules/routes | hoy inactivos, pero roadmap explícito | **No dead** | mantener aislados tras fail-closed |
| `/debug`, `/test-supabase` | no UI, utilidad operativa protegida | **No dead** | mantener/documentar |

Índices potencialmente redundantes: unique de `numero_empleado` ya crea índice además de `idx_empleados_numero`; unique `(fecha_menu,empleado_telefono)` puede servir búsquedas por prefijo además de `idx_pedidos_fecha`. Confirmar con `EXPLAIN`/catálogo antes de borrar.

## Code duplication and magic values

- Zonas/turnos/textos se duplican entre `menu.js`, admin, pedido y entrega.
- Conteo de cocina existe en `cocina.js`, admin y builders de Excel.
- Normalización de 10 dígitos se duplica en `telefono.js` y admin import.
- Date-only se implementa con Luxon en servidor y `Date/toISOString` en cliente.
- 20:00, 20:05, 10:00, 17:00, 15 min y timezones están repartidos.
- Duplicación crítica ya evitada: creación final de pedido web/WhatsApp converge en `services/pedidos.js`.

## Operational failure scenarios

| Escenario | Comportamiento actual | Riesgo/fallback | Control recomendado |
|---|---|---|---|
| Web caída durante ventana | no hay pedido; PWA pedido cacheada tampoco puede POST | no se documenta canal alterno | runbook manual y monitoreo/alerta |
| DB caída | APIs 500/hang; health puede seguir verde | mensajes genéricos; sin cola de pedidos | readiness, timeout, alerta, contingencia |
| Submit exacto al corte | 20:00 rechazado; request validado antes puede commit después | ventana de carrera pequeña | transacción/RPC con timestamp DB |
| Cocina falla ~7 AM | no existe job 7 AM; cron log 20:05 puede perderse | impresión manual nocturna | scheduler durable + acuse/runbook |
| QR sin red | cola local funciona | timestamp/definitivos/clave pueden perder trazabilidad | idempotencia y estados de sync |
| Dashboard caído | pedidos públicos continúan | operación a ciegas | dashboard no crítico + export/runbook |
| Deploy en ventana | navegación network-first, instancia puede reiniciar | sesiones WA/cron memoria se pierden | deploy window, health/readiness, durable jobs |

## Risk Register

| Risk | Probability | Impact | Current Control | Recommended Control |
|---|---|---|---|---|
| Suplantación por número de empleado | High | Critical | número unique/activo | autenticación + ownership + rate limit |
| Webhook forjado | Medium-High si secret falta | Critical | HMAC solo si existe secret | feature flag + fail closed |
| Fecha equivocada al imprimir | High en operación 20:00 | High | fecha visible/editable | date helper TZ + tests |
| Entrega duplicada/reloj erróneo | Medium | High | guard local contra doble | update condicional + dual timestamps |
| Pérdida de historia por delete | Medium | High | confirm UI | soft delete + backup/audit |
| Cocina no recibe comando | Medium | High | rutina manual | scheduler y acuse |
| Stored XSS admin | Low-Medium | High | datos mayormente internos | escaping/CSP |
| PWA/CDN no disponible | Medium | Medium-High | cache individual | self-host + smoke offline |
| Drift DB en proyecto compartido | Medium | High | schema manual/comentarios | migrations/backup/review |
| Reporte histórico falso | High al consultar pasado | High | ninguno | elegibilidad histórica/snapshots |

## Verified Correct / Strong Areas

- **Un pedido por empleado/fecha:** unique DB y upsert; dos envíos ficticios dejaron una fila con la edición final.
- **Corte autoritativo en servidor:** 19:59:59 acepta y 20:00:00 rechaza en timezone configurada.
- **Platillo, zona y turno:** se validan en servicio compartido; si default y request faltan/son inválidos, rechaza.
- **Confirmación de pedido:** UI usa `d.fecha`, `d.resumen` y empleado retornados por servidor, no solo estado local.
- **Reconciliación de cocina:** 0, 1, todos igual y mixto produjeron total exacto y cada pedido una vez.
- **Snapshot del platillo:** `opcion_texto` preserva el texto elegido frente a renombres posteriores (aunque GL-013 exige política de cambios).
- **QR de otro día:** PWA compara fecha y UPDATE servidor filtra fecha; no marca un pedido inexistente.
- **Salida HTML de cocina/etiquetas:** valores se escapan con `esc`.
- **Offline queue:** persist-before-network, lote por fecha y retry para errores no definitivos son decisiones sólidas.
- **Cache dinámica:** service worker no cachea APIs ni escrituras.
- **Separación de privilegio:** ENTREGA_KEY no abre administración; ADMIN_KEY sí puede operar entrega intencionalmente.
- **Edición de teléfono:** código valida variantes, evita colisión y schema incluye `ON UPDATE CASCADE` para pedidos.
- **Secretos actuales:** no se encontraron credenciales embebidas en archivos tracked.
- **Dominio raíz:** producción redirige correctamente a pedido; no requiere exclusivamente QR.
- **Responsive core:** pedido, entrega gate y admin gate sin overflow en los viewports probados.

## Unknowns / Cannot Verify

| Unknown | Evidencia necesaria |
|---|---|
| Schema real de producción coincide con `schema.sql` | catálogo/DDL read-only de Supabase |
| APP_SECRET/VERIFY_TOKEN/CRON flags reales | inventario redactado de variables Railway |
| Backups y recuperación del plan Supabase Free | política del proyecto + prueba de restore; no está en repo |
| RLS/policies y roles DB | export de policies/catálogo |
| Railway rollback, health checks, replicas, deploy hooks | settings/export de Railway |
| GitHub Pages/CNAME aún activo | settings DNS/Pages |
| Regla definitiva 7 AM vs 20:05 y fines de semana | decisión operativa firmada |
| PWA instalada/actualizada offline en Safari/Chrome reales | matriz de dispositivos físicos |
| Cámara, Zebra, etiquetas, tablet/lector BT | piloto hardware controlado |
| Impresiones ya existentes del QR tras un futuro cambio de URL/payload | inventario físico y prueba de escaneo |
| Volumen/latencia con 125 usuarios simultáneos | prueba de carga en staging |
| Estado de datos duplicados por variantes de teléfono | query de calidad read-only |
| Menú ausente durante auditoría | producción mostró “Aún no hay menú”; no se alteró para probar flujo |

## Launch Blockers

1. GL-001 identidad/ownership de empleado.
2. GL-002 webhook fail-open o, como control inmediato, deshabilitarlo completamente.
3. GL-003 fechas admin alrededor del corte.
4. GL-004 binding de fecha/versión del menú al submit.
5. GL-005 política única de corte por service date.
6. GL-006/007/008 integridad e idempotencia de entrega.
7. GL-009 preservación del historial (retirar hard delete antes del piloto).
8. GL-010 exactitud o deshabilitación explícita de métricas históricas engañosas.
9. GL-011 control real de entrega de comanda y zonas.
10. GL-012 stored XSS del panel.
11. GL-013 política segura de edición de menú con órdenes.

## Fix Order

### P0 — Must fix before real use

1. Fail-close y apagar WhatsApp/webhook (GL-002); añadir flag explícito.
2. Definir e implementar autenticación/ownership del empleado y rate limits (GL-001).
3. Añadir fixtures/regresión base antes de tocar reglas (GL-021, sección test plan).
4. Corregir date-only del panel y binding `fecha/version` del pedido (GL-003, GL-004).
5. Definir un único corte por service date y alinear cron/copy (GL-005).
6. Hacer entrega idempotente, preservar primera hora y soportar empleados inactivos con pedido (GL-006, GL-007).
7. Guardar/validar hora cliente + recepción servidor (GL-008).
8. Retirar hard delete operativo y preservar historia (GL-009).
9. Corregir/limitar dashboard histórico (GL-010).
10. Implementar control operativo de comanda completa/acuse y zonas (GL-011).
11. Eliminar XSS del panel (GL-012).
12. Bloquear/versionar edición de menú con pedidos (GL-013).

### P1 — Fix immediately after P0

1. Sesión admin, impresos sin secreto en URL, rate limiting y headers (GL-014).
2. Reautenticación segura de PWA sin perder cola (GL-015).
3. QR firmado/opaque y fallback manual auditado (GL-016).
4. Validación uniforme + CHECK constraints (GL-017).
5. Categoría de puntualidad desconocida y TZ única (GL-018).
6. Env fail-fast, timeouts, readiness y observabilidad (GL-019).
7. Migraciones versionadas, rollback, backup y audit events (GL-020).
8. Suite completa y CI gate (GL-021).
9. Self-host de librerías críticas y update PWA verificable (GL-022).
10. Actualizar manual/README al comportamiento corregido (GL-023).

### P2 — Planned improvement

- Accesibilidad/responsive (GL-024).
- ID interno y channel identities antes de activar Meta (GL-025/026).
- Performance/lazy loading y actualización compatible de dependencias (GL-027/028).

### P3 — Optional cleanup

- Borrar orphans confirmados y revisar CNAME/export no usado (GL-029).
- Evaluar índices redundantes con `EXPLAIN`.
- Ajustes visuales del detector solo si el dueño los desea.

## Refactor Candidates

| Refactor | Justificación | Módulos | Riesgo | Tests previos |
|---|---|---|---|---|
| `ServiceCalendar`/corte por fecha | GL-003/004/005 | menu, pedidos, admin UI, cron | alto de negocio | matriz temporal completa |
| Repositorio de entrega/RPC idempotente | GL-006/007/008 | entrega routes, Supabase, schema | alto | concurrencia/offline |
| Render seguro del admin | GL-012/024 | admin.html | bajo | XSS + snapshots/DOM |
| Identidad interna estable | GL-001/009/025 | schema, db, pedido, webhook | alto/migración | ownership e historia |
| Catálogo compartido vía API | GL-017/018/duplicación | menu + tres HTML | medio | labels/enums/reportes |
| Inbox/job durable Meta/cocina | GL-002/011/026 | webhook, cocina, schema/worker | medio | retry/idempotencia |

No se recomienda migrar framework, Firebase ni reescribir frontend para resolver estos hallazgos.

## Dead Code Removal Plan

- **Safe removal tras smoke de assets:** `public/golunch-logo.png`, `public/golunch.png`.
- **Removal after tests/search externa:** export `supabase`; índices redundantes.
- **Uncertain—keep:** `CNAME` hasta verificar Pages/DNS.
- **Legacy required temporarily:** webhook/WhatsApp, pero detrás de flag fail-closed.
- **Documentation cleanup:** `.env.example` debe crearse o quitarse referencia; `TELEFONO_COCINA` se documenta como futuro o se retira.

## Test Plan Before Fixes

### Base harness

- Node test runner; reloj inyectable; repositorio DB fake y Postgres/Supabase de test.
- Fixtures ficticios: activo sin pedido, activo con pedido, inactivo con pedido, editado, entregado, no entregado, dos zonas, dos turnos, varios platillos.
- API tests con app exportada sin `listen` automático.

### P0 failing tests first

| Fix | Reproducción que debe fallar hoy | Expected después |
|---|---|---|
| GL-001 | otro actor usa `AUD001` | 401/403 y sin lectura/escritura |
| GL-002 | POST webhook sin firma/secret | 404/503/403, cero side effects |
| GL-003 | panel 20:05 -06 | hoy=D, impresos=D+1 |
| GL-004 | UI D, submit D+1 | 409 stale, sin pedido |
| GL-005 | menú lunes durante fin de semana | una ventana continua y corte único acordado |
| GL-006 | dos scans simultáneos | timestamp inicial inmutable, uno duplicate |
| GL-007 | inactivo con pedido | entrega válida o excepción persistida |
| GL-008 | timestamp futuro/pasado | rechazo/flag + recibido servidor |
| GL-009 | delete con historia | bloqueado o historia preservada |
| GL-010 | alta posterior/baja posterior | población histórica correcta |
| GL-011 | job reinicia/falla/retry | un artefacto completo y acuse |
| GL-012 | nombre/menu `<img onerror>` | texto literal, no ejecución |
| GL-013 | editar menú con pedidos | bloqueo o migración/versionado explícito |

### Regression suite

- 7:59:00, 7:59:59, 8:00:00, 8:00:01; medianoche; timezone cliente distinta.
- Valid order; missing/invalid meal/time/zone; employee inactive.
- Double click, retry tras respuesta perdida, dos tabs, dos devices, concurrent edits.
- Menu edit while submit; kitchen report while edit.
- QR válido, manipulado, día incorrecto, inexistente, duplicado, sin auth.
- Delivery offline/reconnect, app restart, wrong key rotation, overlapping sync.
- Dashboard/rating/range reconciliation; unknown turn; rename/deactivate/delete.
- PWA first install, first launch offline, update vN→vN+1, CDN unavailable.
- 320/375/390/430/768/1440, keyboard-only y axe.

## Files likely to change if authorized

- `services/menu.js`, `services/pedidos.js`, `services/supabase.js`, `services/cocina.js`
- `routes/pedido.js`, `routes/entrega.js`, `routes/webhook.js`, `routes/admin.js`
- `public/pedido.html`, `public/entrega.html`, `public/admin.html`, `public/sw.js`
- `public/manual.html`, `README.md`
- `schema.sql` y un nuevo directorio versionado de migraciones
- `package.json` y nuevos tests/fixtures/CI
- Posiblemente `index.js` para app factory, flags, headers, rate limits y readiness

## Final Audit Checklist

- [x] Repositorio y todos los entry points leídos/inventariados.
- [x] Arquitectura, roles, storage, endpoints y variables trazados.
- [x] Source of truth, new order, edit, kitchen, delivery y dashboard trazados.
- [x] Duplicados, corte, timezone, menú, zona, turno y reconciliación auditados.
- [x] QR, rating, authn/authz, privacidad, inputs, errores y carreras auditados.
- [x] DB, migraciones, delete/cascade, logging, audit trail y secrets revisados.
- [x] Dependencias, clean install, sintaxis, start y tooling revisados.
- [x] Dead code, duplicación, flags, mocks, debug y documentación revisados.
- [x] PWA/cache/network y responsive/a11y revisados hasta donde permitió el entorno.
- [x] WhatsApp futuro e independencia web evaluados.
- [x] Positivos, unknowns, risk register, launch blockers y plan de pruebas incluidos.
- [x] No se refactorizó, borró, actualizó ni modificó comportamiento.

## Final decision

**NO-GO**

La aplicación no debe entrar a piloto real con los hallazgos Critical/High abiertos. El camino más corto no es una reescritura: es cerrar el webhook, autenticar ownership, corregir fechas/binding de menú, hacer entrega idempotente, preservar historia, corregir dashboard/cocina y asegurar el render del panel; después ejecutar la suite P0 y un piloto controlado en dispositivos/hardware reales.
