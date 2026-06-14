// routes/admin.js — API REST para el panel de administración
import express from 'express';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import { construirListMessage, hoy, manana, OPCION_LABELS } from '../services/menu.js';

export const adminRouter = express.Router();

// Protección simple por clave de administrador
adminRouter.use((req, res, next) => {
  const key = req.headers['x-admin-key'];
console.log('[AUTH]', JSON.stringify({key, adminKey: process.env.ADMIN_KEY, match: key === process.env.ADMIN_KEY}));

  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY no configurada en el servidor' });
  }
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
});

// ── Empleados ───────────────────────────────────────────────────

adminRouter.get('/empleados', async (req, res) => {
  try {
    res.json({ empleados: await db.listEmpleados() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/empleados', async (req, res) => {
  try {
    const { telefono, nombre, numero_empleado, activo } = req.body;
    if (!telefono || !nombre || !numero_empleado) {
      return res.status(400).json({ error: 'Faltan campos: telefono, nombre, numero_empleado' });
    }
    const emp = await db.upsertEmpleado({ telefono, nombre, numero_empleado, activo });
    res.json({ ok: true, empleado: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/empleados/:telefono/activo', async (req, res) => {
  try {
    const { activo } = req.body;
    const emp = await db.setEmpleadoActivo(req.params.telefono, !!activo);
    res.json({ ok: true, empleado: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Menús ───────────────────────────────────────────────────────

adminRouter.get('/menu/:fecha', async (req, res) => {
  try {
    const menu = await db.getMenu(req.params.fecha);
    res.json({ menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/menu', async (req, res) => {
  try {
    const { fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3 } = req.body;
    if (!fecha || !fija_a || !fija_b || !fija_c || !var_1 || !var_2 || !var_3) {
      return res.status(400).json({ error: 'Faltan campos del menú (se requieren las 6 opciones y la fecha)' });
    }
    const menu = await db.upsertMenu({ fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3 });
    res.json({ ok: true, menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pedidos ─────────────────────────────────────────────────────

adminRouter.get('/pedidos/:fecha', async (req, res) => {
  try {
    const pedidos = await db.getPedidosPorFecha(req.params.fecha);
    res.json({ fecha: req.params.fecha, count: pedidos.length, pedidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/pedidos', async (req, res) => {
  try {
    const { ini, fin } = req.query;
    if (!ini || !fin) return res.status(400).json({ error: 'Se requieren parámetros ini y fin (YYYY-MM-DD)' });
    const pedidos = await db.getPedidosRango(ini, fin);
    res.json({ ini, fin, count: pedidos.length, pedidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen para cocina: conteo por platillo de una fecha
adminRouter.get('/resumen-cocina/:fecha', async (req, res) => {
  try {
    const pedidos = await db.getPedidosPorFecha(req.params.fecha);
    const conteo = {};
    for (const p of pedidos) {
      conteo[p.opcion_texto] = (conteo[p.opcion_texto] || 0) + 1;
    }
    const total = pedidos.length;
    const resumen = Object.entries(conteo).map(([platillo, porciones]) => ({
      platillo,
      porciones,
      porcentaje: total ? Math.round((porciones / total) * 100) : 0
    }));
    res.json({ fecha: req.params.fecha, total, resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Envío masivo del menú a todos los empleados activos ──────────

adminRouter.post('/enviar-menu', async (req, res) => {
  try {
    const fecha = manana();
    const menu = await db.getMenu(fecha);
    if (!menu) return res.status(400).json({ error: `No hay menú publicado para ${fecha}` });

    const empleados = await db.listEmpleadosActivos();
    let enviados = 0, fallidos = 0;
    const errores = [];

    for (const emp of empleados) {
      try {
        const payload = construirListMessage(emp.telefono, emp.nombre, menu);
        await wa.enviarListMessage(payload);
        enviados++;
      } catch (err) {
        fallidos++;
        errores.push({ telefono: emp.telefono, error: err.message });
      }
    }

    res.json({ ok: true, fecha, enviados, fallidos, errores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
