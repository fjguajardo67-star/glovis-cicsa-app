// services/cocina.js — Comanda de cocina: resumen por platillo y vista imprimible
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { manana, TURNOS, ZONAS } from './menu.js';

const ZONA_TZ = process.env.TZ || 'America/Mexico_City';

// ── Resumen agrupado por platillo para una fecha ────────────────
// Devuelve: { fecha, total, resumen: [{ platillo, porciones, por_turno, por_zona }] }
export async function resumenCocina(fecha) {
  const pedidos = await db.getPedidosPorFecha(fecha);
  const total = pedidos.length;

  const grupos = new Map(); // platillo → { porciones, por_turno, por_zona }
  for (const p of pedidos) {
    const platillo = p.opcion_texto || p.opcion_id;
    if (!grupos.has(platillo)) {
      grupos.set(platillo, { porciones: 0, por_turno: {}, por_zona: {} });
    }
    const g = grupos.get(platillo);
    g.porciones++;
    const turno = TURNOS[p.turno] || p.turno || 'Sin turno';
    const zona  = ZONAS[p.zona]   || p.zona  || 'Sin zona';
    g.por_turno[turno] = (g.por_turno[turno] || 0) + 1;
    g.por_zona[zona]   = (g.por_zona[zona]   || 0) + 1;
  }

  const resumen = [...grupos.entries()]
    .map(([platillo, g]) => ({
      platillo,
      porciones: g.porciones,
      porcentaje: total ? Math.round((g.porciones / total) * 100) : 0,
      por_turno: g.por_turno,
      por_zona: g.por_zona
    }))
    .sort((a, b) => b.porciones - a.porciones);

  return { fecha, total, resumen };
}

// ── HTML imprimible (impresora térmica o carta) ─────────────────
// Sin colores, fuente grande, una sección por turno (la cocina prepara
// cada turno por separado), con subtotal por turno y hora de generación.
export function htmlComanda({ fecha, total, resumen }) {
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat("dd/MM/yyyy HH:mm 'hrs'");

  // Reagrupar: turno → [{ platillo, porciones, por_zona }]
  const turnos = new Map();
  for (const r of resumen) {
    for (const [turno, n] of Object.entries(r.por_turno)) {
      if (!turnos.has(turno)) turnos.set(turno, []);
      turnos.get(turno).push({ platillo: r.platillo, porciones: n, por_zona: r.por_zona });
    }
  }
  // Orden fijo: Turno A antes que Turno B, "Sin turno" al final
  const ordenTurnos = [...Object.values(TURNOS), 'Sin turno'];
  const listaTurnos = [...turnos.keys()]
    .sort((a, b) => ordenTurnos.indexOf(a) - ordenTurnos.indexOf(b));

  const secciones = listaTurnos.map(turno => {
    const items = turnos.get(turno).sort((a, b) => b.porciones - a.porciones);
    const subtotal = items.reduce((s, i) => s + i.porciones, 0);
    const filas = items.map(i => `
      <div class="platillo">
        <div class="linea">
          <span class="nombre">${esc(i.platillo)}</span>
          <span class="cantidad">${i.porciones}</span>
        </div>
      </div>`).join('');
    return `
      <div class="turno-titulo">═══ ${esc(turno.toUpperCase())} ═══</div>
      ${filas}
      <div class="subtotal"><span>Subtotal turno</span><span>${subtotal}</span></div>
      <hr>`;
  }).join('');

  const vacio = `<p class="vacio">Sin pedidos registrados para esta fecha.</p><hr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comanda ${esc(fecha)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    color: #000;
    background: #fff;
    max-width: 420px;
    margin: 0 auto;
    padding: 16px 12px;
  }
  h1 { font-size: 20px; text-align: center; letter-spacing: 1px; }
  .sub { text-align: center; font-size: 14px; margin-top: 4px; }
  hr { border: none; border-top: 2px dashed #000; margin: 12px 0; }
  .turno-titulo { font-size: 16px; font-weight: bold; text-align: center; margin: 4px 0 12px; }
  .platillo { margin-bottom: 12px; }
  .linea { display: flex; justify-content: space-between; align-items: baseline; }
  .nombre { font-size: 17px; font-weight: bold; padding-right: 8px; }
  .cantidad { font-size: 22px; font-weight: bold; white-space: nowrap; }
  .subtotal { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-top: 8px; }
  .total { display: flex; justify-content: space-between; font-size: 19px; font-weight: bold; }
  .pie { font-size: 12px; text-align: center; margin-top: 12px; }
  .vacio { font-size: 15px; text-align: center; margin: 16px 0; }
  .no-print { text-align: center; margin-top: 20px; }
  .no-print button {
    font-family: inherit; font-size: 15px; padding: 8px 24px; cursor: pointer;
  }
  @media print {
    .no-print { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>COMANDA DE COCINA</h1>
  <div class="sub">CICSA — Glovis</div>
  <div class="sub">Fecha de servicio: <strong>${esc(fecha)}</strong></div>
  <hr>
  ${resumen.length ? secciones : vacio}
  <div class="total"><span>TOTAL PORCIONES</span><span>${total}</span></div>
  <hr>
  <div class="pie">Generada: ${generado}</div>
  <div class="no-print"><button onclick="window.print()">🖨️ Imprimir</button></div>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ── Cron interno: genera la comanda tras el corte de las 20:00 ──
// Activar con CRON_COCINA=on en Railway. Revisa cada minuto la hora local;
// al llegar a las 20:05 genera el resumen del día siguiente (fecha de
// servicio) y lo deja en los logs. Aquí mismo se puede enganchar después
// el envío por WhatsApp al chef o a un grupo.
let ultimaEjecucion = null;

export function iniciarCronCocina() {
  if (process.env.CRON_COCINA !== 'on') {
    console.log('[Cocina] Cron desactivado (define CRON_COCINA=on para activarlo)');
    return;
  }
  console.log('[Cocina] Cron activo: comanda automática a las 20:05', ZONA_TZ);
  setInterval(async () => {
    const ahora = DateTime.now().setZone(ZONA_TZ);
    const hoyISO = ahora.toISODate();
    if (ahora.hour === 20 && ahora.minute >= 5 && ultimaEjecucion !== hoyISO) {
      ultimaEjecucion = hoyISO;
      try {
        const r = await resumenCocina(manana());
        console.log(`[Cocina] Comanda ${r.fecha} — ${r.total} porciones:`);
        for (const item of r.resumen) {
          console.log(`  · ${item.platillo}: ${item.porciones}`);
        }
        // TODO: aquí se puede enviar la comanda por WhatsApp al encargado
        // de cocina cuando el negocio esté verificado, p. ej.:
        // await wa.enviarTexto(process.env.TELEFONO_COCINA, textoComanda(r));
      } catch (err) {
        console.error('[Cocina] Error generando comanda automática:', err.message);
      }
    }
  }, 60 * 1000);
}
