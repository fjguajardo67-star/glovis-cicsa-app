// services/whatsapp.js — Envío de mensajes a la WhatsApp Cloud API
//
// Migración a producción: cuando Meta apruebe la verificación del negocio,
// solo hay que reemplazar en Railway los valores de:
//   WHATSAPP_TOKEN    → token permanente del System User
//   WHATSAPP_PHONE_ID → phone_number_id del número real del negocio
// No se requiere ningún cambio de código.

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v23.0';
const TIMEOUT_MS = 15000;

if (!process.env.WHATSAPP_TOKEN) {
  console.warn('[WhatsApp] ADVERTENCIA: WHATSAPP_TOKEN no está configurado — los envíos fallarán.');
}
if (!process.env.WHATSAPP_PHONE_ID) {
  console.warn('[WhatsApp] ADVERTENCIA: WHATSAPP_PHONE_ID no está configurado — los envíos fallarán.');
}

function apiUrl() {
  return `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_ID}/messages`;
}

async function enviar(payload) {
  let res;
  try {
    res = await fetch(apiUrl(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    // Error de red o timeout (no llegó respuesta de Meta)
    console.error(`[WhatsApp] Sin respuesta de la API (${err.name}): ${err.message}`);
    throw new Error(`WhatsApp API sin respuesta: ${err.message}`);
  }

  if (!res.ok) {
    const cuerpo = await res.text();
    let metaError = null;
    try { metaError = JSON.parse(cuerpo)?.error; } catch { /* respuesta no-JSON */ }

    const code = metaError?.code;
    const detalle = metaError?.message || cuerpo;

    if (code === 190) {
      console.error(
        '[WhatsApp] ❌ TOKEN INVÁLIDO O EXPIRADO (error 190). ' +
        'El token temporal de Meta expira en ~24h. Genera uno nuevo en ' +
        'developers.facebook.com → tu app → WhatsApp → API Setup, y actualiza ' +
        'WHATSAPP_TOKEN en Railway. (En producción esto se resuelve con el ' +
        'token permanente de System User.)'
      );
    } else if (code === 131030) {
      console.error(
        `[WhatsApp] ❌ Destinatario no permitido (error 131030): el número ${payload.to} ` +
        'no está en la lista de destinatarios de prueba. En modo Development solo ' +
        'se puede enviar a los números registrados en Meta (máx. 5).'
      );
    } else {
      console.error(`[WhatsApp] Error al enviar (HTTP ${res.status}, code ${code ?? 'n/a'}):`, detalle);
    }

    const e = new Error(`WhatsApp API ${res.status}${code ? ` (code ${code})` : ''}: ${detalle}`);
    e.metaCode = code;
    throw e;
  }

  return res.json();
}

// Envía un mensaje de texto simple
export async function enviarTexto(telefono, texto) {
  return enviar({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'text',
    text: { body: texto }
  });
}

// Envía un List Message (payload ya construido por menu.js)
export async function enviarListMessage(payload) {
  return enviar(payload);
}
