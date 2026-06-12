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

// Construye el payload del List Message de WhatsApp con el menú dado
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

// WhatsApp limita description a 72 caracteres
function recorta(texto) {
  const t = (texto || '').toString();
  return t.length > 72 ? t.slice(0, 69) + '...' : t;
}

// Dado un menu y un opcion_id, devuelve el texto del platillo
export function textoDeOpcion(menu, opcionId) {
  return menu[opcionId] || OPCION_LABELS[opcionId] || opcionId;
}
