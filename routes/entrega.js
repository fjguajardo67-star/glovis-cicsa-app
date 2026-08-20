// routes/entrega.js — API de confirmación de entregas (escaneo del QR)
//
// Va separada de /api porque su clave es distinta: el repartidor usa
// ENTREGA_KEY, que solo sirve para esto. Si el teléfono se pierde o la
// persona cambia, se rota ENTREGA_KEY en Railway sin tocar la ADMIN_KEY.
// La ADMIN_KEY también se acepta, para que el panel siga funcionando.

import express from 'express';
import * as db from '../services/supabase.js';
import {
  MOTIVOS_TARDIA, MOTIVOS_TARDIA_VALIDOS,
  TURNO_HORA, TOLERANCIA_TARDIA_MIN,
  ZONAS_VALIDAS
} from '../services/menu.js';

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
// Con ?zona= devuelve solo esa ruta, para que dos repartidores trabajen a la
// vez sin verse las listas. Sin zona devuelve todo, como siempre: la versión
// anterior de la app sigue funcionando.
entregaRouter.get('/:fecha', async (req, res) => {
  try {
    const zona = req.query.zona || null;
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }

    const todos = await db.getPedidosPorFecha(req.params.fecha);
    const pedidos = zona ? todos.filter(p => p.zona === zona) : todos;

    // Índice de TODAS las zonas del día, no solo la activa: es lo que permite
    // que el equipo distinga "este número no existe" de "este pedido es de la
    // otra ruta" estando sin señal. Solo número y zona — ningún dato personal.
    const indice_zonas = {};
    for (const p of todos) {
      const n = p.empleados?.numero_empleado;
      if (n) indice_zonas[n] = p.zona || null;
    }

    res.json({
      fecha: req.params.fecha,
      zona,
      total: pedidos.length,
      entregados: pedidos.filter(p => p.entregado_en).length,
      indice_zonas,
      // La app las necesita para decidir si una entrega salió tardía y pedir
      // el motivo estando SIN SEÑAL, sin volver a preguntarle al servidor.
      turno_hora: TURNO_HORA,
      tolerancia_min: TOLERANCIA_TARDIA_MIN,
      motivos_tardia: MOTIVOS_TARDIA,
      pedidos: pedidos.map(p => ({
        numero_empleado: p.empleados?.numero_empleado || null,
        nombre:          p.empleados?.nombre || null,
        platillo:        p.opcion_texto,
        zona:            p.zona,
        turno:           p.turno,
        entregado_en:    p.entregado_en || null,
        motivo_tardia:   p.motivo_tardia || null
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
    const { fecha, zona, entregas } = req.body || {};
    if (!fecha || !Array.isArray(entregas)) {
      return res.status(400).json({ error: 'Se requieren fecha y entregas[]' });
    }
    // La zona es opcional a propósito: los escaneos que quedaron en la cola de
    // la versión anterior no la traen, y rechazarlos perdería entregas reales.
    // Cuando SÍ viene, se verifica contra la base y no se confía en el filtro
    // del teléfono.
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }

    const resultados = [];
    for (const e of entregas) {
      const numero = e?.numero_empleado;
      if (!numero) { resultados.push({ numero_empleado: null, ok: false, motivo: 'sin_numero' }); continue; }
      // Un motivo inventado no se guarda: solo los del catálogo
      const motivo = MOTIVOS_TARDIA_VALIDOS.includes(e?.motivo_tardia) ? e.motivo_tardia : null;
      try {
        // La zona del elemento manda sobre la del lote: así un escaneo viejo
        // sin zona viaja sin verificar aunque el lote sí la declare.
        const zonaItem = e?.zona !== undefined ? e.zona : zona;
        const r = await db.marcarEntregado(
          fecha, numero, e.entregado_en || new Date().toISOString(), motivo, zonaItem || null
        );
        resultados.push({
          numero_empleado: numero,
          ok: r.ok,
          // Viaja para que el equipo pueda decir "este pedido es de la otra
          // ruta" en vez de "no existe", que es lo que veía antes.
          zona_esperada: r.zona_esperada || null,
          // Un reintento sobre algo ya entregado viaja como ok con esta marca:
          // la cola del teléfono se vacía y queda constancia de que la hora
          // guardada es la de la primera confirmación, no la de este reintento.
          ya_entregado: r.ya_entregado || false,
          motivo: r.motivo || null,
          nombre: r.pedido?.empleados?.nombre || null,
          entregado_en: r.pedido?.entregado_en || null
        });
      } catch (err) {
        resultados.push({ numero_empleado: numero, ok: false, motivo: 'error_servidor', detalle: err.message });
      }
    }

    res.json({ fecha, zona: zona || null, confirmadas: resultados.filter(r => r.ok).length, resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
