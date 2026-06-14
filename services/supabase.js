// services/supabase.js — Conexión y queries a la base de datos
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Empleados ───────────────────────────────────────────────────

export async function getEmpleado(telefono) {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .eq('telefono', telefono)
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
      telefono: emp.telefono,
      nombre: emp.nombre,
      numero_empleado: emp.numero_empleado,
      activo: emp.activo ?? true
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
      fecha: menu.fecha,
      fija_a: menu.fija_a,
      fija_b: menu.fija_b,
      fija_c: menu.fija_c,
      var_1: menu.var_1,
      var_2: menu.var_2,
      var_3: menu.var_3
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
      fecha_menu: pedido.fecha_menu,
      empleado_telefono: pedido.empleado_telefono,
      opcion_id: pedido.opcion_id,
      opcion_texto: pedido.opcion_texto
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
    .order('fecha_menu');
  if (error) throw error;
  return data;
}

export { supabase };
