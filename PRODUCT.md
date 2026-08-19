# Go Lunch (Glovis)

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario principal es el empleado de Hyundai Glovis que abre la aplicación desde el QR físico del comedor y necesita elegir rápidamente su comida para el siguiente día de servicio. Administración publica menús y mantiene la plantilla; cocina y reparto consumen los pedidos ya organizados.

## Product Purpose

Go Lunch conecta la publicación del menú con la elección del empleado, la preparación de cocina y la entrega. El éxito es que cada empleado pueda identificar su pedido, elegir platillo, turno y zona con claridad, y que la operación conserve datos confiables hasta la entrega.

## Positioning

El acceso web no requiere cuenta ni contraseña: localiza al empleado con su número de gafete, recupera su asignación operativa y le permite ajustar turno o zona para ese pedido sin modificar su registro de Recursos Humanos.

## Operating Context

- El empleado usa principalmente un teléfono móvil y entra por el mismo QR del comedor.
- El menú corresponde al próximo día futuro publicado, que puede no ser literalmente mañana.
- El pedido cierra a las 8:00 PM.
- Turno y zona son variables operativas; pueden venir de RRHH, de un pedido previo o elegirse para el pedido actual.
- La aplicación web es el canal principal mientras Meta/WhatsApp permanece sin verificar.
- El panel, la página del empleado, cocina y reparto forman un solo flujo operativo.

## Capabilities and Constraints

- Identificación por número de empleado.
- Bienvenida personalizada con el nombre devuelto por el backend.
- Seis opciones obligatorias por menú: tres fijas y tres variables.
- Edición del pedido mientras el periodo siga abierto.
- Selección explícita de turno y zona cuando no existen valores predeterminados.
- La aplicación debe conservar historial y evitar mezclar sesiones entre empleados.
- El frontend se sirve desde Railway y usa Supabase como base de datos.
- El QR y las URLs existentes deben seguir funcionando después de los rediseños.

## Brand Commitments

- Nombre: CICSA GoLunch.
- Cliente: Hyundai Glovis.
- Usar los logotipos corporativos reales, sin sustituirlos por iconos genéricos.
- Voz en español, directa, amable y profesional; sin tono infantil ni promesas no verificadas.
- La identidad existente usa azul marino, cobalto, blanco y azules claros.

## Evidence on Hand

- Logotipo Go Lunch: `public/golunch-compacto.png`.
- Marca compacta: `public/golunch-mark.png`.
- Logotipo Hyundai Glovis: `public/glovis-logo.png`.
- Flujo real de empleado: `public/pedido.html` y `routes/pedido.js`.
- Reglas de menú, corte, zonas y turnos: `services/menu.js` y `services/pedidos.js`.
- No hay fotografías verificadas de platillos; el producto no debe inventarlas.

## Product Principles

1. Mostrar siempre la fecha real del servicio y el estado real del pedido.
2. Reducir cada decisión a una acción clara y táctil en móvil.
3. Personalizar sin exponer datos personales innecesarios.
4. Mantener turno y zona visibles y editables porque cambian en la operación.
5. Nunca exigir volver a escanear el QR para actualizar el estado.

## Accessibility & Inclusion

La experiencia debe funcionar con teclado y lector de pantalla, mantener contraste legible bajo luz intensa, ofrecer objetivos táctiles amplios y respetar `prefers-reduced-motion`.
