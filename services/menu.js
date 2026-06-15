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

// Fecha de hoy en la zona del comedor (YYYY-MM-DD)
export function hoy() {
  return DateTime.now().setZone(ZONA).toISODate();
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
