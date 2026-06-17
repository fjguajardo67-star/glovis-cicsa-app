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
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .in('telefono', variantes)
    .eq('activo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
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
      activo:          emp.activo ?? true
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
