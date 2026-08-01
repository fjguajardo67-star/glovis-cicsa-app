// index.js — Servidor principal CICSA Comedor
import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';
import { pedidoRouter } from './routes/pedido.js';
import { resumenCocina, htmlComanda, iniciarCronCocina } from './services/cocina.js';

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

// Páginas estáticas (panel admin y página del empleado). GitHub Pages sigue
// siendo el hosting principal; esto permite servirlas también desde Railway.
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cicsa-comedor', ts: new Date().toISOString() });
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

// Webhook de WhatsApp (Meta)
app.use('/webhook', webhookRouter);

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

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[CICSA] Servidor corriendo en puerto ${PORT}`);
  console.log(`[CICSA] Zona horaria: ${process.env.TZ || 'no definida'}`);
  iniciarCronCocina();
});
