// services/menu.js — Lógica de horario y construcción del menú
import { DateTime } from 'luxon';

const ZONA = process.env.TZ || 'America/Mexico_City';
const HORA_CORTE = 20; // 20:00 hrs (8:00 PM)

// Etiquetas legibles de cada opción
export const OPCION_LABELS = {
  fija_a: 'Opción A',
  fija_b: 'Opción B',
  fija_c: 'Opción C',
  var_1: 'Variable 1',
  var_2: 'Variable 2',
  var_3: 'Variable 3'
};

export const OPCIONES_VALIDAS = Object.keys(OPCION_LABELS);

// Zonas de entrega
export const ZONAS = {
  zona_vdc:    'Glovis VDC',
  zona_refris: 'Glovis REFRIS'
};
export const ZONAS_VALIDAS = Object.keys(ZONAS);

// Turnos
export const TURNOS = {
  turno_a: 'Turno A — 10:00 am',
  turno_b: 'Turno B — 5:00 pm'
};
export const TURNOS_VALIDOS = Object.keys(TURNOS);

// ── Puntualidad de la entrega ─────────────────────────────────
// Hora programada de cada turno y la tolerancia acordada. La ruta tarda en
// recorrer sus puntos, así que sin tolerancia el final del recorrido saldría
// tardío aunque vaya en tiempo. 15 min es acuerdo interno, no contractual.
export const TURNO_HORA = { turno_a: '10:00', turno_b: '17:00' };
export const TOLERANCIA_TARDIA_MIN = 15;

// Momento a partir del cual una entrega de ese turno cuenta como tardía
export function limiteEntrega(fechaISO, turno) {
  const hora = TURNO_HORA[turno];
  if (!hora || !fechaISO) return null;
  const d = DateTime.fromISO(`${fechaISO}T${hora}`, { zone: ZONA });
  return d.isValid ? d.plus({ minutes: TOLERANCIA_TARDIA_MIN }) : null;
}

// ¿La entrega fue tardía? null si no hay datos para saberlo.
export function esEntregaTardia(fechaISO, turno, entregadoEn) {
  if (!entregadoEn) return null;
  const limite = limiteEntrega(fechaISO, turno);
  if (!limite) return null;
  const e = DateTime.fromISO(entregadoEn, { zone: ZONA });
  return e.isValid ? e > limite : null;
}

// Motivos que puede elegir el chofer cuando la entrega sale tardía.
// El id se guarda en la base; el texto es lo que ve y lo que se reporta.
export const MOTIVOS_TARDIA = {
  acceso_puerto:  'Acceso o caseta del puerto',
  trafico:        'Tráfico o maniobras en ruta',
  cliente_ausente:'Cliente no estaba en el punto',
  cocina:         'Cocina entregó tarde',
  vehiculo:       'Falla del vehículo',
  clima:          'Clima',
  otro:           'Otro'
};
export const MOTIVOS_TARDIA_VALIDOS = Object.keys(MOTIVOS_TARDIA);

// Fecha de hoy en la zona del comedor (YYYY-MM-DD)
export function hoy() {
  return DateTime.now().setZone(ZONA).toISODate();
}

// Fecha civil de hace N días en la zona del comedor. Existe para no volver a
// escribir `new Date(Date.now() - n*864e5).toISOString().slice(0,10)`, que
// convierte a UTC y a partir de las 18:00 locales corre el borde un día.
export function hoyMenos(dias) {
  return DateTime.now().setZone(ZONA).minus({ days: dias }).toISODate();
}

// Fecha de mañana en la zona del comedor (YYYY-MM-DD)
export function manana() {
  return DateTime.now().setZone(ZONA).plus({ days: 1 }).toISODate();
}

// ¿Estamos dentro del horario para pedir? (antes de las 20:00)
export function dentroDeHorario() {
  const ahora = DateTime.now().setZone(ZONA);
  return ahora.hour < HORA_CORTE;
}

export function horaCorteTexto() {
  return '8:00 PM';
}

// "2026-07-27" → "lunes 27 de julio". Nunca decimos "mañana": cuando el
// servicio salta un fin de semana o un festivo, la fecha real evita el
// malentendido de que el pedido es para el día siguiente.
export function fechaLegible(fechaISO) {
  const d = DateTime.fromISO(fechaISO, { zone: ZONA }).setLocale('es');
  return d.isValid ? d.toFormat("cccc d 'de' LLLL") : fechaISO;
}

// PASO 1 — Menú del día
export function construirListMessage(telefono, nombre, menu) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: '🍽️ COMEDOR CICSA' },
      body: {
        text: `Hola ${nombre}. Selecciona tu opción de menú para mañana.\nEl sistema cierra a las ${horaCorteTexto()}.`
      },
      footer: { text: 'Servicio de alimentación CICSA' },
      action: {
        button: 'Ver Menú del Día',
        sections: [
          {
            title: '📌 OPCIONES FIJAS',
            rows: [
              { id: 'fija_a', title: 'Opción A', description: recorta(menu.fija_a) },
              { id: 'fija_b', title: 'Opción B', description: recorta(menu.fija_b) },
              { id: 'fija_c', title: 'Opción C', description: recorta(menu.fija_c) }
            ]
          },
          {
            title: '✨ VARIACIONES DEL DÍA',
            rows: [
              { id: 'var_1', title: 'Variable 1', description: recorta(menu.var_1) },
              { id: 'var_2', title: 'Variable 2', description: recorta(menu.var_2) },
              { id: 'var_3', title: 'Variable 3', description: recorta(menu.var_3) }
            ]
          }
        ]
      }
    }
  };
}

// PASO 2 — Selección de zona
export function construirListZona(telefono, opcionTexto) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: '📍 Zona de entrega' },
      body: {
        text: `Seleccionaste: *${opcionTexto}*\n\n¿En qué zona recibirás tu pedido?`
      },
      footer: { text: 'Servicio de alimentación CICSA' },
      action: {
        button: 'Seleccionar zona',
        sections: [{
          title: 'ZONAS DISPONIBLES',
          rows: [
            { id: 'zona_vdc',    title: 'Glovis VDC',    description: 'Zona 1' },
            { id: 'zona_refris', title: 'Glovis REFRIS',  description: 'Zona 2' }
          ]
        }]
      }
    }
  };
}

// PASO 3 — Selección de turno
export function construirListTurno(telefono, opcionTexto, zonaTexto) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: '🕐 Turno de entrega' },
      body: {
        text: `Platillo: *${opcionTexto}*\nZona: *${zonaTexto}*\n\n¿En qué turno recibirás tu pedido?`
      },
      footer: { text: 'Servicio de alimentación CICSA' },
      action: {
        button: 'Seleccionar turno',
        sections: [{
          title: 'TURNOS DISPONIBLES',
          rows: [
            { id: 'turno_a', title: 'Turno A', description: 'Entrega: 10:00 am' },
            { id: 'turno_b', title: 'Turno B', description: 'Entrega: 5:00 pm'  }
          ]
        }]
      }
    }
  };
}

// WhatsApp limita description a 72 caracteres
function recorta(texto) {
  const t = (texto || '').toString();
  return t.length > 72 ? t.slice(0, 69) + '...' : t;
}

// Dado un menu y un opcion_id, devuelve el texto del platillo
export function textoDeOpcion(menu, opcionId) {
  return menu[opcionId] || OPCION_LABELS[opcionId] || opcionId;
}

export function textoDeZona(zonaId) {
  return ZONAS[zonaId] || zonaId;
}

export function textoDeTurno(turnoId) {
  return TURNOS[turnoId] || turnoId;
}
