# Go Lunch — contrato de interfaz

## Dirección visual

Go Lunch es una herramienta operativa corporativa: debe sentirse clara,
confiable y rápida, no decorativa. La identidad se construye con azul marino,
azul Glovis, superficies blancas y fondos fríos. Los logotipos siempre viven
juntos sobre una placa blanca para conservar contraste en temas claro y oscuro.
La firma aprobada es `public/golunch-aprobado-horizontal.jpg`; para favicons y
espacios reducidos se usa el recorte fiel `public/golunch-aprobado-mark.png`.
Los originales autorizados, incluido el trazo monocromático, viven en
`assets/brand/` y no deben redibujarse desde CSS.

## Principios

- Una pantalla, una tarea principal. Las funciones administrativas se agrupan
  por contexto y las pruebas nunca compiten con la operación diaria.
- En móvil, la acción principal permanece accesible y el contenido puede crecer
  mediante scroll sin comprimir controles ni listas.
- Las zonas, turnos y horarios se muestran con nombres operativos, no con claves
  internas de base de datos.
- Los estados críticos se dicen con texto además de color: en línea, pendiente,
  entregado, cerrado, no verificado y fuera de zona.
- Los controles táctiles tienen al menos 44 px de alto y foco visible.
- Los cambios de apariencia deben conservar IDs, contratos de datos y la clase
  `.oculto` de las PWA existentes.

## Cobertura del segundo turno

La solicitud del supervisor se presenta como una lista de personas y alimentos,
no como una orden financiera. La pantalla muestra únicamente horario, menú,
zona, responsable y beneficiarios. Costos y acuerdos comerciales no aparecen.

El panel administrativo mantiene cuatro bloques: menú especial, supervisores
autorizados, solicitudes/producción y autorizaciones vigentes. En reparto, las
coberturas se distinguen visualmente, pero comparten el mismo patrón de escaneo
de las entregas regulares.

El conteo cierra a las 2:45 PM según la hora del servidor. Si hay solicitudes,
el panel interrumpe la operación con una alerta sonora y visual, intenta abrir
la impresión de la comanda y conserva una acción manual de respaldo. La alarma
solo se apaga cuando el operador confirma que la comanda quedó impresa.

## PWA y caché

Todo cambio dentro de `/public` debe acompañarse de un incremento de `VERSION`
en `public/sw.js`. Cualquier asset nuevo que deba funcionar sin señal se agrega
también a `PRECARGA`.
