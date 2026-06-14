// index.js — Servidor principal CICSA Comedor
import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cicsa-comedor', ts: new Date().toISOString() });
});
// Diagnóstico temporal Supabase
app.get('/debug', async (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  res.json({
    url_set: !!url,
    key_set: !!key,
    url_preview: url ? url.slice(0,30) : 'vacía',
    key_preview: key ? key.slice(0,20) : 'vacía'
  });
});

// Webhook de WhatsApp (Meta)
app.use('/webhook', webhookRouter);

// API del panel de administración
app.use('/api', adminRouter);

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
});
