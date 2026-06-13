// index.js — Servidor principal CICSA Comedor
import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — permite que el panel admin (GitHub Pages) consuma la API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://fjguajardo67-star.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
  const allowed = [
    'https://fjguajardo67-star.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.disable('x-powered-by');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cicsa-comedor', ts: new Date().toISOString() });
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
