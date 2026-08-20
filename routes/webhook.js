// routes/webhook.js — Recibe y procesa los mensajes de WhatsApp
import express from 'express';
import crypto from 'node:crypto';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import * as pedidos from '../services/pedidos.js';
import {
  dentroDeHorario, horaCorteTexto,
  construirListMessage, construirListZona, construirListTurno,
  textoDeOpcion, textoDeZona,
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

// ── Validación de firma HMAC (X-Hub-Signature-256) ────────────
// Meta firma cada POST con APP_SECRET. Sin esta validación, cualquiera
// que conozca la URL puede inyectar pedidos falsos.
function firmaValida(req) {
  const secret = process.env.APP_SECRET;
  // Sin secreto NO se puede verificar nada, así que se rechaza. Antes esto
  // devolvía true "para no estorbar mientras Meta no estaba conectado", y el
  // resultado era que cualquiera que supiera la URL podía mandar una secuencia
  // de platillo→zona→turno y escribir pedidos reales en la misma tabla de
  // producción. Un canal que no se puede autenticar se cierra, no se abre.
  if (!secret) {
    console.warn('[Webhook] APP_SECRET no configurado — se rechaza la petición');
    return false;
  }
  const firma = req.headers['x-hub-signature-256'];
  if (!firma || !req.rawBody) return false;

  const esperada = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Deduplicación: Meta reintenta si no ve el 200 a tiempo ────
const mensajesProcesados = new Map(); // message_id → ts
const DEDUP_TTL_MS = 10 * 60 * 1000;

function yaProcesado(msgId) {
  if (!msgId) return false;
  const ahora = Date.now();
  // Limpieza de entradas viejas
  for (const [id, ts] of mensajesProcesados) {
    if (ahora - ts > DEDUP_TTL_MS) mensajesProcesados.delete(id);
  }
  if (mensajesProcesados.has(msgId)) return true;
  mensajesProcesados.set(msgId, ahora);
  return false;
}

// ── Recepción de mensajes (POST) ──────────────────────────────
webhookRouter.post('/', async (req, res) => {
  if (!firmaValida(req)) {
    console.warn('[Webhook] Firma HMAC inválida — petición rechazada');
    return res.sendStatus(403);
  }

  res.sendStatus(200); // responder inmediato para que Meta no reintente

  try {
    const entry  = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    // Actualizaciones de estado de mensajes enviados (sent/delivered/read/failed)
    const statuses = value?.statuses;
    if (Array.isArray(statuses)) {
      for (const st of statuses) {
        try {
          await db.actualizarEstadoEnvioPorMsgId(st.id, st.status);
        } catch (err) {
          console.error('[Webhook] Error actualizando estado de envío:', err.message);
        }
      }
    }

    const mensaje = value?.messages?.[0];
    if (!mensaje) return;
    if (yaProcesado(mensaje.id)) {
      console.log('[Webhook] Mensaje duplicado ignorado:', mensaje.id);
      return;
    }

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
    const estado = await pedidos.estadoDelDia();
    if (!estado.menu) {
      await wa.enviarTexto(telefono, 'El menú ya no está disponible. Contacta al comedor.');
      return;
    }
    const opcionTexto = textoDeOpcion(estado.menu, seleccion);
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
  const estado = await pedidos.estadoDelDia();

  if (!estado.menu) {
    await wa.enviarTexto(telefono,
      'Aún no se ha publicado el menú del próximo día de servicio. Intenta más tarde.');
    return;
  }

  await wa.enviarListMessage(construirListMessage(telefono, empleado.nombre, estado.menu));
}

// ── Registrar pedido completo ─────────────────────────────────
// Las reglas viven en services/pedidos.js; aquí solo queda el mensaje.
async function registrarPedido(telefono, empleado, sesion, turnoId) {
  const res = await pedidos.crearPedido({
    telefono:  empleado.telefono,   // el registrado, en formato canónico
    opcion_id: sesion.opcion_id,
    zona:      sesion.zona_id,
    turno:     turnoId
  });

  if (!res.ok) {
    await wa.enviarTexto(telefono, res.mensaje);
    return;
  }

  await wa.enviarTexto(telefono,
    `✅ Pedido registrado para el ${res.fecha_legible}:\n\n` +
    `🍽️ ${res.resumen.platillo}\n` +
    `📍 ${res.resumen.zona}\n` +
    `🕐 ${res.resumen.turno}\n\n` +
    `Puedes cambiarlo antes de las ${res.resumen.corte} enviando cualquier mensaje.`
  );
}
