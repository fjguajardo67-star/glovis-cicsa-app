// services/cocina-cobertura.js — comanda y etiquetas del menú especial

import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { ZONA as ZONA_TZ, ZONAS } from './menu.js';

const esc = s => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function resumenCobertura(fecha) {
  const solicitudes = (await db.listSolicitudesCobertura(fecha)).filter(s => s.estado !== 'cancelada');
  const items = solicitudes.flatMap(s => s.items.map(item => ({ ...item, solicitud: s })));
  const grupos = new Map();
  for (const item of items) {
    const clave = item.solicitud.zona + '|' + item.opcion_texto;
    if (!grupos.has(clave)) grupos.set(clave, {
      zona: item.solicitud.zona, platillo: item.opcion_texto, porciones: 0
    });
    grupos.get(clave).porciones++;
  }
  return {
    fecha,
    total: items.length,
    solicitudes: solicitudes.length,
    resumen: [...grupos.values()].sort((a, b) =>
      a.zona.localeCompare(b.zona) || b.porciones - a.porciones),
    detalle: solicitudes
  };
}

export function htmlComandaCobertura({ fecha, total, solicitudes, resumen, detalle }, { autoPrint = false } = {}) {
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat("dd/MM/yyyy HH:mm 'hrs'");
  const porZona = new Map();
  for (const r of resumen) {
    if (!porZona.has(r.zona)) porZona.set(r.zona, []);
    porZona.get(r.zona).push(r);
  }
  const secciones = [...porZona.entries()].map(([zona, items]) => `
    <section>
      <h2>${esc((ZONAS[zona] || zona).toUpperCase())}</h2>
      ${items.map(i => `<div class="linea"><b>${esc(i.platillo)}</b><strong>${i.porciones}</strong></div>`).join('')}
      <div class="subtotal"><span>Subtotal zona</span><b>${items.reduce((s, i) => s + i.porciones, 0)}</b></div>
    </section>`).join('');
  const folios = detalle.map(s => `
    <div class="folio">
      <b>${esc(s.folio)}</b> · ${esc(ZONAS[s.zona] || s.zona)} · ${s.total_porciones} alimento(s)<br>
      <span>Solicita: ${esc(s.supervisor_nombre_snapshot)} · Recibe: ${esc(s.responsable_nombre_snapshot)} #${esc(s.responsable_numero_snapshot)}</span>
    </div>`).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comanda de cobertura ${esc(fecha)}</title><style>
*{box-sizing:border-box}body{font-family:'Courier New',monospace;color:#000;background:#fff;max-width:430px;margin:auto;padding:16px 12px}
h1{text-align:center;font-size:20px;letter-spacing:.04em}p{text-align:center;font-size:13px;margin:4px 0}hr{border:0;border-top:2px dashed #000;margin:12px 0}
h2{text-align:center;font-size:16px;border-block:2px solid #000;padding:7px 0;margin:14px 0 10px}.linea,.subtotal,.total{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.linea{font-size:16px;padding:7px 0;border-bottom:1px dotted #777}.linea strong{font-size:22px}.subtotal{font-size:14px;font-weight:700;margin-top:8px}
.total{font-size:19px;font-weight:900}.folio{font-size:12px;line-height:1.45;padding:7px 0;border-bottom:1px dotted #888}.folio span{font-size:11px}.no-print{text-align:center;margin-top:18px}.no-print button{padding:8px 20px;font:inherit}
@media print{body{padding:0}.no-print{display:none}}
</style></head><body>
<h1>COBERTURA · SEGUNDO TURNO</h1><p>CICSA · Glovis</p><p>Entrega 5:00 PM · Salida máxima 4:30 PM</p><p>Fecha: <b>${esc(fecha)}</b></p><hr>
${secciones || '<p>Sin solicitudes confirmadas.</p>'}
<hr><div class="total"><span>TOTAL</span><span>${total}</span></div><p>${solicitudes} solicitud(es)</p>
${folios ? `<hr><h2>FOLIOS Y RECEPCIÓN</h2>${folios}` : ''}
<hr><p>Generada: ${esc(generado)}</p><div class="no-print"><button onclick="window.print()">Imprimir</button></div>
${autoPrint ? '<script>window.addEventListener("load",function(){window.setTimeout(function(){window.print()},250)})</script>' : ''}
</body></html>`;
}

export async function etiquetasCobertura(fecha, { ancho = 57, alto = 32, modo = 'rollo' } = {}) {
  const solicitudes = (await db.listSolicitudesCobertura(fecha)).filter(s => s.estado !== 'cancelada');
  const items = solicitudes.flatMap(s => s.items.map((item, i) => ({
    ...item, solicitud: s, secuencia: i + 1
  })));
  return { fecha, ancho, alto, modo, items };
}

export function htmlEtiquetasCobertura({ fecha, ancho, alto, modo, items }) {
  const enHoja = modo === 'hoja';
  const fechaCorta = DateTime.fromISO(fecha, { zone: ZONA_TZ }).toFormat('dd/MM/yyyy');
  const orden = [...items].sort((a, b) =>
    a.solicitud.zona.localeCompare(b.solicitud.zona) ||
    a.solicitud.folio.localeCompare(b.solicitud.folio) ||
    a.empleado_nombre_snapshot.localeCompare(b.empleado_nombre_snapshot));
  const cuerpo = orden.map(item => {
    const s = item.solicitud;
    const codigo = `EX|${item.codigo_entrega}|${fecha}`;
    return `<article class="etiqueta">
      <div class="texto">
        <div class="ruta">COBERTURA · 5:00 PM · ${esc((ZONAS[s.zona] || s.zona).replace(/^Glovis\s+/i, ''))}</div>
        <div class="nombre">${esc(item.empleado_nombre_snapshot)}</div>
        <div class="numero">#${esc(item.empleado_numero_snapshot)} · ${esc(item.opcion_texto)}</div>
        <div class="recibe">Recibe: ${esc(s.responsable_nombre_snapshot)} #${esc(s.responsable_numero_snapshot)}</div>
        <div class="pie"><span>${esc(s.folio)} · ${item.secuencia}/${s.total_porciones}</span><span>${esc(fechaCorta)}</span></div>
      </div><div class="qr" data-codigo="${esc(codigo)}"></div>
    </article>`;
  }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Etiquetas cobertura ${esc(fecha)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:#edf1f7;color:#071b42}.barra{position:sticky;top:0;z-index:2;background:#003087;color:#fff;padding:12px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.barra button{margin-left:auto;padding:9px 18px;border:0;border-radius:7px;font-weight:800;color:#003087;background:#fff}.ayuda{padding:10px 18px;background:#fff;color:#56627b;font-size:.8rem}.hoja{padding:18px}.hoja.rollo{display:flex;flex-direction:column;gap:10px;align-items:flex-start}.hoja.prueba{display:flex;flex-wrap:wrap;gap:8px}.etiqueta{width:${ancho}mm;height:${alto}mm;background:#fff;border:1px solid #aebbd2;border-radius:2mm;padding:1.5mm 2mm;display:flex;gap:1.5mm;overflow:hidden}.texto{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}.qr{flex:none;align-self:center;width:${Math.min(alto - 5, 18)}mm;height:${Math.min(alto - 5, 18)}mm}.qr canvas,.qr img{width:100%!important;height:100%!important;display:block}.ruta{font-size:6pt;font-weight:900;letter-spacing:.035em;white-space:nowrap}.nombre{font-size:9pt;font-weight:900;line-height:1.05}.numero{font-size:7.2pt;font-weight:750;line-height:1.1}.recibe{font-size:5.8pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pie{display:flex;justify-content:space-between;border-top:.25mm solid #000;padding-top:.5mm;font-size:5.5pt}
@media print{.barra,.ayuda{display:none}body{background:#fff}.hoja{padding:0;gap:0}.etiqueta{border:0;border-radius:0}}
${enHoja ? '@page{size:letter;margin:10mm}@media print{.etiqueta{border:.2mm dashed #999}.hoja.prueba{gap:4mm}}' : `@page{size:${ancho}mm ${alto}mm;margin:0}@media print{.etiqueta{page-break-after:always}.etiqueta:last-child{page-break-after:auto}}`}
</style></head><body><div class="barra"><b>Etiquetas · cobertura ${esc(fechaCorta)}</b><span>${orden.length} alimento(s)</span><button onclick="window.print()">Imprimir</button></div>
<div class="ayuda">Una etiqueta por recipiente. El QR registra esta cobertura sin interferir con el pedido regular del empleado.</div><main class="hoja ${enHoja ? 'prueba' : 'rollo'}">${cuerpo || '<p>Sin solicitudes confirmadas.</p>'}</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>document.querySelectorAll('.qr[data-codigo]').forEach(c=>new QRCode(c,{text:c.dataset.codigo,width:160,height:160,correctLevel:QRCode.CorrectLevel.M}));</script></body></html>`;
}
