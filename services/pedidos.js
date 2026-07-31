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
export async function estadoDelDia() {
  const fecha = await fechaServicio();
  if (!fecha) {
    return { abierto: false, motivo: 'sin_menu', fecha: null, menu: null, corte: horaCorteTexto() };
  }
  const menu = await db.getMenu(fecha);
  if (!menu) {
    return { abierto: false, motivo: 'sin_menu', fecha: null, menu: null, corte: horaCorteTexto() };
  }
  const abierto = dentroDeHorario();
  return {
    abierto,
    motivo: abierto ? null : 'fuera_de_horario',
    fecha,
    fecha_legible: fechaLegible(fecha),
    menu,
    corte: horaCorteTexto()
  };
}

// ── Registrar (o cambiar) el pedido ───────────────────────────────
// `zona` y `turno` son opcionales: si no vienen, se heredan de la asignación
// que dio RRHH. Mandarlos explícitamente es el caso de quien cubre otro turno,
// y solo afecta a ese pedido — el registro del empleado no se toca.
export async function crearPedido({ telefono, numero_empleado, opcion_id, zona, turno }) {
  const empleado = await identificar({ telefono, numero_empleado });
  if (!empleado) {
    return rechazo('no_registrado',
      'No estás registrado en el sistema de comedor CICSA. Contacta a Recursos Humanos.');
  }

  if (!dentroDeHorario()) {
    return rechazo('fuera_de_horario',
      `Los pedidos cerraron a las ${horaCorteTexto()}. Vuelve mañana para pedir el siguiente día.`);
  }

  const fecha = await fechaServicio();
  const menu  = fecha ? await db.getMenu(fecha) : null;
  if (!menu) {
    return rechazo('sin_menu',
      'Aún no se ha publicado el menú del próximo día de servicio. Intenta más tarde.');
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

  const pedido = await db.upsertPedido({
    fecha_menu:        fecha,
    empleado_telefono: empleado.telefono,   // formato canónico del registro
    opcion_id,
    opcion_texto:      textoDeOpcion(menu, opcion_id),
    zona:              zonaFinal,
    turno:             turnoFinal
  });

  return {
    ok: true,
    fecha,
    fecha_legible: fechaLegible(fecha),
    pedido,
    empleado: { nombre: empleado.nombre, numero_empleado: empleado.numero_empleado },
    // Textos ya resueltos, para que cada canal solo los acomode
    resumen: {
      platillo: pedido.opcion_texto,
      zona:     textoDeZona(zonaFinal),
      turno:    textoDeTurno(turnoFinal),
      corte:    horaCorteTexto()
    }
  };
}
