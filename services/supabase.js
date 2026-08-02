// services/supabase.js — Conexión y queries a la base de datos
import { createClient } from '@supabase/supabase-js';
import { variantesTelefono, formatoCanonico } from './telefono.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Empleados ───────────────────────────────────────────────────

export async function getEmpleado(telefono) {
  // Buscar por cualquier variante del número (con/sin "1" mexicano, con/sin 52)
  const variantes = variantesTelefono(telefono);
  // limit(1) en vez de maybeSingle(): si el empleado quedó guardado con dos
  // variantes del número, maybeSingle() lanzaría error y el bot no lo reconocería
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .in('telefono', variantes)
    .eq('activo', true)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// Identificación por número de empleado (lo que usa la página web:
// el empleado lo trae en el gafete y no requiere contraseña)
export async function getEmpleadoPorNumero(numeroEmpleado) {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .eq('numero_empleado', String(numeroEmpleado || '').trim())
    .eq('activo', true)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function listEmpleados() {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .order('nombre');
  if (error) throw error;
  return data;
}

export async function listEmpleadosActivos() {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .eq('activo', true)
    .order('nombre');
  if (error) throw error;
  return data;
}

export async function upsertEmpleado(emp) {
  const { data, error } = await supabase
    .from('empleados')
    .upsert({
      telefono:        formatoCanonico(emp.telefono),  // siempre 521 + 10 dígitos
      nombre:          emp.nombre,
      numero_empleado: emp.numero_empleado,
      activo:          emp.activo ?? true,
      // Asignación que da RRHH: sirve de valor por defecto al pedir,
      // no de candado (la gente cubre turnos y cambia de línea)
      zona_default:    emp.zona_default  ?? null,
      turno_default:   emp.turno_default ?? null
    }, { onConflict: 'telefono' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setEmpleadoActivo(telefono, activo) {
  const { data, error } = await supabase
    .from('empleados')
    .update({ activo })
    .eq('telefono', telefono)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEmpleado(telefono) {
  const { error } = await supabase
    .from('empleados')
    .delete()
    .eq('telefono', telefono);
  if (error) throw error;
}

// ── Envíos (registro de quién recibió el menú) ──────────────────

export async function registrarEnvio(envio) {
  // upsert por (fecha_menu, telefono): un reenvío actualiza el registro
  const { data, error } = await supabase
    .from('envios')
    .upsert({
      fecha_menu: envio.fecha_menu,
      telefono: envio.telefono,
      nombre: envio.nombre,
      estado: envio.estado,
      message_id: envio.message_id || null,
      error: envio.error || null,
      actualizado_en: new Date().toISOString()
    }, { onConflict: 'fecha_menu,telefono' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getEnviosPorFecha(fecha) {
  const { data, error } = await supabase
    .from('envios')
    .select('*')
    .eq('fecha_menu', fecha);
  if (error) throw error;
  return data || [];
}

export async function actualizarEstadoEnvioPorMsgId(messageId, estado) {
  const { error } = await supabase
    .from('envios')
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq('message_id', messageId);
  if (error) throw error;
}

// ── Menús ───────────────────────────────────────────────────────

export async function getMenu(fecha) {
  const { data, error } = await supabase
    .from('menus')
    .select('*')
    .eq('fecha', fecha)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Primera fecha con menú publicado a partir de `desdeFecha` (inclusive).
// Es la que define el próximo día de servicio: publicar el menú es lo que
// declara que ese día abre el comedor.
export async function getProximaFechaConMenu(desdeFecha) {
  const { data, error } = await supabase
    .from('menus')
    .select('fecha')
    .gte('fecha', desdeFecha)
    .order('fecha')
    .limit(1);
  if (error) throw error;
  return data?.[0]?.fecha || null;
}

// Fechas que ya tienen menú publicado dentro de un rango (para el avisador
// del panel: ahora que "sin menú = sin servicio", un olvido debe ser visible)
export async function getFechasConMenu(fechaIni, fechaFin) {
  const { data, error } = await supabase
    .from('menus')
    .select('fecha')
    .gte('fecha', fechaIni)
    .lte('fecha', fechaFin)
    .order('fecha');
  if (error) throw error;
  return (data || []).map(m => m.fecha);
}

export async function upsertMenu(menu) {
  const { data, error } = await supabase
    .from('menus')
    .upsert({
      fecha:  menu.fecha,
      fija_a: menu.fija_a,
      fija_b: menu.fija_b,
      fija_c: menu.fija_c,
      var_1:  menu.var_1,
      var_2:  menu.var_2,
      var_3:  menu.var_3
    }, { onConflict: 'fecha' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Pedidos ─────────────────────────────────────────────────────

export async function upsertPedido(pedido) {
  const { data, error } = await supabase
    .from('pedidos')
    .upsert({
      fecha_menu:        pedido.fecha_menu,
      empleado_telefono: pedido.empleado_telefono,
      opcion_id:         pedido.opcion_id,
      opcion_texto:      pedido.opcion_texto,
      zona:              pedido.zona,
      turno:             pedido.turno
    }, { onConflict: 'fecha_menu,empleado_telefono' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPedidosPorFecha(fecha) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, empleados(nombre, numero_empleado)')
    .eq('fecha_menu', fecha)
    .order('turno')        // agrupa Turno A antes que Turno B
    .order('zona')
    .order('creado_en');
  if (error) throw error;
  return data;
}

// Marca entregas entrando por número de empleado, que es lo que trae el QR
// de la etiqueta. `entregadoEn` es la hora del escaneo, no la de sincronización.
export async function marcarEntregado(fecha, numeroEmpleado, entregadoEn, motivoTardia = null) {
  const emp = await getEmpleadoPorNumero(numeroEmpleado);
  if (!emp) return { ok: false, motivo: 'empleado_no_encontrado' };

  const cambios = { entregado_en: entregadoEn };
  // Solo se escribe si viene: una re-sincronización sin motivo no debe
  // borrar el que el chofer ya había elegido.
  if (motivoTardia) cambios.motivo_tardia = motivoTardia;

  const { data, error } = await supabase
    .from('pedidos')
    .update(cambios)
    .eq('fecha_menu', fecha)
    .eq('empleado_telefono', emp.telefono)
    .select('*, empleados(nombre, numero_empleado)');
  if (error) throw error;
  if (!data || !data.length) return { ok: false, motivo: 'sin_pedido' };
  return { ok: true, pedido: data[0] };
}

// Guarda la calificación. Solo aplica a pedidos ya ENTREGADOS: calificar algo
// que nunca se recibió no diría nada del platillo.
export async function calificarPedido(fecha, telefono, rating) {
  const { data, error } = await supabase
    .from('pedidos')
    .update({ rating })
    .eq('fecha_menu', fecha)
    .eq('empleado_telefono', telefono)
    .not('entregado_en', 'is', null)
    .select('id');
  if (error) throw error;
  return !!(data && data.length);
}

// Último pedido entregado y sin calificar de un empleado, para preguntarle
// al volver. Se limita a días recientes: calificar algo de hace un mes no sirve.
export async function pedidoPorCalificar(telefono, desdeFecha) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('fecha_menu, opcion_texto')
    .eq('empleado_telefono', telefono)
    .gte('fecha_menu', desdeFecha)
    .not('entregado_en', 'is', null)
    .is('rating', null)
    .order('fecha_menu', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function getPedidosRango(fechaIni, fechaFin) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, empleados(nombre, numero_empleado, telefono)')
    .gte('fecha_menu', fechaIni)
    .lte('fecha_menu', fechaFin)
    .order('fecha_menu')
    .order('turno')
    .order('zona');
  if (error) throw error;
  return data;
}

export { supabase };
