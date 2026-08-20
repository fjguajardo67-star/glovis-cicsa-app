// routes/admin.js — API REST para el panel de administración
import express from 'express';
import { DateTime } from 'luxon';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import { construirListMessage, esEntregaTardia, MOTIVOS_TARDIA, limiteEntrega, hoy } from '../services/menu.js';
import { diezDigitos } from '../services/telefono.js';
import { resumenCocina } from '../services/cocina.js';
import { fechaServicio } from '../services/pedidos.js';
import { hashClave, generarClave } from '../services/sesion.js';

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

// Corregir el teléfono conservando el historial de pedidos.
// Va aparte del POST de alta porque ese hace upsert por teléfono: capturar el
// número bueno ahí no edita al empleado, da de alta uno nuevo.
adminRouter.put('/empleados/:telefono/telefono', async (req, res) => {
  try {
    const nuevo = req.body?.telefono_nuevo;
    if (diezDigitos(nuevo).length !== 10) {
      return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
    }
    const r = await db.cambiarTelefonoEmpleado(req.params.telefono, nuevo);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// ── Repartidores ────────────────────────────────────────────────
// Todo este bloque va bajo ADMIN_KEY, que es lo que protege al router. La
// clave del repartidor se asigna aquí: él no crea la suya, y en ninguna
// respuesta viaja el hash — las consultas piden columnas explícitas.
const ZONAS_REPARTO = ['zona_vdc', 'zona_refris'];

function zonasLimpias(zonas) {
  if (!Array.isArray(zonas)) return null;
  const z = [...new Set(zonas)].filter(x => ZONAS_REPARTO.includes(x));
  return z.length ? z : null;
}

// Largo mínimo cuando la clave la escribe el administrador. Las generadas
// traen 8 caracteres; el riesgo está en la escrita a mano con prisa, que sin
// esto podía ser "1". El límite de intentos ayuda, pero no salva a una clave
// de tres dígitos. Devuelve el motivo para que el panel lo pueda explicar.
const CLAVE_MINIMA = 6;
function claveElegida(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return { usar: null };   // que la genere el servidor
  const limpia = valor.trim();
  if (limpia.length < CLAVE_MINIMA) {
    return { error: `La clave debe tener al menos ${CLAVE_MINIMA} caracteres. Déjala vacía para que se genere una.` };
  }
  return { usar: limpia };
}

adminRouter.get('/repartidores', async (req, res) => {
  try {
    res.json({ repartidores: await db.listRepartidores() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/repartidores', async (req, res) => {
  try {
    const { nombre, zonas, clave } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'Se requiere el nombre' });
    }
    const z = zonasLimpias(zonas);
    if (!z) return res.status(400).json({ error: 'Se requiere al menos una zona válida', zonas_validas: ZONAS_REPARTO });

    // Si el administrador no escribe una, se genera legible para dictarla.
    const elegida = claveElegida(clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    const repartidor = await db.crearRepartidor({
      nombre: String(nombre).trim(), zonas: z, clave_hash: await hashClave(enClaro)
    });
    // La clave viaja UNA sola vez, aquí, y nunca se vuelve a poder consultar:
    // en la base solo queda el hash.
    res.json({ ok: true, repartidor, clave: enClaro });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/repartidores/:id', async (req, res) => {
  try {
    const { nombre, zonas, activo } = req.body || {};
    const cambios = {};
    if (nombre !== undefined) {
      if (!String(nombre).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      cambios.nombre = String(nombre).trim();
    }
    if (zonas !== undefined) {
      const z = zonasLimpias(zonas);
      if (!z) return res.status(400).json({ error: 'Se requiere al menos una zona válida', zonas_validas: ZONAS_REPARTO });
      cambios.zonas = z;
    }
    if (activo !== undefined) cambios.activo = !!activo;

    const repartidor = await db.actualizarRepartidor(req.params.id, cambios);
    // Desactivar tiene que cerrar la sesión que ya estaba abierta: si el
    // equipo se perdió, dejar de poder entrar mañana no sirve de nada.
    if (activo === false) await db.invalidarSesiones(req.params.id);
    res.json({ ok: true, repartidor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restablecer clave. No existe "ver la clave actual" a propósito: solo hay
// hash, y poder recuperarla querría decir que no está bien guardada.
adminRouter.post('/repartidores/:id/clave', async (req, res) => {
  try {
    const elegida = claveElegida(req.body?.clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    await db.actualizarRepartidor(req.params.id, { clave_hash: await hashClave(enClaro) });
    // Cambiar la clave cierra las sesiones abiertas con la anterior.
    const repartidor = await db.invalidarSesiones(req.params.id);
    res.json({ ok: true, repartidor, clave: enClaro });
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

// Mínimo de opiniones para publicar un porcentaje de aprobación. La
// calificación cuelga del PEDIDO, no del guisado: un "no me gustó" puede estar
// castigando comida fría o una entrega tardía, y eso no se corrige con más
// muestras. Por eso el dato sirve para levantar la mano sobre un platillo, no
// para decidir solo, y por debajo de este número se muestran las respuestas
// en crudo en vez de un porcentaje que invita a decidir.
const MIN_OPINIONES = 5;

// ── Reportes por periodo ────────────────────────────────────────
// Un solo endpoint alimenta todas las vistas: pedidos por día, porciones por
// platillo, rating, cumplimiento de entrega y las tres preguntas de operación
// (quién no recoge, merma por turno y zona, tiempos de ruta).
adminRouter.get('/reportes', async (req, res) => {
  try {
    const { ini, fin } = req.query;
    if (!ini || !fin) return res.status(400).json({ error: 'Se requieren ini y fin (YYYY-MM-DD)' });

    const pedidos = await db.getPedidosRango(ini, fin);

    const porDia = {}, porPlatillo = {}, porPlatilloRating = {};
    const rating = { si: 0, tal_vez: 0, no: 0, sin_responder: 0 };
    let entregados = 0, tardios = 0, noEntregados = 0, pendientes = 0;
    const motivos = {};

    // Merma y recurrencia solo cuentan pedidos que YA se pudieron recoger. Un
    // pedido de hoy a las 9 am no es merma: todavía no le toca. Se usa el mismo
    // límite que marca las entregas tardías (hora del turno + tolerancia).
    const hoyISO = hoy();
    const porEmpleado = {}, mermaTurno = {}, mermaZona = {}, rutas = {};

    const acumula = (mapa, clave, seEntrego) => {
      const c = mapa[clave] || (mapa[clave] = { evaluables: 0, entregados: 0, no_recogidos: 0 });
      c.evaluables++;
      if (seEntrego) c.entregados++; else c.no_recogidos++;
    };

    for (const p of pedidos) {
      porDia[p.fecha_menu] = (porDia[p.fecha_menu] || 0) + 1;

      const plat = p.opcion_texto || p.opcion_id;
      porPlatillo[plat] = (porPlatillo[plat] || 0) + 1;

      if (['si', 'tal_vez', 'no'].includes(p.rating)) rating[p.rating]++;
      else rating.sin_responder++;

      // La encuesta pregunta por UN platillo, así que la respuesta se guarda
      // junto a su platillo. Antes solo existía el total del periodo, que no
      // contesta la única pregunta que justifica preguntar: cuál quitar.
      // Se cuentan aparte los entregados, porque solo un platillo entregado
      // se pudo calificar: es el denominador honesto de la participación.
      const c = porPlatilloRating[plat] || (porPlatilloRating[plat] = {
        platillo: plat, porciones: 0, entregados: 0, si: 0, tal_vez: 0, no: 0
      });
      c.porciones++;
      if (p.entregado_en) c.entregados++;
      if (['si', 'tal_vez', 'no'].includes(p.rating)) c[p.rating]++;

      // Sin turno no hay hora de entrega que vencer (pedidos viejos de
      // WhatsApp): se da por vencido cuando el día ya pasó.
      const limite = limiteEntrega(p.fecha_menu, p.turno);
      const yaVencio = limite ? DateTime.now() > limite : p.fecha_menu < hoyISO;

      if (yaVencio) {
        acumula(mermaTurno, p.turno || 'sin_turno', !!p.entregado_en);
        acumula(mermaZona,  p.zona  || 'sin_zona',  !!p.entregado_en);

        const emp = p.empleados || {};
        const clave = emp.numero_empleado || p.empleado_telefono;
        const e = porEmpleado[clave] || (porEmpleado[clave] = {
          numero_empleado: emp.numero_empleado || '',
          nombre: emp.nombre || '(empleado dado de baja)',
          pedidos: 0, no_recogidos: 0
        });
        e.pedidos++;
        if (!p.entregado_en) e.no_recogidos++;
      } else if (!p.entregado_en) {
        pendientes++;
      }

      if (!p.entregado_en) { noEntregados++; continue; }

      // Tiempos de ruta: la primera y la última entrega de cada turno de cada
      // día. No hay marca de "salió el vehículo", así que la ruta se mide entre
      // escaneos, que es lo que de verdad se registra.
      const t = DateTime.fromISO(p.entregado_en);
      if (t.isValid) {
        const k = p.fecha_menu + '|' + (p.turno || 'sin_turno');
        const r = rutas[k] || (rutas[k] = {
          fecha: p.fecha_menu, turno: p.turno || 'sin_turno',
          entregas: 0, primera: t, ultima: t
        });
        r.entregas++;
        if (t < r.primera) r.primera = t;
        if (t > r.ultima)  r.ultima  = t;
      }

      if (esEntregaTardia(p.fecha_menu, p.turno, p.entregado_en)) {
        tardios++;
        const m = p.motivo_tardia || 'sin_motivo';
        motivos[m] = (motivos[m] || 0) + 1;
      } else {
        entregados++;
      }
    }

    const pct = (parte, total) => total ? Math.round((parte / total) * 1000) / 10 : 0;
    const hhmm = d => d.setZone('America/Mexico_City').toFormat('HH:mm');

    const filasMerma = mapa => Object.entries(mapa)
      .map(([clave, c]) => ({ clave, ...c, pct_merma: pct(c.no_recogidos, c.evaluables) }))
      .sort((a, b) => b.no_recogidos - a.no_recogidos);

    const rutaPorDia = Object.values(rutas)
      .map(r => ({
        fecha: r.fecha, turno: r.turno, entregas: r.entregas,
        primera: hhmm(r.primera), ultima: hhmm(r.ultima),
        minutos: Math.round(r.ultima.diff(r.primera, 'minutes').minutes)
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.turno.localeCompare(b.turno));

    // Promedio de duración por turno. Un día con una sola entrega dura 0
    // minutos y aplanaría el promedio, así que no cuenta como ruta.
    const acumTurno = {};
    for (const r of rutaPorDia) {
      if (r.entregas < 2) continue;
      const a = acumTurno[r.turno] || (acumTurno[r.turno] = { dias: 0, minutos: 0 });
      a.dias++;
      a.minutos += r.minutos;
    }

    res.json({
      ini, fin, total: pedidos.length,
      // Ordenados para graficar sin que el cliente tenga que hacerlo
      pedidos_por_dia: Object.entries(porDia).sort().map(([fecha, n]) => ({ fecha, pedidos: n })),
      porciones_por_platillo: Object.entries(porPlatillo)
        .sort((a, b) => b[1] - a[1]).map(([platillo, n]) => ({ platillo, porciones: n })),
      rating,
      // Qué platillo gustó y cuál no. La aprobación pesa las tres respuestas
      // en una sola cifra comparable —"me gustó" vale 100, "estuvo bien" 50,
      // "no me gustó" 0— y se ordena de peor a mejor, porque la decisión que
      // alimenta es cuál sacar del menú. Los platillos que nadie calificó van
      // al final con aprobación nula: no se puede juzgar lo que no se opinó,
      // y ponerlos en 0 los haría parecer los peores.
      rating_por_platillo: Object.values(porPlatilloRating)
        .map(c => {
          const respondidos = c.si + c.tal_vez + c.no;
          return {
            ...c,
            respondidos,
            sin_calificar: Math.max(0, c.entregados - respondidos),
            // Entero y no decimales: un 37.5% sobre cuatro opiniones aparenta
            // una precisión que el dato no tiene.
            aprobacion: respondidos
              ? Math.round((c.si * 100 + c.tal_vez * 50) / respondidos)
              : null,
            // Debajo de este mínimo la cifra no se publica como porcentaje: se
            // muestran las respuestas en crudo. Un platillo con dos opiniones
            // no debe encabezar una decisión de menú solo por salir en 0%.
            muestra_corta: respondidos > 0 && respondidos < MIN_OPINIONES,
            participacion: c.entregados ? pct(respondidos, c.entregados) : 0
          };
        })
        // Arriba lo que sí se puede leer —peor calificado primero—, luego lo de
        // muestra corta y al final lo que nadie opinó. Así la cabeza de la
        // tabla siempre es material de decisión y no ruido con pocas respuestas.
        .sort((a, b) => {
          const grupo = x => x.respondidos === 0 ? 2 : (x.muestra_corta ? 1 : 0);
          const ga = grupo(a), gb = grupo(b);
          if (ga !== gb) return ga - gb;
          if (ga === 0) return a.aprobacion - b.aprobacion || b.respondidos - a.respondidos;
          if (ga === 1) return b.respondidos - a.respondidos;
          return b.porciones - a.porciones;
        }),
      min_opiniones: MIN_OPINIONES,
      // pendientes = ya pedidos pero cuya hora de entrega aún no llega; van
      // dentro de no_entregados y por eso se informan aparte.
      entrega: { entregados, tardios, no_entregados: noEntregados, pendientes },
      motivos_tardia: Object.entries(motivos)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ motivo: MOTIVOS_TARDIA[id] || 'Sin motivo indicado', veces: n })),

      sin_recoger: Object.values(porEmpleado)
        .filter(e => e.no_recogidos > 0)
        .map(e => ({ ...e, pct: pct(e.no_recogidos, e.pedidos) }))
        .sort((a, b) => b.no_recogidos - a.no_recogidos || b.pct - a.pct),
      merma: {
        por_turno: filasMerma(mermaTurno).map(f => ({ turno: f.clave, ...f, clave: undefined })),
        por_zona:  filasMerma(mermaZona).map(f  => ({ zona:  f.clave, ...f, clave: undefined }))
      },
      ruta: {
        por_dia: rutaPorDia,
        promedio_por_turno: Object.entries(acumTurno)
          .map(([turno, a]) => ({ turno, dias: a.dias, minutos_promedio: Math.round(a.minutos / a.dias) }))
          .sort((a, b) => a.turno.localeCompare(b.turno))
      }
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
    // Quién abrió la app ese día. Si la tabla todavía no existe en la base, el
    // dashboard sigue funcionando como antes en vez de caerse entero.
    let accesos = [];
    try { accesos = await db.getAccesosPorFecha(fecha); } catch {}
    const accesoPorTel = {};
    accesos.forEach(a => { accesoPorTel[diezDigitos(a.empleado_telefono)] = a; });

    const pedidoPorTel = {};
    pedidos.forEach(p => { pedidoPorTel[diezDigitos(p.empleado_telefono)] = p; });

    // Una fila por empleado activo. El estado sale de un solo hecho: el
    // escaneo del QR al entregar (entregado_en). No hay estados intermedios.
    const filas = empleados.map(emp => {
      const p = pedidoPorTel[diezDigitos(emp.telefono)];
      const acc = accesoPorTel[diezDigitos(emp.telefono)];
      if (!p) {
        // Dos cosas muy distintas que antes se veían igual: mirar el menú y no
        // pedir es una decisión; no abrir la app siquiera es no haberse
        // enterado. La primera se arregla en la cocina, la segunda con el QR.
        return { nombre: emp.nombre, numero_empleado: emp.numero_empleado,
                 platillo: null, zona: null, turno: null,
                 entregado_en: null, motivo_tardia: null,
                 visto_en: acc?.visto_en || null, veces: acc?.veces || 0,
                 estado: acc ? 'vio_no_ordeno' : 'no_abrio' };
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
        visto_en: acc?.visto_en || null,
        veces: acc?.veces || 0,
        estado: !p.entregado_en ? 'pendiente' : (tardia ? 'tardia' : 'entregado')
      };
    });

    const cuenta = e => filas.filter(f => f.estado === e).length;
    res.json({
      fecha,
      resumen: {
        activos:     filas.length,
        ordenaron:   filas.filter(f => f.estado !== 'no_ordeno' && f.estado !== 'vio_no_ordeno' && f.estado !== 'no_abrio').length,
        no_ordenaron: cuenta('no_ordeno') + cuenta('vio_no_ordeno') + cuenta('no_abrio'),
        // El desglose que separa un problema de cocina de uno de difusión.
        vieron_no_ordenaron: cuenta('vio_no_ordeno'),
        no_abrieron:         cuenta('no_abrio'),
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
