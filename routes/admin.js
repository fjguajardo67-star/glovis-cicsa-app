// routes/admin.js — API REST para el panel de administración
import express from 'express';
import { DateTime } from 'luxon';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import { construirListMessage, esEntregaTardia, MOTIVOS_TARDIA } from '../services/menu.js';
import { diezDigitos } from '../services/telefono.js';
import { resumenCocina } from '../services/cocina.js';
import { fechaServicio } from '../services/pedidos.js';

export const adminRouter = express.Router();

// Protección simple por clave de administrador
adminRouter.use((req, res, next) => {
  const key = req.headers['x-admin-key'];

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
    const { telefono, nombre, numero_empleado, activo, zona_default, turno_default } = req.body;
    if (!telefono || !nombre || !numero_empleado) {
      return res.status(400).json({ error: 'Faltan campos: telefono, nombre, numero_empleado' });
    }
    const emp = await db.upsertEmpleado({
      telefono, nombre, numero_empleado, activo, zona_default, turno_default
    });
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

adminRouter.delete('/empleados/:telefono', async (req, res) => {
  try {
    await db.deleteEmpleado(req.params.telefono);
    res.json({ ok: true });
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

// Próximos 7 días y si ya tienen menú. Ahora que "sin menú = sin servicio",
// olvidar publicar se vería idéntico a un día festivo: esta vista hace el
// olvido visible en el panel.
adminRouter.get('/menus-proximos', async (req, res) => {
  try {
    const tz = process.env.TZ || 'America/Mexico_City';
    const inicio = DateTime.now().setZone(tz).plus({ days: 1 });
    const fin = inicio.plus({ days: 6 });

    const publicadas = new Set(await db.getFechasConMenu(inicio.toISODate(), fin.toISODate()));

    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = inicio.plus({ days: i }).setLocale('es');
      dias.push({
        fecha: d.toISODate(),
        dia_semana: d.toFormat('ccc'),        // "lun", "mar", ...
        dia_num: d.day,
        publicado: publicadas.has(d.toISODate()),
        es_fin_de_semana: d.weekday >= 6
      });
    }
    res.json({ dias });
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

// Resumen para cocina: conteo por platillo (con desglose por turno y zona)
adminRouter.get('/resumen-cocina/:fecha', async (req, res) => {
  try {
    res.json(await resumenCocina(req.params.fecha));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reportes por periodo ────────────────────────────────────────
// Un solo endpoint alimenta las cuatro vistas: pedidos por día, porciones
// por platillo, rating y cumplimiento de entrega.
adminRouter.get('/reportes', async (req, res) => {
  try {
    const { ini, fin } = req.query;
    if (!ini || !fin) return res.status(400).json({ error: 'Se requieren ini y fin (YYYY-MM-DD)' });

    const pedidos = await db.getPedidosRango(ini, fin);

    const porDia = {}, porPlatillo = {}, rating = { si: 0, tal_vez: 0, no: 0, sin_responder: 0 };
    let entregados = 0, tardios = 0, noEntregados = 0;
    const motivos = {};

    for (const p of pedidos) {
      porDia[p.fecha_menu] = (porDia[p.fecha_menu] || 0) + 1;

      const plat = p.opcion_texto || p.opcion_id;
      porPlatillo[plat] = (porPlatillo[plat] || 0) + 1;

      if (['si', 'tal_vez', 'no'].includes(p.rating)) rating[p.rating]++;
      else rating.sin_responder++;

      if (!p.entregado_en) { noEntregados++; continue; }
      if (esEntregaTardia(p.fecha_menu, p.turno, p.entregado_en)) {
        tardios++;
        const m = p.motivo_tardia || 'sin_motivo';
        motivos[m] = (motivos[m] || 0) + 1;
      } else {
        entregados++;
      }
    }

    res.json({
      ini, fin, total: pedidos.length,
      // Ordenados para graficar sin que el cliente tenga que hacerlo
      pedidos_por_dia: Object.entries(porDia).sort().map(([fecha, n]) => ({ fecha, pedidos: n })),
      porciones_por_platillo: Object.entries(porPlatillo)
        .sort((a, b) => b[1] - a[1]).map(([platillo, n]) => ({ platillo, porciones: n })),
      rating,
      entrega: { entregados, tardios, no_entregados: noEntregados },
      motivos_tardia: Object.entries(motivos)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ motivo: MOTIVOS_TARDIA[id] || 'Sin motivo indicado', veces: n }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Envío masivo del menú a todos los empleados activos ──────────

adminRouter.post('/enviar-menu', async (req, res) => {
  try {
    const fecha = await fechaServicio();
    const menu = fecha ? await db.getMenu(fecha) : null;
    if (!menu) return res.status(400).json({ error: 'No hay ningún menú publicado a futuro' });

    const empleados = await db.listEmpleadosActivos();

    // Excluir a quienes ya tienen pedido registrado para mañana
    const pedidos = await db.getPedidosPorFecha(fecha);
    const yaPidieron = new Set(pedidos.map(p => diezDigitos(p.empleado_telefono)));
    const pendientes = empleados.filter(emp => !yaPidieron.has(diezDigitos(emp.telefono)));

    let enviados = 0, fallidos = 0;
    const errores = [];

    for (const emp of pendientes) {
      try {
        const payload = construirListMessage(emp.telefono, emp.nombre, menu);
        const resp = await wa.enviarListMessage(payload);
        // Intentar extraer el message_id (wamid) de la respuesta de WhatsApp
        const msgId = resp?.messages?.[0]?.id || null;
        enviados++;
        await db.registrarEnvio({
          fecha_menu: fecha,
          telefono: emp.telefono,
          nombre: emp.nombre,
          estado: 'enviado',
          message_id: msgId
        });
      } catch (err) {
        fallidos++;
        errores.push({ telefono: emp.telefono, error: err.message });
        await db.registrarEnvio({
          fecha_menu: fecha,
          telefono: emp.telefono,
          nombre: emp.nombre,
          estado: 'fallido',
          error: err.message
        }).catch(()=>{});
      }
    }

    res.json({
      ok: true,
      fecha,
      enviados,
      fallidos,
      omitidos: yaPidieron.size,
      total_activos: empleados.length,
      errores
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard de envíos: estado por empleado para una fecha ──────

adminRouter.get('/dashboard/:fecha', async (req, res) => {
  try {
    const fecha = req.params.fecha;
    const [empleados, pedidos] = await Promise.all([
      db.listEmpleadosActivos(),
      db.getPedidosPorFecha(fecha)
    ]);

    const pedidoPorTel = {};
    pedidos.forEach(p => { pedidoPorTel[diezDigitos(p.empleado_telefono)] = p; });

    // Una fila por empleado activo. El estado sale de un solo hecho: el
    // escaneo del QR al entregar (entregado_en). No hay estados intermedios.
    const filas = empleados.map(emp => {
      const p = pedidoPorTel[diezDigitos(emp.telefono)];
      if (!p) {
        return { nombre: emp.nombre, numero_empleado: emp.numero_empleado,
                 platillo: null, zona: null, turno: null,
                 entregado_en: null, motivo_tardia: null, estado: 'no_ordeno' };
      }
      const tardia = esEntregaTardia(fecha, p.turno, p.entregado_en);
      return {
        nombre: emp.nombre,
        numero_empleado: emp.numero_empleado,
        platillo: p.opcion_texto || p.opcion_id,
        zona: p.zona,
        turno: p.turno,
        entregado_en: p.entregado_en || null,
        motivo_tardia: p.motivo_tardia || null,
        estado: !p.entregado_en ? 'pendiente' : (tardia ? 'tardia' : 'entregado')
      };
    });

    const cuenta = e => filas.filter(f => f.estado === e).length;
    res.json({
      fecha,
      resumen: {
        activos:     filas.length,
        ordenaron:   filas.filter(f => f.estado !== 'no_ordeno').length,
        no_ordenaron: cuenta('no_ordeno'),
        entregados:  cuenta('entregado') + cuenta('tardia'),
        pendientes:  cuenta('pendiente'),
        tardias:     cuenta('tardia')
      },
      filas
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
