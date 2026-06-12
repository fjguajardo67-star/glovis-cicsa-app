// services/whatsapp.js — Envío de mensajes a la WhatsApp Cloud API
const API_VERSION = 'v21.0';

function apiUrl() {
  return `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_ID}/messages`;
}

async function enviar(payload) {
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[WhatsApp] Error al enviar:', res.status, err);
    throw new Error(`WhatsApp API ${res.status}: ${err}`);
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
