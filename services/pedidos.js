// services/pedidos.js — Reglas del pedido, comunes a WhatsApp y a la web
//
// Aquí vive la única definición de qué es un pedido válido: quién puede pedir,
// para qué día, hasta qué hora y con qué opciones. Los dos canales entran por
// esta misma puerta, así que las reglas no pueden desincronizarse entre ellos.
//
// Cuando Meta apruebe la verificación y WhatsApp vuelva a ser el canal
// principal, este archivo no cambia: solo se le suma otro canal que lo llama.

import * as db from './supabase.js';
import {
  manana, dentroDeHorario, horaCorteTexto, fechaLegible,
  textoDeOpcion, textoDeZona, textoDeTurno,
  OPCIONES_VALIDAS, ZONAS_VALIDAS, TURNOS_VALIDOS
} from './menu.js';

// Los rechazos traen un `motivo` para que el código decida, y un `mensaje`
// en español listo para mostrarse: WhatsApp lo manda tal cual y la web lo
// pinta en pantalla. Así el texto vive en un solo lugar.
function rechazo(motivo, mensaje) {
  return { ok: false, motivo, mensaje };
}

// Cliente virtual para recorrer la página fuera del horario operativo. No vive
// en Supabase: identificarlo no crea una fila de acceso y confirmar su pedido
// devuelve el mismo recibo que producción, pero sin escribir en `pedidos`.
// El número no es un secreto ni una puerta trasera; solo funciona cuando la
// petición declara explícitamente el modo de prueba.
export const CLIENTE_PRUEBA = Object.freeze({
  nombre: 'CLIENTE DE PRUEBA',
  numero_empleado: 'PRUEBA',
  zona_default: null,
  turno_default: null,
  es_prueba: true
});

export function esClientePrueba(numeroEmpleado) {
  return String(numeroEmpleado || '').trim().toUpperCase() === CLIENTE_PRUEBA.numero_empleado;
}

// ── Fecha de servicio ─────────────────────────────────────────────
// El próximo día con menú publicado, no literalmente "mañana". Así los fines
// de semana y los días festivos se resuelven solos, sin calendario laboral en
// el código: publicar el menú es lo que declara que ese día hay servicio.
// La llave foránea de `pedidos.fecha_menu` ya garantizaba esta regla en la
// base de datos; esto solo hace que el código pregunte lo mismo.
export async function fechaServicio() {
  return db.getProximaFechaConMenu(manana());
}

// ── Identificar al empleado ───────────────────────────────────────
// Por teléfono (WhatsApp) o por número de empleado (página web).
export async function identificar({ telefono, numero_empleado }) {
  if (telefono) return db.getEmpleado(telefono);
  if (numero_empleado) return db.getEmpleadoPorNumero(numero_empleado);
  return null;
}

// ── Estado del día: qué puede pedir el empleado y hasta cuándo ─────
// Lo consume la página web al abrirse y sirve para pintar la pantalla
// completa (fecha, menú, si está abierto) en una sola llamada.
export async function estadoDelDia({ modoPrueba = false } = {}) {
  const fecha = await fechaServicio();
  if (!fecha) {
    const estado = { abierto: false, motivo: 'sin_menu', fecha: null, menu: null, corte: horaCorteTexto() };
    return modoPrueba ? { ...estado, modo_prueba: true } : estado;
  }
  const menu = await db.getMenu(fecha);
  if (!menu) {
    const estado = { abierto: false, motivo: 'sin_menu', fecha: null, menu: null, corte: horaCorteTexto() };
    return modoPrueba ? { ...estado, modo_prueba: true } : estado;
  }
  // El modo de prueba necesita recorrer el menú después del corte. La
  // excepción solo cambia esta respuesta; el POST vuelve a exigir que el
  // número sea el cliente virtual y nunca escribe el pedido.
  const abierto = modoPrueba || dentroDeHorario();
  const estado = {
    abierto,
    motivo: abierto ? null : 'fuera_de_horario',
    fecha,
    fecha_legible: fechaLegible(fecha),
    menu,
    corte: horaCorteTexto()
  };
  return modoPrueba ? { ...estado, modo_prueba: true } : estado;
}

async function validarEleccion({ empleado, opcion_id, zona, turno, fecha_esperada, ignorarHorario = false }) {
  if (!ignorarHorario && !dentroDeHorario()) {
    return rechazo('fuera_de_horario',
      `Los pedidos cerraron a las ${horaCorteTexto()}. Vuelve mañana para pedir el siguiente día.`);
  }

  const fecha = await fechaServicio();
  const menu  = fecha ? await db.getMenu(fecha) : null;
  if (!menu) {
    return rechazo('sin_menu',
      'Aún no se ha publicado el menú del próximo día de servicio. Intenta más tarde.');
  }

  if (fecha_esperada && fecha_esperada !== fecha) {
    return {
      ...rechazo('estado_desactualizado',
        'El menú cambió mientras tenías la página abierta. Vuelve a elegir tu platillo del día correcto.'),
      fecha_esperada, fecha_actual: fecha
    };
  }

  if (!OPCIONES_VALIDAS.includes(opcion_id)) {
    return rechazo('opcion_invalida', 'Esa opción de menú no existe. Vuelve a elegir tu platillo.');
  }

  const zonaFinal  = zona  || empleado.zona_default;
  const turnoFinal = turno || empleado.turno_default;

  if (!ZONAS_VALIDAS.includes(zonaFinal)) {
    return rechazo('zona_invalida', 'Falta indicar la zona de entrega.');
  }
  if (!TURNOS_VALIDOS.includes(turnoFinal)) {
    return rechazo('turno_invalido', 'Falta indicar el turno de entrega.');
  }

  return { ok: true, fecha, menu, zonaFinal, turnoFinal };
}

function respuestaPedido({ empleado, pedido, fecha, zonaFinal, turnoFinal, modoPrueba = false }) {
  const respuesta = {
    ok: true,
    fecha,
    fecha_legible: fechaLegible(fecha),
    pedido,
    empleado: { nombre: empleado.nombre, numero_empleado: empleado.numero_empleado },
    resumen: {
      platillo: pedido.opcion_texto,
      zona:     textoDeZona(zonaFinal),
      turno:    textoDeTurno(turnoFinal),
      corte:    horaCorteTexto()
    }
  };
  return modoPrueba
    ? { ...respuesta, modo_prueba: true, persistido: false }
    : respuesta;
}

// ── Registrar (o cambiar) el pedido ───────────────────────────────
// `zona` y `turno` son opcionales: si no vienen, se heredan de la asignación
// que dio RRHH. Mandarlos explícitamente es el caso de quien cubre otro turno,
// y solo afecta a ese pedido — el registro del empleado no se toca.
// `fecha_esperada` es la fecha que el cliente TENÍA EN PANTALLA al elegir.
//
// Sin ella, una pestaña abierta de un día para otro guardaba un pedido que
// nadie hizo: el servidor recalcula la fecha de servicio y saca el texto del
// platillo del menú de ESA fecha, mientras que el cliente solo manda
// `opcion_id`, que es un número de casilla y no un platillo. Reproducido: se
// ve "22 de agosto · Hamburguesa", se confirma al día siguiente y se guarda
// "23 de agosto · Pescado empanizado", con un 200 y sin una sola advertencia.
// Pide una cosa, le llega otra, y no se entera ninguno de los dos.
// (Hallazgo GL-004 de la auditoría.)
//
// Es OPCIONAL en esta función a propósito: WhatsApp entra por aquí sin
// pantalla que se pueda quedar vieja, así que no tiene qué declarar. Quien la
// exige es la ruta web (routes/pedido.js), que sí tiene ese riesgo.
export async function crearPedido({ telefono, numero_empleado, opcion_id, zona, turno, fecha_esperada }) {
  const empleado = await identificar({ telefono, numero_empleado });
  if (!empleado) {
    return rechazo('no_registrado',
      'No estás registrado en el sistema de comedor CICSA. Contacta a Recursos Humanos.');
  }

  const validacion = await validarEleccion({ empleado, opcion_id, zona, turno, fecha_esperada });
  if (!validacion.ok) return validacion;
  const { fecha, menu, zonaFinal, turnoFinal } = validacion;

  const pedido = await db.upsertPedido({
    fecha_menu:        fecha,
    empleado_telefono: empleado.telefono,   // formato canónico del registro
    opcion_id,
    opcion_texto:      textoDeOpcion(menu, opcion_id),
    zona:              zonaFinal,
    turno:             turnoFinal
  });

  return respuestaPedido({ empleado, pedido, fecha, zonaFinal, turnoFinal });
}

// Recorre la misma validación de fecha, menú, opción, zona y turno que un
// pedido real. Solo difiere en dos puntos deliberados: ignora el corte y no
// llama a Supabase. Por eso puede demostrarse hoy sin aparecer mañana en la
// comanda ni esperar a que llegue su fecha de servicio.
export async function crearPedidoPrueba({ numero_empleado, opcion_id, zona, turno, fecha_esperada }) {
  if (!esClientePrueba(numero_empleado)) {
    return rechazo('no_registrado', 'El modo de prueba solo está disponible para el cliente de prueba.');
  }

  const empleado = CLIENTE_PRUEBA;
  const validacion = await validarEleccion({
    empleado, opcion_id, zona, turno, fecha_esperada, ignorarHorario: true
  });
  if (!validacion.ok) return validacion;
  const { fecha, menu, zonaFinal, turnoFinal } = validacion;

  const pedido = {
    id: null,
    fecha_menu: fecha,
    empleado_telefono: null,
    opcion_id,
    opcion_texto: textoDeOpcion(menu, opcion_id),
    zona: zonaFinal,
    turno: turnoFinal,
    creado_en: new Date().toISOString(),
    es_prueba: true
  };

  return respuestaPedido({
    empleado, pedido, fecha, zonaFinal, turnoFinal, modoPrueba: true
  });
}
