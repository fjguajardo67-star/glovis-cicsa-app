// services/cocina.js — Comanda de cocina: resumen por platillo y vista imprimible
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { fechaServicio } from './pedidos.js';
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

// ── Etiquetas por comida (una por pedido) ───────────────────────
// Se pegan en el contenedor. El tamaño es configurable porque depende del
// rollo que se compre; con modo 'hoja' se prueban en papel carta antes de
// invertir en la impresora.
export async function etiquetas(fecha, { ancho = 57, alto = 32, modo = 'rollo', qr = true } = {}) {
  const pedidos = await db.getPedidosPorFecha(fecha);
  return { fecha, ancho, alto, modo, qr, pedidos };
}

export function htmlEtiquetas({ fecha, ancho, alto, modo, qr = true, pedidos }) {
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat('dd/MM/yyyy HH:mm');
  const fechaCorta = DateTime.fromISO(fecha, { zone: ZONA_TZ }).toFormat('dd/MM/yyyy');
  const enHoja = modo === 'hoja';

  // Las etiquetas salen agrupadas por turno y zona: así se empacan y se
  // reparten en el mismo orden en que la cocina las va a necesitar.
  const orden = [...pedidos].sort((a, b) =>
    String(a.turno).localeCompare(String(b.turno)) ||
    String(a.zona).localeCompare(String(b.zona)) ||
    String(a.empleados?.nombre || '').localeCompare(String(b.empleados?.nombre || '')));

  // En la etiqueta la ruta va abreviada: el turno ya implica la hora, y
  // escribirla completa hace que se corte en los rollos angostos.
  const turnoCorto = t => (TURNOS[t] || t || 'Sin turno').split('—')[0].trim();
  const zonaCorta  = z => (ZONAS[z] || z || 'Sin zona').replace(/^Glovis\s+/i, '');

  // El QR lleva número de empleado y fecha: sin la fecha, la etiqueta de ayer
  // se podría escanear hoy y marcaría una entrega que no ocurrió.
  const cuerpo = orden.map(p => {
    const numero = p.empleados?.numero_empleado || '';
    const codigo = `${numero}|${fecha}`;
    return `
    <div class="etiqueta">
      <div class="texto">
        <div class="ruta">${esc(turnoCorto(p.turno))} &nbsp;·&nbsp; ${esc(zonaCorta(p.zona))}</div>
        <div class="nombre">${esc(p.empleados?.nombre || 'Sin nombre')}</div>
        <div class="platillo">${esc(p.opcion_texto || p.opcion_id)}</div>
        <div class="pie">
          <span>#${esc(numero || '—')}</span>
          <span>${esc(fechaCorta)}</span>
        </div>
      </div>
      ${qr ? `<div class="qr" data-codigo="${esc(codigo)}"></div>` : ''}
    </div>`;
  }).join('');

  const vacio = '<p style="font-family:sans-serif;padding:20px">Sin pedidos registrados para esta fecha.</p>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Etiquetas ${esc(fecha)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e9ecf1; font-family: 'Segoe UI', system-ui, sans-serif; color: #000; }

  .barra {
    background: #003087; color: #fff; padding: 12px 18px;
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    position: sticky; top: 0; z-index: 5;
  }
  .barra b { font-size: .95rem; }
  .barra .dato { font-size: .8rem; color: rgba(255,255,255,.75); }
  .barra button {
    margin-left: auto; padding: 9px 18px; background: #c9922a; color: #fff;
    border: none; border-radius: 7px; font-family: inherit; font-size: .88rem;
    font-weight: 700; cursor: pointer;
  }
  .ayuda {
    background: #fff; padding: 11px 18px; font-size: .8rem; color: #5a6480;
    border-bottom: 1px solid #dde3ef;
  }
  .ayuda b { color: #0d1b3e; }

  /* Cada etiqueta mide exactamente lo que mide el rollo */
  .hoja { padding: 18px; }
  .hoja.rollo { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .hoja.prueba { display: flex; flex-wrap: wrap; gap: 8px; }

  .etiqueta {
    width: ${ancho}mm;
    height: ${alto}mm;
    background: #fff;
    border: 1px solid #b9c2d4;      /* guía en pantalla; se quita al imprimir en rollo */
    border-radius: 2mm;              /* recordatorio de las esquinas redondeadas */
    padding: 1.6mm 2.2mm;
    display: flex; gap: 1.5mm; align-items: stretch;
    overflow: hidden;
  }
  .etiqueta .texto {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .etiqueta .qr {
    flex: none; align-self: center;
    width: ${Math.min(alto - 5, 18)}mm; height: ${Math.min(alto - 5, 18)}mm;
  }
  .etiqueta .qr canvas, .etiqueta .qr img { width: 100% !important; height: 100% !important; display: block; }
  .etiqueta .ruta {
    font-size: 6.5pt; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .etiqueta .nombre {
    font-size: 10.5pt; font-weight: 800; line-height: 1.1;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .etiqueta .platillo {
    font-size: 8pt; line-height: 1.15; font-weight: 600;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .etiqueta .pie {
    display: flex; justify-content: space-between;
    font-size: 6pt; border-top: .3mm solid #000; padding-top: .8mm;
  }

  @media print {
    .barra, .ayuda { display: none; }
    body { background: #fff; }
    .hoja { padding: 0; gap: 0; }
    .etiqueta { border: none; border-radius: 0; }
  }

  ${enHoja
    ? `/* Prueba en papel carta: se recortan para validar la medida */
       @page { size: letter; margin: 10mm; }
       @media print { .etiqueta { border: .2mm dashed #999; } .hoja.prueba { gap: 4mm; } }`
    : `/* Rollo continuo: una etiqueta por página, del tamaño exacto */
       @page { size: ${ancho}mm ${alto}mm; margin: 0; }
       @media print { .etiqueta { page-break-after: always; } .etiqueta:last-child { page-break-after: auto; } }`}
</style>
</head>
<body>
  <div class="barra">
    <b>🏷️ Etiquetas · ${esc(fechaCorta)}</b>
    <span class="dato">${orden.length} comida(s)</span>
    <span class="dato">${ancho} × ${alto} mm</span>
    <span class="dato">${enHoja ? 'prueba en papel carta' : 'rollo continuo'}</span>
    <button onclick="window.print()">Imprimir</button>
  </div>
  <div class="ayuda">
    ${enHoja
      ? 'Imprime esta hoja en papel normal y recórtala para comprobar que la medida cabe en el contenedor <b>antes</b> de comprar el rollo. Cambia el tamaño con <b>?ancho=</b> y <b>?alto=</b> en milímetros.'
      : 'Ajusta el tamaño con <b>?ancho=</b> y <b>?alto=</b> (mm) para que coincida con tu rollo. Para probar en papel carta primero, agrega <b>&amp;modo=hoja</b>.'}
    Las etiquetas van ordenadas por turno y zona, en el orden en que se empacan.
  </div>
  <div class="hoja ${enHoja ? 'prueba' : 'rollo'}">
    ${orden.length ? cuerpo : vacio}
  </div>
${qr ? `  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    // Los píxeles de un canvas no viajan en el HTML: el QR se genera sobre
    // el elemento ya insertado en la página, nunca copiando su marcado.
    document.querySelectorAll('.qr[data-codigo]').forEach(function (caja) {
      new QRCode(caja, {
        text: caja.dataset.codigo,
        width: 160, height: 160,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    });
  </script>` : ''}
  <script>window.__generado = ${JSON.stringify(generado)};</script>
</body>
</html>`;
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
        // El corte de las 20:00 solo cierra los pedidos del día SIGUIENTE.
        // Si mañana no hay servicio (fin de semana, festivo), la próxima
        // fecha con menú aún tiene su propio corte por delante: no es hoy
        // cuando se imprime su comanda.
        const fecha = await fechaServicio();
        if (fecha !== manana()) {
          console.log(`[Cocina] Mañana no hay servicio; la próxima fecha (${fecha ?? 'ninguna'}) cierra otro día. Sin comanda.`);
          return;
        }
        const r = await resumenCocina(fecha);
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
