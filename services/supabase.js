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

// Cuántos pedidos se llevaría por delante borrar a este empleado. Se consulta
// por las tres variantes del teléfono porque la columna guardó formatos
// distintos según la época (10 dígitos, 52+10, 521+10) y contar de menos aquí
// sería autorizar un borrado que sí destruye historial.
export async function contarPedidosDeEmpleado(telefono) {
  const { count, error } = await supabase
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .in('empleado_telefono', variantesTelefono(telefono));
  if (error) throw error;
  return count || 0;
}

export async function deleteEmpleado(telefono) {
  const { error } = await supabase
    .from('empleados')
    .delete()
    .eq('telefono', telefono);
  if (error) throw error;
}

// Corrige el teléfono de un empleado SIN perder su historial.
// El teléfono es la llave primaria: dar de alta al empleado otra vez con el
// número bueno crearía un duplicado, y borrar el viejo se llevaría sus pedidos
// por el ON DELETE CASCADE. Aquí se actualiza la llave en su lugar y los
// pedidos viajan con ella gracias al ON UPDATE CASCADE (ver schema.sql).
export async function cambiarTelefonoEmpleado(telefonoActual, telefonoNuevo) {
  const nuevo = formatoCanonico(telefonoNuevo);

  // A quién estamos editando. Sin filtrar por activo: un empleado dado de baja
  // sigue ocupando la llave y su historial también importa.
  const { data: encontrados, error: errBusca } = await supabase
    .from('empleados')
    .select('*')
    .in('telefono', variantesTelefono(telefonoActual))
    .limit(1);
  if (errBusca) throw errBusca;

  const empleado = encontrados?.[0];
  if (!empleado) {
    const err = new Error('No existe un empleado con ese teléfono');
    err.status = 404;
    throw err;
  }
  if (empleado.telefono === nuevo) {
    return { empleado, sin_cambio: true, envios_movidos: 0 };
  }

  // Que no lo traiga ya alguien más, en ninguna de sus variantes (52 / 521 / 10
  // dígitos): el teléfono es único y la carga masiva ya rechazó duplicados así.
  const { data: ocupantes, error: errDup } = await supabase
    .from('empleados')
    .select('telefono, nombre, numero_empleado')
    .in('telefono', variantesTelefono(nuevo));
  if (errDup) throw errDup;

  const ocupante = (ocupantes || []).find(o => o.telefono !== empleado.telefono);
  if (ocupante) {
    const err = new Error(
      `Ese teléfono ya es de ${ocupante.nombre} (No. ${ocupante.numero_empleado})`
    );
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase
    .from('empleados')
    .update({ telefono: nuevo })
    .eq('telefono', empleado.telefono)
    .select()
    .single();
  if (error) {
    // 23503 = la FK de pedidos todavía no tiene ON UPDATE CASCADE, así que la
    // base no deja mover la llave. Se arregla corriendo schema.sql en Supabase.
    if (error.code === '23503') {
      const err = new Error(
        'La base aún no permite mover el teléfono: falta correr la migración ' +
        'de schema.sql (ON UPDATE CASCADE en pedidos). No se cambió nada.'
      );
      err.status = 409;
      throw err;
    }
    throw error;
  }

  // La bitácora de envíos de WhatsApp guarda el teléfono suelto, sin llave
  // foránea, así que se mueve aparte. Si falla no se tumba la operación: lo que
  // de verdad importa —el empleado y sus pedidos— ya quedó bien.
  let envios_movidos = 0;
  let aviso_envios = null;
  const { data: movidos, error: errEnvios } = await supabase
    .from('envios')
    .update({ telefono: nuevo })
    .eq('telefono', empleado.telefono)
    .select('id');
  if (errEnvios) aviso_envios = errEnvios.message;
  else envios_movidos = movidos?.length || 0;

  return { empleado: data, anterior: empleado.telefono, envios_movidos, aviso_envios };
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
// ── Accesos (quién consultó el menú) ────────────────────────────
// La PRIMERA consulta es la que interesa —a qué hora se enteró—, así que las
// siguientes solo mueven `ultima_vez` y suben el contador. Se lee antes de
// escribir en vez de usar upsert para no pisar `visto_en` con la hora actual.
export async function registrarAcceso(fecha, telefono) {
  const { data: previo, error: e1 } = await supabase
    .from('accesos').select('veces')
    .eq('fecha_menu', fecha).eq('empleado_telefono', telefono).limit(1);
  if (e1) throw e1;

  const ahora = new Date().toISOString();
  if (previo && previo.length) {
    const { error } = await supabase
      .from('accesos')
      .update({ ultima_vez: ahora, veces: (previo[0].veces || 1) + 1 })
      .eq('fecha_menu', fecha).eq('empleado_telefono', telefono);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('accesos')
    .insert({ fecha_menu: fecha, empleado_telefono: telefono, visto_en: ahora, ultima_vez: ahora, veces: 1 });
  // 23505 = otra pestaña lo insertó primero. No es un error: ya quedó.
  if (error && error.code !== '23505') throw error;
}

export async function getAccesosPorFecha(fecha) {
  const { data, error } = await supabase
    .from('accesos').select('*').eq('fecha_menu', fecha);
  if (error) throw error;
  return data || [];
}

// ── Repartidores ────────────────────────────────────────────────
// El hash NUNCA sale de aquí hacia una respuesta HTTP. Las funciones que
// alimentan al panel usan campos explícitos en vez de select('*'), para que
// agregar una columna sensible mañana no la filtre sola.
const CAMPOS_PUBLICOS = 'id, nombre, zonas, activo, version_sesion, creado_en, actualizado_en';

// Segundo candado. Pedir columnas explícitas ya evita traer el hash, pero eso
// depende de que nadie cambie una consulta a select('*') dentro de seis meses.
// Esto lo quita a la salida pase lo que pase: para filtrarlo habría que
// saltarse las dos cosas a propósito.
function sinHash(r) {
  if (!r || typeof r !== 'object') return r;
  const { clave_hash, ...resto } = r;
  return resto;
}

export async function listRepartidores() {
  const { data, error } = await supabase
    .from('repartidores').select(CAMPOS_PUBLICOS).order('nombre');
  if (error) throw error;
  return (data || []).map(sinHash);
}

export async function crearRepartidor({ nombre, clave_hash, zonas }) {
  const { data, error } = await supabase
    .from('repartidores')
    .insert({ nombre, clave_hash, zonas, activo: true, version_sesion: 1 })
    .select(CAMPOS_PUBLICOS)
    .single();
  if (error) throw error;
  return sinHash(data);
}

export async function actualizarRepartidor(id, cambios) {
  const permitido = {};
  if (cambios.nombre !== undefined) permitido.nombre = cambios.nombre;
  if (cambios.zonas !== undefined) permitido.zonas = cambios.zonas;
  if (cambios.activo !== undefined) permitido.activo = !!cambios.activo;
  if (cambios.clave_hash !== undefined) permitido.clave_hash = cambios.clave_hash;
  if (cambios.version_sesion !== undefined) permitido.version_sesion = cambios.version_sesion;
  permitido.actualizado_en = new Date().toISOString();

  const { data, error } = await supabase
    .from('repartidores').update(permitido).eq('id', id)
    .select(CAMPOS_PUBLICOS).single();
  if (error) throw error;
  return sinHash(data);
}

// Sube la versión de sesión: invalida de golpe todos los tokens emitidos antes.
// Se llama al restablecer la clave y al desactivar a alguien — si el equipo se
// perdió, desactivarlo tiene que cerrar la sesión que ya estaba abierta.
export async function invalidarSesiones(id) {
  const { data: actual, error: e1 } = await supabase
    .from('repartidores').select('version_sesion').eq('id', id).limit(1);
  if (e1) throw e1;
  const v = (actual?.[0]?.version_sesion || 1) + 1;
  return actualizarRepartidor(id, { version_sesion: v });
}

// Para el login: aquí SÍ hace falta el hash, y por eso es una función aparte
// con nombre explícito. No se usa para nada que responda al navegador.
export async function repartidoresParaLogin() {
  const { data, error } = await supabase
    .from('repartidores')
    .select('id, nombre, zonas, activo, version_sesion, clave_hash')
    .eq('activo', true);
  if (error) throw error;
  return data || [];
}

export async function getRepartidor(id) {
  const { data, error } = await supabase
    .from('repartidores').select(CAMPOS_PUBLICOS).eq('id', id).limit(1);
  if (error) throw error;
  return sinHash(data?.[0]) || null;
}

// Llegada del repartidor al punto. La PRIMERA es la que cuenta: si el equipo
// reintenta desde la cola, o el mismo turno se registra dos veces, la hora
// original no se mueve — de ella depende si la entrega fue extemporánea y, con
// eso, el 30% que el contrato permite descontar.
export async function registrarLlegada({ fecha, zona, turno, punto = '', llegada_en, lat, lon, precision_m }) {
  const { data: previa, error: errBusca } = await supabase
    .from('llegadas')
    .select('*')
    .eq('fecha_menu', fecha).eq('zona', zona).eq('turno', turno).eq('punto', punto || '')
    .limit(1);
  if (errBusca) throw errBusca;
  if (previa && previa.length) return { ok: true, ya_registrada: true, llegada: previa[0] };

  const { data, error } = await supabase
    .from('llegadas')
    .insert({
      fecha_menu: fecha, zona, turno, punto: punto || '',
      llegada_en, lat: lat ?? null, lon: lon ?? null, precision_m: precision_m ?? null,
      recibido_en: new Date().toISOString()
    })
    .select()
    .single();
  // 23505 = otro equipo la insertó entre la lectura y la escritura. No es un
  // error: la primera ganó, que es exactamente la regla.
  if (error && error.code === '23505') {
    const { data: gano } = await supabase
      .from('llegadas').select('*')
      .eq('fecha_menu', fecha).eq('zona', zona).eq('turno', turno).eq('punto', punto || '')
      .limit(1);
    return { ok: true, ya_registrada: true, llegada: gano?.[0] || null };
  }
  if (error) throw error;
  return { ok: true, llegada: data };
}

export async function getLlegadasPorFecha(fecha, zona = null) {
  let q = supabase.from('llegadas').select('*').eq('fecha_menu', fecha);
  if (zona) q = q.eq('zona', zona);
  const { data, error } = await q.order('llegada_en');
  if (error) throw error;
  return data || [];
}

export async function getPuntosEntrega() {
  const { data, error } = await supabase.from('puntos_entrega').select('*');
  if (error) throw error;
  return data || [];
}

export async function guardarPuntoEntrega({ zona, punto = '', nombre, direccion, lat, lon, radio_m }) {
  const { data, error } = await supabase
    .from('puntos_entrega')
    .upsert({
      zona, punto: punto || '', nombre: nombre ?? null, direccion: direccion ?? null,
      lat, lon, radio_m: radio_m ?? 150, actualizado_en: new Date().toISOString()
    }, { onConflict: 'zona,punto' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function marcarEntregado(fecha, numeroEmpleado, entregadoEn, motivoTardia = null, zonaEsperada = null, extra = {}) {
  const emp = await getEmpleadoPorNumero(numeroEmpleado);
  if (!emp) return { ok: false, motivo: 'empleado_no_encontrado' };

  // Con dos repartidores trabajando a la vez, cada equipo declara su zona y el
  // servidor la comprueba antes de escribir. No basta el filtro del teléfono:
  // una caché vieja o un equipo mal configurado registraría entregas de la otra
  // ruta, y eso mueve la evidencia de quién entregó qué. Se lee ANTES de tocar
  // nada para que un escaneo de la zona equivocada no modifique la base.
  if (zonaEsperada) {
    const { data: previo, error: errZona } = await supabase
      .from('pedidos')
      .select('zona')
      .eq('fecha_menu', fecha)
      .eq('empleado_telefono', emp.telefono)
      .limit(1);
    if (errZona) throw errZona;
    if (!previo || !previo.length) return { ok: false, motivo: 'sin_pedido' };
    if (previo[0].zona !== zonaEsperada) {
      return { ok: false, motivo: 'zona_incorrecta', zona_esperada: previo[0].zona };
    }
  }

  const cambios = { entregado_en: entregadoEn };
  // Solo se escribe si viene: una re-sincronización sin motivo no debe
  // borrar el que el chofer ya había elegido.
  if (motivoTardia) cambios.motivo_tardia = motivoTardia;

  // Dónde se escaneó. Solo si el fix es utilizable: guardar una coordenada de
  // ±1500 m —la que sale de antenas, sin satélites— sería peor que no tener
  // ninguna, porque parece evidencia y en una reclamación se usa en contra.
  if (extra.lat != null && extra.lon != null) {
    cambios.entrega_lat = extra.lat;
    cambios.entrega_lon = extra.lon;
    if (extra.precision_m != null) cambios.entrega_precision_m = extra.precision_m;
  }

  // A quién se le dio. Por omisión al empleado, que es el caso normal; el
  // repartidor marca 'supervisor' al cerrar la ruta con lo que nadie recogió.
  if (extra.entregado_a) cambios.entregado_a = extra.entregado_a;
  if (extra.recibido_por) cambios.recibido_por = extra.recibido_por;

  // Quién entregó. Viene de la SESIÓN validada en el servidor, nunca del
  // cuerpo que manda el navegador: si el equipo pudiera declarar su propia
  // identidad, la atribución no probaría nada. El nombre se copia como
  // fotografía del momento para que un reporte viejo siga siendo legible.
  if (extra.repartidor_id != null) cambios.entregado_por_id = extra.repartidor_id;
  if (extra.repartidor_nombre) cambios.entregado_por_nombre = extra.repartidor_nombre;

  // Hora del SERVIDOR, el único dato que no viene del reloj del repartidor.
  cambios.entrega_recibido_en = new Date().toISOString();

  // Solo escribe si todavía no hay hora. La primera confirmación es la buena:
  // si se pierde la respuesta y el teléfono reintenta, o si el mismo pedido se
  // escanea desde otro equipo, la evidencia de a qué hora se entregó no se
  // debe mover — de ella dependen la puntualidad, el motivo del retraso y la
  // duración de la ruta en los reportes.
  const { data, error } = await supabase
    .from('pedidos')
    .update(cambios)
    .eq('fecha_menu', fecha)
    .eq('empleado_telefono', emp.telefono)
    .is('entregado_en', null)
    .select('*, empleados(nombre, numero_empleado)');
  if (error) throw error;
  if (data && data.length) return { ok: true, pedido: data[0] };

  // No se actualizó nada: falta averiguar si es que no hay pedido ese día o
  // si ya estaba entregado, porque el repartidor necesita respuestas distintas.
  const { data: existente, error: errBusca } = await supabase
    .from('pedidos')
    .select('*, empleados(nombre, numero_empleado)')
    .eq('fecha_menu', fecha)
    .eq('empleado_telefono', emp.telefono)
    .limit(1);
  if (errBusca) throw errBusca;
  if (!existente || !existente.length) return { ok: false, motivo: 'sin_pedido' };

  // Ya estaba entregado. Se responde ok a propósito: la entrega SÍ ocurrió, y
  // devolver error dejaría el escaneo atorado en la cola del teléfono para
  // siempre —solo se vacía con ok o con un rechazo de negocio— y el repartidor
  // nunca vería "Por subir" en cero. Se conserva la hora original.
  return { ok: true, ya_entregado: true, pedido: existente[0] };
}

// Guarda la calificación. Solo aplica a pedidos ya ENTREGADOS: calificar algo
// que nunca se recibió no diría nada del platillo.
export async function calificarPedido(fecha, telefono, rating) {
  // La primera opinión es la que cuenta. Antes el UPDATE solo exigía que el
  // pedido estuviera entregado, así que una calificación se podía reemplazar
  // las veces que fuera —y el endpoint es público, identificado solo por
  // número de empleado—. Con el candado, reenviar no cambia lo ya opinado.
  const { data, error } = await supabase
    .from('pedidos')
    .update({ rating })
    .eq('fecha_menu', fecha)
    .eq('empleado_telefono', telefono)
    .not('entregado_en', 'is', null)
    .is('rating', null)
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
