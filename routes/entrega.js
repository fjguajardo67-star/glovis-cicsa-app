// routes/entrega.js — API de confirmación de entregas (escaneo del QR)
//
// Va separada de /api porque su clave es distinta: el repartidor usa
// ENTREGA_KEY, que solo sirve para esto. Si el teléfono se pierde o la
// persona cambia, se rota ENTREGA_KEY en Railway sin tocar la ADMIN_KEY.
// La ADMIN_KEY también se acepta, para que el panel siga funcionando.

import express from 'express';
import * as db from '../services/supabase.js';

export const entregaRouter = express.Router();

entregaRouter.use((req, res, next) => {
  const clave = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY no configurada en el servidor' });
  }
  const valida =
    clave === process.env.ADMIN_KEY ||
    (process.env.ENTREGA_KEY && clave === process.env.ENTREGA_KEY);
  if (!valida) return res.status(401).json({ error: 'No autorizado' });
  next();
});

// La página de reparto descarga esto al salir y luego trabaja sin señal.
entregaRouter.get('/:fecha', async (req, res) => {
  try {
    const pedidos = await db.getPedidosPorFecha(req.params.fecha);
    res.json({
      fecha: req.params.fecha,
      total: pedidos.length,
      entregados: pedidos.filter(p => p.entregado_en).length,
      pedidos: pedidos.map(p => ({
        numero_empleado: p.empleados?.numero_empleado || null,
        nombre:          p.empleados?.nombre || null,
        platillo:        p.opcion_texto,
        zona:            p.zona,
        turno:           p.turno,
        entregado_en:    p.entregado_en || null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronización por lotes: el reparto ocurre sin señal, así que llegan
// varias entregas juntas cuando el vehículo recupera cobertura. Cada una
// se responde por separado para que la app sepa cuáles reintentar.
entregaRouter.post('/', async (req, res) => {
  try {
    const { fecha, entregas } = req.body || {};
    if (!fecha || !Array.isArray(entregas)) {
      return res.status(400).json({ error: 'Se requieren fecha y entregas[]' });
    }

    const resultados = [];
    for (const e of entregas) {
      const numero = e?.numero_empleado;
      if (!numero) { resultados.push({ numero_empleado: null, ok: false, motivo: 'sin_numero' }); continue; }
      try {
        const r = await db.marcarEntregado(fecha, numero, e.entregado_en || new Date().toISOString());
        resultados.push({
          numero_empleado: numero,
          ok: r.ok,
          motivo: r.motivo || null,
          nombre: r.pedido?.empleados?.nombre || null
        });
      } catch (err) {
        resultados.push({ numero_empleado: numero, ok: false, motivo: 'error_servidor', detalle: err.message });
      }
    }

    res.json({ fecha, confirmadas: resultados.filter(r => r.ok).length, resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
