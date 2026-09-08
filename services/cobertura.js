// services/cobertura.js — reglas del servicio de cobertura del segundo turno
//
// Este flujo es deliberadamente independiente de `pedidos`: se solicita el
// mismo día, lo hace un supervisor para varias personas y cada recipiente
// necesita su propio QR aunque el empleado ya tenga una comida regular.

import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { ZONA, ZONAS_VALIDAS } from './menu.js';

export const HORA_CORTE_COBERTURA = 15;
export const HORA_ENTREGA_COBERTURA = '17:00';
export const OPCIONES_COBERTURA = ['especial_1', 'especial_2', 'especial_3'];

export function ahoraCobertura() {
  return DateTime.now().setZone(ZONA);
}

export function fechaCobertura() {
  return ahoraCobertura().toISODate();
}

export function horarioCobertura() {
  const ahora = ahoraCobertura();
  const corte = ahora.startOf('day').set({ hour: HORA_CORTE_COBERTURA });
  return {
    fecha: ahora.toISODate(),
    abierto: ahora < corte,
    corte_iso: corte.toISO(),
    corte_texto: '3:00 PM',
    entrega_texto: '5:00 PM',
    minutos_restantes: Math.max(0, Math.ceil(corte.diff(ahora, 'minutes').minutes))
  };
}

function opcionesMenu(menu) {
  if (!menu) return [];
  return [
    { id: 'especial_1', texto: menu.opcion_1 },
    { id: 'especial_2', texto: menu.opcion_2 },
    { id: 'especial_3', texto: menu.opcion_3 }
  ];
}

export async function estadoSupervisor(supervisorId) {
  const horario = horarioCobertura();
  const [menu, solicitud] = await Promise.all([
    db.getMenuCobertura(horario.fecha),
    db.getSolicitudCobertura(supervisorId, horario.fecha)
  ]);
  const disponible = horario.abierto && menu?.activo === true;
  return {
    ...horario,
    abierto: disponible,
    motivo: !menu || !menu.activo ? 'sin_menu_especial' : (!horario.abierto ? 'fuera_de_horario' : null),
    menu: menu ? { fecha: menu.fecha, opciones: opcionesMenu(menu) } : null,
    solicitud
  };
}

function limpiarItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => ({
    numero_empleado: String(item?.numero_empleado || '').trim(),
    opcion_id: String(item?.opcion_id || '').trim()
  }));
}

export function validarSolicitudEntrada({ responsable_numero, zona, items }) {
  const limpios = limpiarItems(items);
  if (!String(responsable_numero || '').trim()) return { error: 'Indica el número de empleado responsable de recibir.' };
  if (!ZONAS_VALIDAS.includes(zona)) return { error: 'Selecciona VDC o REFRIS como zona de entrega.' };
  if (!limpios.length) return { error: 'Agrega al menos una persona y su alimento.' };
  if (limpios.some(x => !x.numero_empleado)) return { error: 'Todos los alimentos necesitan número de empleado.' };
  if (limpios.some(x => !OPCIONES_COBERTURA.includes(x.opcion_id))) return { error: 'Selecciona un platillo para cada empleado.' };
  const numeros = limpios.map(x => x.numero_empleado);
  if (new Set(numeros).size !== numeros.length) return { error: 'Un empleado aparece más de una vez en la solicitud.' };
  return { items: limpios };
}

export async function guardarSolicitud(supervisorId, entrada) {
  const horario = horarioCobertura();
  if (!horario.abierto) {
    const e = new Error('Las solicitudes de cobertura cerraron a las 3:00 PM.');
    e.status = 409; e.motivo = 'fuera_de_horario'; throw e;
  }
  const valida = validarSolicitudEntrada(entrada);
  if (valida.error) {
    const e = new Error(valida.error); e.status = 400; e.motivo = 'datos_invalidos'; throw e;
  }
  const folio = 'CE-' + horario.fecha.replaceAll('-', '') + '-' +
    crypto.randomBytes(3).toString('hex').toUpperCase();
  try {
    await db.guardarSolicitudCobertura({
      fecha: horario.fecha,
      supervisor_id: supervisorId,
      folio,
      responsable_numero: String(entrada.responsable_numero).trim(),
      zona: entrada.zona,
      items: valida.items
    });
    return db.getSolicitudCobertura(supervisorId, horario.fecha);
  } catch (err) {
    throw traducirErrorBD(err);
  }
}

export async function cancelarSolicitud(supervisorId) {
  const horario = horarioCobertura();
  if (!horario.abierto) {
    const e = new Error('La solicitud ya quedó cerrada para producción y no puede cancelarse desde la app.');
    e.status = 409; e.motivo = 'fuera_de_horario'; throw e;
  }
  const solicitud = await db.cancelarSolicitudCobertura(supervisorId, horario.fecha);
  if (!solicitud) {
    const e = new Error('No encontramos una solicitud activa para cancelar.');
    e.status = 404; e.motivo = 'sin_solicitud'; throw e;
  }
  return solicitud;
}

export function normalizarNombre(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function validarReceptorEscaneado(empleado, numero, nombre) {
  if (!numero || !nombre) return false;
  if (!empleado) return false;
  return String(empleado.numero_empleado) === String(numero).trim() &&
    normalizarNombre(empleado.nombre) === normalizarNombre(nombre);
}

function traducirErrorBD(err) {
  const bruto = String(err?.message || err || '');
  const casos = [
    ['cobertura_cerrada', 409, 'fuera_de_horario', 'Las solicitudes cerraron a las 3:00 PM.'],
    ['fecha_cobertura_invalida', 409, 'fecha_invalida', 'La cobertura solo puede solicitarse para hoy.'],
    ['supervisor_no_autorizado', 403, 'no_autorizado', 'Tu autorización de supervisor no está activa.'],
    ['responsable_no_encontrado', 404, 'responsable_no_encontrado', 'No encontramos al responsable en la plantilla activa.'],
    ['menu_cobertura_no_disponible', 409, 'sin_menu_especial', 'CICSA todavía no ha publicado el menú especial de hoy.'],
    ['sin_alimentos', 400, 'sin_alimentos', 'Agrega al menos un alimento.'],
    ['opcion_especial_invalida', 400, 'opcion_invalida', 'Uno de los platillos ya no está disponible. Actualiza la pantalla.'],
    ['empleados_repetidos:', 409, 'empleados_repetidos', 'Un empleado aparece más de una vez.'],
    ['empleados_no_encontrados:', 404, 'empleados_no_encontrados', 'Uno o más números no existen en la plantilla activa.'],
    ['empleados_ya_asignados:', 409, 'empleados_ya_asignados', 'Uno o más empleados ya tienen alimento de cobertura para hoy.'],
    ['solicitud_ya_entregada', 409, 'ya_entregada', 'Esta solicitud ya fue entregada y no puede modificarse.']
  ];
  const hallado = casos.find(([marca]) => bruto.includes(marca));
  const e = new Error(hallado ? hallado[3] : 'No se pudo guardar la solicitud de cobertura.');
  e.status = hallado ? hallado[1] : 500;
  e.motivo = hallado ? hallado[2] : 'error_servidor';
  if (hallado && bruto.includes(':')) e.detalle = bruto.split(':').slice(1).join(':').trim();
  return e;
}
