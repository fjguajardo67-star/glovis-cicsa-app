// routes/webhook.js — Recibe y procesa los mensajes de WhatsApp
import express from 'express';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import {
  manana, dentroDeHorario, horaCorteTexto,
  construirListMessage, textoDeOpcion, OPCIONES_VALIDAS
} from '../services/menu.js';

export const webhookRouter = express.Router();

// ── Verificación del webhook (GET) — Meta lo llama al configurar ──
webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[Webhook] Verificado correctamente');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verificación fallida');
  return res.sendStatus(403);
});

// ── Recepción de mensajes (POST) ──────────────────────────────────
webhookRouter.post('/', async (req, res) => {
  // Responder 200 de inmediato para que Meta no reintente
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];

    if (!mensaje) return; // status updates u otros eventos

    const telefono = mensaje.from;
    await procesarMensaje(telefono, mensaje);
  } catch (err) {
    console.error('[Webhook] Error procesando mensaje:', err);
  }
});

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
    await wa.enviarTexto(telefono,
      `Lo sentimos, el sistema de pedidos cerró a las ${horaCorteTexto()}. No se registraron cambios.`);
    return;
  }

  // PASO 3 — Tipo de mensaje
  const seleccion = mensaje?.interactive?.list_reply?.id;

  if (seleccion && OPCIONES_VALIDAS.includes(seleccion)) {
    // CASO B — El empleado seleccionó una opción
    await registrarPedido(telefono, empleado, seleccion);
  } else {
    // CASO A — Cualquier texto → enviar el menú de mañana
    await enviarMenuDelDia(telefono, empleado);
  }
}

async function enviarMenuDelDia(telefono, empleado) {
  const fecha = manana();
  const menu = await db.getMenu(fecha);

  if (!menu) {
    await wa.enviarTexto(telefono,
      'Aún no se ha publicado el menú de mañana. Intenta más tarde.');
    return;
  }

  const payload = construirListMessage(telefono, empleado.nombre, menu);
  await wa.enviarListMessage(payload);
}

async function registrarPedido(telefono, empleado, opcionId) {
  const fecha = manana();
  const menu = await db.getMenu(fecha);

  if (!menu) {
    await wa.enviarTexto(telefono,
      'El menú de mañana ya no está disponible. Contacta al comedor.');
    return;
  }

  const opcionTexto = textoDeOpcion(menu, opcionId);

  await db.upsertPedido({
    fecha_menu: fecha,
    empleado_telefono: telefono,
    opcion_id: opcionId,
    opcion_texto: opcionTexto
  });

  await wa.enviarTexto(telefono,
    `✅ Pedido registrado: ${opcionTexto}\n\nPuedes cambiarlo antes de las ${horaCorteTexto()} enviando cualquier mensaje.`);
}
