// index.js — Servidor principal de Go Lunch (comedor CICSA · Glovis)
import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';
import { pedidoRouter } from './routes/pedido.js';
import { entregaRouter } from './routes/entrega.js';
import { resumenCocina, htmlComanda, etiquetas, htmlEtiquetas, iniciarCronCocina } from './services/cocina.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — permite que el panel admin (GitHub Pages) consuma la API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Capturar el body crudo — necesario para validar la firma de Meta (HMAC)
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.disable('x-powered-by');

// Páginas estáticas: el panel, la página del empleado y la app de entrega.
// Railway es el hosting: el subdominio del cliente apunta aquí y esto se sirve
// en la raíz, así que las direcciones NO llevan /public/.
app.use(express.static('public'));

// La raíz manda a pedir. Es la dirección que alguien teclea cuando se la
// dictan de boca, y de las ~115 personas que la tocarían, 112 son empleados
// que van a pedir; el panel y la app de entrega tienen su propia dirección y
// vienen documentadas en el manual. Antes esto caía en un 404 en crudo.
app.get('/', (req, res) => res.redirect(302, '/pedido.html'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'go-lunch', ts: new Date().toISOString() });
});
// Diagnóstico. Exige ADMIN_KEY: revela detalles de la infraestructura y
// SUPABASE_KEY es la llave de service-role, que no debe asomarse en público
// ni por fragmentos.
function soloAdmin(req, res, next) {
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.get('/debug', soloAdmin, async (req, res) => {
  const url = process.env.SUPABASE_URL;
  res.json({
    url_set: !!url,
    key_set: !!process.env.SUPABASE_KEY,
    url_preview: url ? url.slice(0, 30) : 'vacía'
  });
});
app.get('/test-supabase', soloAdmin, async (req, res) => {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data, error } = await sb.from('empleados').select('count');
    if (error) return res.json({ ok: false, error: error.message, code: error.code });

    // Qué ve el servidor en la tabla de menús: la causa más común de que la
    // página del empleado muestre "sin menú publicado" es no tener ninguno
    // con fecha futura.
    const { DateTime } = await import('luxon');
    const tz = process.env.TZ || 'America/Mexico_City';
    const ahora = DateTime.now().setZone(tz);
    const { data: menus, error: e2 } = await sb
      .from('menus').select('fecha').order('fecha', { ascending: false }).limit(10);

    res.json({
      ok: true,
      empleados: data,
      hora_servidor: ahora.toFormat('yyyy-LL-dd HH:mm'),
      tz_configurada: process.env.TZ || '(no definida, usando default)',
      manana: ahora.plus({ days: 1 }).toISODate(),
      menus_error: e2?.message || null,
      menus_ultimos: (menus || []).map(m => m.fecha)
    });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// Webhook de WhatsApp (Meta). El canal se enciende a propósito con
// WHATSAPP_ENABLED=on; mientras esté apagado la ruta ni siquiera se monta y
// responde 404, en vez de quedar escuchando una integración que nadie usa.
// Hoy el comedor opera por la web, así que lo normal es que esté apagado.
if (process.env.WHATSAPP_ENABLED === 'on') {
  app.use('/webhook', webhookRouter);
  console.log('[WhatsApp] Canal ENCENDIDO: /webhook montado');
} else {
  console.log('[WhatsApp] Canal apagado (WHATSAPP_ENABLED != on): /webhook no montado');
}

// Entregas: acepta ENTREGA_KEY (clave del repartidor) o ADMIN_KEY.
// Montada ANTES de /api para que su regla de clave gane a la del panel.
app.use('/api/entrega', entregaRouter);

// API del panel de administración (protegida con ADMIN_KEY)
app.use('/api', adminRouter);

// API pública de la página del empleado (identifica por número de empleado)
app.use('/pedido', pedidoRouter);

// Comanda de cocina imprimible (HTML). Se abre en el navegador con:
//   /comanda/2026-07-20?key=ADMIN_KEY
// Usa ?key= en lugar del header x-admin-key para poder abrirse directo
// desde el navegador y mandarse a imprimir.
app.get('/comanda/:fecha', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).send('No autorizado');
  }
  const fecha = req.params.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).send('Fecha inválida — usa el formato YYYY-MM-DD');
  }
  try {
    const resumen = await resumenCocina(fecha);
    res.type('html').send(htmlComanda(resumen));
  } catch (err) {
    console.error('[Comanda] Error:', err);
    res.status(500).send('Error generando la comanda');
  }
});

// Etiquetas para pegar en cada contenedor:
//   /etiquetas/2026-08-03?key=ADMIN_KEY&ancho=57&alto=32
// El tamaño va por parámetro porque depende del rollo que se compre, y
// &modo=hoja imprime en papel carta para validar la medida sin gastar rollo.
app.get('/etiquetas/:fecha', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).send('No autorizado');
  }
  const fecha = req.params.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).send('Fecha inválida — usa el formato YYYY-MM-DD');
  }

  // Límites sensatos: fuera de este rango no es una etiqueta de comedor
  const num = (v, def, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  };

  try {
    const datos = await etiquetas(fecha, {
      ancho: num(req.query.ancho, 57, 20, 210),
      alto:  num(req.query.alto,  32, 15, 297),
      modo:  req.query.modo === 'hoja' ? 'hoja' : 'rollo',
      qr:    req.query.qr !== 'no'
    });
    res.type('html').send(htmlEtiquetas(datos));
  } catch (err) {
    console.error('[Etiquetas] Error:', err);
    res.status(500).send('Error generando las etiquetas');
  }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Red de seguridad, no permiso para escribir código descuidado. Node cierra el
// proceso ante un rechazo sin capturar; aquí eso significa cortarle la sesión al
// repartidor a media ruta y vaciarle la cola por un error que quizá afectaba a
// una sola petición. Se registra fuerte y se sigue de pie: para el comedor,
// seguir sirviendo vale más que morir limpio. Cada handler debe seguir teniendo
// su propio try/catch — esto es lo que atrapa al que se nos escape.
process.on('unhandledRejection', (razon) => {
  console.error('[CICSA] Rechazo sin capturar (el proceso sigue):', razon);
});
process.on('uncaughtException', (err) => {
  console.error('[CICSA] Excepción sin capturar (el proceso sigue):', err);
});

app.listen(PORT, () => {
  console.log(`[CICSA] Servidor corriendo en puerto ${PORT}`);
  console.log(`[CICSA] Zona horaria: ${process.env.TZ || 'no definida'}`);
  if (!process.env.ENTREGA_SESSION_SECRET) {
    console.warn('[CICSA] ADVERTENCIA: ENTREGA_SESSION_SECRET no está configurada — ' +
                 'los repartidores no podrán entrar con su clave personal.');
  }
  iniciarCronCocina();
});
