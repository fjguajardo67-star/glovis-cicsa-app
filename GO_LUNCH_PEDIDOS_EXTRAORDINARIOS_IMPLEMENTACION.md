# Go Lunch — Coberturas del segundo turno

**Cliente:** Hyundai Glovis

**Operador:** CICSA Go Lunch
**Estado:** arquitectura aprobada e implementada en código; requiere ejecutar la migración SQL y completar pruebas antes de publicar

## 1. Propósito

Atender los casos esporádicos en que empleados del primer turno extienden su jornada al segundo turno. Un supervisor autorizado por Glovis solicita el mismo día un alimento por cada empleado, a partir de un menú especial de tres opciones rápidas.

No es un tercer turno ni un pedido personal adicional del supervisor. La cobertura vive separada de `pedidos`, de modo que un empleado puede tener su comida regular y su alimento de cobertura el mismo día sin que uno reemplace al otro.

## 2. Reglas acordadas

- Solo pueden solicitar supervisores incluidos en la lista oficial de Glovis.
- CICSA selecciona al supervisor desde la plantilla de empleados ya existente y le asigna una clave personal.
- El supervisor entra con número de empleado + clave personal.
- Las solicitudes son para el mismo día y cierran a las **2:45 PM**, según la hora del servidor.
- Cocina produce de 3:00 a 4:30 PM; la unidad sale a las **4:30 PM** y entrega a las **5:00 PM**.
- El menú especial tiene exactamente tres opciones rápidas, publicadas por CICSA para esa fecha.
- No hay modificaciones de preparación.
- El supervisor captura una fila por beneficiario: número de empleado + opción de menú.
- El nombre se resuelve desde la plantilla; no se permite nombre libre.
- El supervisor indica por número de empleado quién será responsable de recibir el lote.
- Existe una sola solicitud consolidada por supervisor y fecha; puede editarse o cancelarse antes del corte.
- Una persona no puede aparecer en dos coberturas activas del mismo día.
- La solicitud no muestra precios, importes ni condiciones comerciales.
- Cocina imprime una comanda y etiquetas separadas de las del servicio regular.
- Cada recipiente se entrega escaneando su propio QR.
- En el primer recipiente del folio se confirma al responsable. Si recibe alguien distinto, se escanea una sola vez el QR de su gafete Glovis y se reutiliza ese receptor para el resto del folio.
- Las coberturas no participan en el cierre masivo de pedidos regulares.

## 3. Modelo de datos

### `supervisores_cobertura`

Relaciona una autorización con un empleado real mediante `empleado_telefono` y `ON UPDATE CASCADE`. Guarda hash de clave, vigencia, estado y versión de sesión. No duplica nombre ni número como datos editables.

### `menus_cobertura`

Una fila por fecha con tres opciones y estado activo. El menú de cobertura es independiente de `menus`, porque se publica y consume el mismo día.

### `solicitudes_cobertura`

Encabezado consolidado: folio, fecha, supervisor, responsable, zona, Turno B, total y estado. Conserva instantáneas de número y nombre para que el historial no cambie si después cambia la plantilla.

### `solicitudes_cobertura_items`

Una fila por recipiente y beneficiario. Incluye opción, texto histórico, UUID de entrega, evidencia de hora/ubicación/repartidor y datos del receptor.

El UUID es obligatorio: la etiqueta regular usa `numero|fecha`; la de cobertura usa `EX|uuid|fecha`. Así no hay colisión cuando la misma persona tiene ambas comidas.

### `guardar_solicitud_cobertura(...)`

Función transaccional que valida en la base:

- fecha de hoy y corte de las 2:45 PM;
- supervisor vigente;
- menú activo;
- zona válida;
- responsable y beneficiarios activos;
- opciones permitidas;
- empleados repetidos o ya asignados en otra cobertura;
- edición completa de la solicitud sin guardar estados parciales.

## 4. API del supervisor

Base: `/cobertura`

- `POST /login`: número de empleado y clave; devuelve sesión firmada de ocho horas con scope exclusivo de cobertura.
- `GET /estado`: horario, menú, supervisor y solicitud de hoy.
- `GET /empleado/:numero`: confirma nombre desde la plantilla activa sin descargarla completa.
- `POST /solicitud`: crea o reemplaza la solicitud consolidada.
- `DELETE /solicitud`: cancela antes del corte.

La pantalla es `/cobertura.html` y también se alcanza desde el acceso principal de Go Lunch.

## 5. Panel CICSA

La pestaña **Coberturas** contiene cuatro funciones separadas:

1. Publicar las tres opciones rápidas para una fecha.
2. Autorizar a un supervisor seleccionándolo de la plantilla oficial, con vigencia y clave personal.
3. Consultar solicitudes y conteo total de alimentos.
4. Abrir comanda y etiquetas de cobertura para imprimir.

La clave se muestra únicamente al crearla o restablecerla. Cambiarla o desactivar al supervisor invalida sus sesiones abiertas.

## 6. Cocina e impresos

- `/comanda-cobertura/:fecha?key=...` agrupa por zona y platillo.
- `/etiquetas-cobertura/:fecha?key=...` genera una etiqueta por alimento.
- La etiqueta muestra “Cobertura · 5:00 PM”, beneficiario, número, platillo, zona, folio, secuencia y responsable.
- El QR de la etiqueta contiene `EX|codigo_entrega|fecha`.

Los impresos regulares no cambian.

## 7. Entrega

La misma PWA y las mismas cuentas de reparto atienden ambos servicios.

1. La lista diaria une visualmente pedidos regulares y coberturas, pero conserva identidades internas separadas.
2. El repartidor escanea cada etiqueta.
3. En el primer paquete de un folio confirma si recibe la persona indicada.
4. Si recibe otra persona, la PWA solicita el QR del gafete Glovis y guarda el número y nombre leídos.
5. Esa decisión se recuerda localmente para los demás paquetes del mismo folio, incluso sin señal.
6. Cada escaneo conserva fecha, zona, repartidor, hora y coordenada, y se sincroniza con la cola offline actual.

## 8. Seguridad y aislamiento

- Las claves se guardan con `scrypt`; nunca en texto claro.
- Los tokens de supervisor llevan `scope: cobertura` y no sirven en reparto.
- Se recomienda configurar `SUPERVISOR_SESSION_SECRET`; mientras se prepara, puede heredar `ENTREGA_SESSION_SECRET` sin mezclar scopes.
- La hora de corte se valida de nuevo dentro de PostgreSQL; no depende del reloj del teléfono.
- Los nombres y números operativos se obtienen de la plantilla de Go Lunch.
- No se exponen precios ni datos financieros en la API del supervisor.
- La cobertura no modifica `pedidos`, `menus` ni el flujo de WhatsApp.

## 9. Activación

Antes de publicar:

1. Ejecutar en Supabase el bloque nuevo de `schema.sql`.
2. Configurar `SUPERVISOR_SESSION_SECRET` en Railway, idealmente distinto al de reparto.
3. Publicar el menú especial de prueba para la fecha de prueba.
4. Autorizar un supervisor de prueba y anotar su clave.
5. Crear una solicitud con empleados que también tengan pedido regular y comprobar que ambos permanecen.
6. Imprimir comanda y etiquetas.
7. Probar entrega en VDC y REFIS, con receptor esperado y receptor distinto.
8. Probar sin señal y confirmar que “Por subir” vuelve a cero al recuperar conexión.
9. Verificar que el cierre masivo solo afecte pedidos regulares.
10. Publicar el commit únicamente después de completar estas pruebas.

## 10. Migración manual requerida

El despliegue del código no crea las tablas. La migración de `schema.sql` debe ejecutarse primero o en la misma ventana de activación. Hasta entonces, el reparto regular sigue operando y omite coberturas si detecta que las tablas aún no existen; la pestaña y la pantalla de cobertura no estarán funcionales.
