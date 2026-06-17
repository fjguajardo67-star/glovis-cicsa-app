// routes/webhook.js — Recibe y procesa los mensajes de WhatsApp
import express from 'express';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import {
  manana, dentroDeHorario, horaCorteTexto,
  construirListMessage, construirListZona, construirListTurno,
  textoDeOpcion, textoDeZona, textoDeTurno,
  OPCIONES_VALIDAS, ZONAS_VALIDAS, TURNOS_VALIDOS
} from '../services/menu.js';

export const webhookRouter = express.Router();

// ── Estado en memoria (una instancia Railway) ─────────────────
// { telefono: { paso: 'zona'|'turno', opcion_id, opcion_texto, zona_id, zona_texto } }
const sesiones = new Map();

const EXPIRACION_MS = 10 * 60 * 1000; // 10 minutos sin actividad

function getSesion(telefono) {
  const s = sesiones.get(telefono);
  if (!s) return null;
  if (Date.now() - s.ts > EXPIRACION_MS) { sesiones.delete(telefono); return null; }
  return s;
}

function setSesion(telefono, datos) {
  sesiones.set(telefono, { ...datos, ts: Date.now() });
}

function delSesion(telefono) {
  sesiones.delete(telefono);
}

// ── Verificación del webhook (GET) ────────────────────────────
webhookRouter.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[Webhook] Verificado correctamente');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verificación fallida');
  return res.sendStatus(403);
});

// ── Recepción de mensajes (POST) ──────────────────────────────
webhookRouter.post('/', async (req, res) => {
  res.sendStatus(200); // responder inmediato para que Meta no reintente

  try {
    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const mensaje = value?.messages?.[0];

    if (!mensaje) return;

    const telefono = mensaje.from;
    await procesarMensaje(telefono, mensaje);
  } catch (err) {
    console.error('[Webhook] Error procesando mensaje:', err);
  }
});

// ── Procesamiento principal ───────────────────────────────────
async function procesarMensaje(telefono, mensaje) {

  // PASO 1 — Identificar al empleado
  let empleado;
  try {
    empleado = await db.getEmpleado(telefono);
  } catch (err) {
    console.error('[Webhook] Error buscando empleado:', err);
    return;
  }

  if (!empleado) {
    await wa.enviarTexto(telefono,
      'No estás registrado en el sistema de comedor CICSA. Contacta a Recursos Humanos.');
    return;
  }

  // PASO 2 — Evaluar horario
  if (!dentroDeHorario()) {
    delSesion(telefono);
    await wa.enviarTexto(telefono,
      `Lo sentimos, el sistema de pedidos cerró a las ${horaCorteTexto()}. No se registraron cambios.`);
    return;
  }

  // PASO 3 — Leer selección interactiva
  const seleccion = mensaje?.interactive?.list_reply?.id;
  const sesion    = getSesion(telefono);

  // ── CASO: eligió un platillo (viene del menú) ─────────────
  if (seleccion && OPCIONES_VALIDAS.includes(seleccion)) {
    const fecha = manana();
    const menu  = await db.getMenu(fecha);
    if (!menu) {
      await wa.enviarTexto(telefono, 'El menú de mañana ya no está disponible. Contacta al comedor.');
      return;
    }
    const opcionTexto = textoDeOpcion(menu, seleccion);
    setSesion(telefono, { paso: 'zona', opcion_id: seleccion, opcion_texto: opcionTexto });
    await wa.enviarListMessage(construirListZona(telefono, opcionTexto));
    return;
  }

  // ── CASO: eligió una zona ─────────────────────────────────
  if (seleccion && ZONAS_VALIDAS.includes(seleccion) && sesion?.paso === 'zona') {
    const zonaTexto = textoDeZona(seleccion);
    setSesion(telefono, { ...sesion, paso: 'turno', zona_id: seleccion, zona_texto: zonaTexto });
    await wa.enviarListMessage(construirListTurno(telefono, sesion.opcion_texto, zonaTexto));
    return;
  }

  // ── CASO: eligió un turno → registrar pedido completo ─────
  if (seleccion && TURNOS_VALIDOS.includes(seleccion) && sesion?.paso === 'turno') {
    await registrarPedido(telefono, empleado, sesion, seleccion);
    delSesion(telefono);
    return;
  }

  // ── CASO: cualquier texto libre → mostrar menú del día ────
  delSesion(telefono); // reiniciar si había sesión previa
  await enviarMenuDelDia(telefono, empleado);
}

// ── Enviar menú ───────────────────────────────────────────────
async function enviarMenuDelDia(telefono, empleado) {
  const fecha = manana();
  const menu  = await db.getMenu(fecha);

  if (!menu) {
    await wa.enviarTexto(telefono,
      'Aún no se ha publicado el menú de mañana. Intenta más tarde.');
    return;
  }

  await wa.enviarListMessage(construirListMessage(telefono, empleado.nombre, menu));
}

// ── Registrar pedido completo ─────────────────────────────────
async function registrarPedido(telefono, empleado, sesion, turnoId) {
  const fecha      = manana();
  const turnoTexto = textoDeTurno(turnoId);

  await db.upsertPedido({
    fecha_menu:        fecha,
    empleado_telefono: empleado.telefono,  // usar el tel registrado (formato canónico)
    opcion_id:         sesion.opcion_id,
    opcion_texto:      sesion.opcion_texto,
    zona:              sesion.zona_id,
    turno:             turnoId
  });

  await wa.enviarTexto(telefono,
    `✅ Pedido registrado para mañana:\n\n` +
    `🍽️ ${sesion.opcion_texto}\n` +
    `📍 ${sesion.zona_texto}\n` +
    `🕐 ${turnoTexto}\n\n` +
    `Puedes cambiarlo antes de las ${horaCorteTexto()} enviando cualquier mensaje.`
  );
}
