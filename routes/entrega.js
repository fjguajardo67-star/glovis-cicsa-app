// routes/entrega.js — API de confirmación de entregas (escaneo del QR)
//
// Va separada de /api porque su clave es distinta: el repartidor usa
// ENTREGA_KEY, que solo sirve para esto. Si el teléfono se pierde o la
// persona cambia, se rota ENTREGA_KEY en Railway sin tocar la ADMIN_KEY.
// La ADMIN_KEY también se acepta, para que el panel siga funcionando.

import express from 'express';
import * as db from '../services/supabase.js';
import {
  verificarClave, emitirToken, leerToken,
  registrarIntento, limpiarIntentos, DURACION_SESION_HORAS
} from '../services/sesion.js';
import {
  MOTIVOS_TARDIA, MOTIVOS_TARDIA_VALIDOS,
  TURNO_HORA, TOLERANCIA_TARDIA_MIN,
  ZONAS_VALIDAS, TURNOS_VALIDOS, hoy
} from '../services/menu.js';

export const entregaRouter = express.Router();

// La fecha de REPARTO es hoy, y no tiene nada que ver con la de PEDIDO.
//
// `fechaServicio()` responde "el próximo día con menú" — o sea mañana o después,
// nunca hoy: es la fecha para la que la gente está pidiendo. La app del
// repartidor la usaba para decidir qué entregar, así que le mostraba los pedidos
// de MAÑANA y dejaba marcarlos entregados un día antes. Eso destruye justo lo
// que la evidencia debe probar: una hora de entrega no vale nada si se puede
// sellar antes de que la comida exista.
//
// Se acepta `hoy` como fecha en la URL para que el aparato no tenga que
// calcularla: el reloj de un teléfono puede estar mal, y quien manda es el
// servidor, que ya vive en la zona del comedor.
function fechaPedida(param) {
  return (param === 'hoy' || !param) ? hoy() : param;
}

// La hora de entrega la pone el reloj del TELÉFONO, y tiene que ser así: el
// reparto ocurre sin señal y lo que importa es el instante del escaneo, no el
// de la sincronización. Pero ese reloj no se validaba de ninguna forma, y esa
// hora es exactamente la que decide la penalización del 30% del contrato: un
// aparato con la fecha mal puesta —o alguien mandando un POST a mano— podía
// sellar cualquier cosa. (Hallazgo GL-008 de la auditoría.)
//
// La regla es la más estrecha que no estorba: una entrega del día X tiene que
// haber ocurrido dentro del día civil X en la hora del comedor. Una cola que
// sincroniza al día siguiente sigue trayendo la hora original del escaneo, que
// cae dentro de su propio día, así que no la afecta.
//
// Lo que no pasa la prueba NO se rechaza —la comida sí se entregó— sino que se
// sella con la hora de recepción del servidor. Vale más una hora aproximada y
// honesta que una inventada por un reloj descompuesto. La hora del servidor ya
// se guarda aparte en `entrega_recibido_en`, así que la desviación es auditable.
function horaEntregaConfiable(entregadoEn, fechaServicio) {
  const ahora = new Date().toISOString();
  if (typeof entregadoEn !== 'string') return { hora: ahora, estimada: true, motivo: 'sin_hora' };
  const t = Date.parse(entregadoEn);
  if (Number.isNaN(t)) return { hora: ahora, estimada: true, motivo: 'hora_invalida' };
  // Día civil de la fecha de servicio, en la zona del comedor.
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(t));
  if (dia !== fechaServicio) {
    return { hora: ahora, estimada: true, motivo: 'fuera_del_dia', declarada: entregadoEn };
  }
  return { hora: entregadoEn, estimada: false };
}

// Por encima de esta precisión el fix no viene de satélites sino de antenas o
// wifi, y una coordenada de kilómetros no distingue el andén de la carretera:
// como evidencia no sirve, y presentarla es peor que no tener nada.
const PRECISION_MAXIMA_M = 100;

// El listón para fijar el PUNTO es más alto que para una entrega: se mide una
// vez y contra él se calcula la distancia de todas las entregas del contrato.
// Un punto capturado con 300 m de error desplaza para siempre cada medición.
// Además es lo que impide capturarlo desde una PC, donde la ubicación sale del
// wifi o de la IP y da cientos de metros o de plano otra ciudad.
const PRECISION_PUNTO_MAXIMA_M = 25;

// A quién se le entregó la comida. 'supervisor' cubre lo que el empleado no
// recogió: el proveedor ya la cocinó y la llevó, y devolverla es merma suya,
// así que se deja en el sitio y queda constancia de quién la recibió.
const ENTREGADO_A_VALIDOS = ['empleado', 'supervisor'];

// ── Login del repartidor ──────────────────────────────────────
// Va ANTES del middleware de autorización: es la puerta, no puede exigir estar
// adentro. La clave la asigna el administrador; el repartidor no crea la suya.
entregaRouter.post('/login', async (req, res) => {
  try {
    const clave = req.body?.clave;
    const origen = req.ip || req.headers['x-forwarded-for'] || 'sin_origen';

    const { bloqueado } = registrarIntento(origen);
    if (bloqueado) {
      // 429 y no 401: hay que distinguir "te equivocaste" de "ya no te
      // escucho", si no el repartidor vuelve a teclear pensando que falló.
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    }
    if (typeof clave !== 'string' || !clave.trim()) {
      return res.status(400).json({ error: 'Se requiere la clave' });
    }

    // Se comparan TODAS las claves activas en vez de buscar por usuario: el
    // repartidor solo teclea su clave, no un nombre de usuario. Son pocos
    // registros y scrypt es lento a propósito, así que el recorrido no importa.
    const candidatos = await db.repartidoresParaLogin();
    let encontrado = null;
    for (const r of candidatos) {
      if (await verificarClave(clave.trim(), r.clave_hash)) { encontrado = r; break; }
    }

    if (!encontrado) {
      // Mensaje único a propósito: decir "ese usuario no existe" contra "clave
      // incorrecta" le regala a quien prueba la mitad del trabajo.
      return res.status(401).json({ error: 'Clave incorrecta' });
    }

    limpiarIntentos(origen);
    const token = emitirToken(encontrado);
    res.json({
      token,
      expires_at: new Date(Date.now() + DURACION_SESION_HORAS * 3600 * 1000).toISOString(),
      repartidor: { id: encontrado.id, nombre: encontrado.nombre, zonas: encontrado.zonas || [] }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Autorización ──────────────────────────────────────────────
// Tres formas de entrar, en orden de preferencia:
//   1. Token de sesión de un repartidor  → identifica a la persona
//   2. ADMIN_KEY                         → administración y diagnóstico
//   3. ENTREGA_KEY compartida            → SOLO con el modo legado encendido
//
// La tercera existe para no dejar tirados los equipos que ya tienen la clave
// vieja guardada. No atribuye la entrega a nadie: queda como "Reparto general",
// que es la verdad — con una clave compartida no se sabe quién fue.
// El try/catch de afuera no es adorno. Express 4 no captura los rechazos de un
// middleware async: lo que se escape de aquí sale como unhandled rejection y
// Node se lleva el proceso entero. Como esto corre ANTES que toda ruta de
// entrega, cualquier tropiezo aquí —un secreto sin configurar, un parpadeo de
// Supabase al consultar el repartidor— tumbaba el servidor con una petición
// sin credenciales. Ahora sale como 500 y la app sigue de pie.
entregaRouter.use(async (req, res, next) => {
 try {
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY no configurada en el servidor' });
  }

  const cabecera = req.headers['authorization'] || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;

  if (token) {
    // Se revisa aquí y no arriba a propósito: sin secreto no se pueden validar
    // tokens, pero la clave compartida sí sigue sirviendo. Así una variable que
    // falte frena el modo nuevo sin dejar tirados a los equipos que están
    // migrando.
    if (!process.env.ENTREGA_SESSION_SECRET) {
      console.error('[Entrega] Llegó un token pero ENTREGA_SESSION_SECRET no está configurada');
      return res.status(500).json({ error: 'Sesiones no configuradas en el servidor' });
    }
    const datos = leerToken(token);
    if (!datos) return res.status(401).json({ error: 'Sesión inválida', motivo: 'token_invalido' });
    if (datos.vencido) return res.status(401).json({ error: 'Sesión vencida', motivo: 'token_vencido' });

    const r = await db.getRepartidor(datos.id);
    if (!r || !r.activo) {
      return res.status(401).json({ error: 'Sesión inválida', motivo: 'repartidor_inactivo' });
    }
    // La versión de sesión es lo que cierra los accesos anteriores cuando se
    // restablece una clave o se desactiva a alguien: el token viejo sigue bien
    // firmado, pero ya no coincide con la versión que hay en la base.
    if ((datos.v || 1) !== (r.version_sesion || 1)) {
      return res.status(401).json({ error: 'Sesión cerrada por el administrador', motivo: 'sesion_invalidada' });
    }
    req.repartidor = { id: r.id, nombre: r.nombre, zonas: r.zonas || [] };
    return next();
  }

  const clave = req.headers['x-admin-key'];
  if (clave && clave === process.env.ADMIN_KEY) {
    req.esAdmin = true;
    return next();
  }
  if (process.env.ENTREGA_LEGACY_ENABLED === 'on' &&
      process.env.ENTREGA_KEY && clave === process.env.ENTREGA_KEY) {
    req.repartidor = null;         // sin identidad: no se le atribuye a nadie
    req.esLegado = true;
    return next();
  }

  return res.status(401).json({ error: 'No autorizado' });
 } catch (err) {
  console.error('[Entrega] Error autenticando:', err);
  return res.status(500).json({ error: 'No se pudo verificar la sesión. Intenta de nuevo.' });
 }
});

// Zonas que la sesión tiene permitidas. Un administrador y el modo legado no
// están limitados; un repartidor sí, y el servidor lo comprueba aunque el
// frontend ya lo haya filtrado: lo que manda el navegador no es de fiar.
function zonasPermitidas(req) {
  if (req.esAdmin || req.esLegado) return null;      // null = sin restricción
  return Array.isArray(req.repartidor?.zonas) ? req.repartidor.zonas : [];
}

function puedeConZona(req, zona) {
  const permitidas = zonasPermitidas(req);
  if (permitidas === null) return true;
  if (!zona) return true;            // sin zona declarada no hay qué restringir
  return permitidas.includes(zona);
}

// La página de reparto descarga esto al salir y luego trabaja sin señal.
// Con ?zona= devuelve solo esa ruta, para que dos repartidores trabajen a la
// vez sin verse las listas. Sin zona devuelve todo, como siempre: la versión
// anterior de la app sigue funcionando.
entregaRouter.get('/:fecha', async (req, res) => {
  try {
    const zona = req.query.zona || null;
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const fecha = fechaPedida(req.params.fecha);
    const todos = await db.getPedidosPorFecha(fecha);
    const pedidos = zona ? todos.filter(p => p.zona === zona) : todos;

    // Llegadas ya registradas y punto de referencia del contrato. La app los
    // necesita para no volver a pedir una llegada que ya existe y para avisar
    // "estás a 3 km del punto" antes de que alguien la registre por error.
    // Si la tabla todavía no existe en la base, no se tumba el reparto: se
    // devuelven vacíos y la app opera como antes.
    let llegadas = [], puntos = [];
    try { llegadas = await db.getLlegadasPorFecha(fecha, zona); } catch {}
    try { puntos = await db.getPuntosEntrega(); } catch {}

    // Índice de TODAS las zonas del día, no solo la activa: es lo que permite
    // que el equipo distinga "este número no existe" de "este pedido es de la
    // otra ruta" estando sin señal. Solo número y zona — ningún dato personal.
    const indice_zonas = {};
    for (const p of todos) {
      const n = p.empleados?.numero_empleado;
      if (n) indice_zonas[n] = p.zona || null;
    }

    res.json({
      fecha,
      zona,
      total: pedidos.length,
      entregados: pedidos.filter(p => p.entregado_en).length,
      indice_zonas,
      llegadas,
      puntos: zona ? puntos.filter(p => p.zona === zona) : puntos,
      // La app las necesita para decidir si una entrega salió tardía y pedir
      // el motivo estando SIN SEÑAL, sin volver a preguntarle al servidor.
      turno_hora: TURNO_HORA,
      tolerancia_min: TOLERANCIA_TARDIA_MIN,
      motivos_tardia: MOTIVOS_TARDIA,
      pedidos: pedidos.map(p => ({
        numero_empleado: p.empleados?.numero_empleado || null,
        nombre:          p.empleados?.nombre || null,
        platillo:        p.opcion_texto,
        zona:            p.zona,
        turno:           p.turno,
        entregado_en:    p.entregado_en || null,
        motivo_tardia:   p.motivo_tardia || null,
        // Sin esto, al volver a sincronizar la app perdía de vista que una
        // comida se había dejado con el supervisor y la mostraba como una
        // entrega normal. El repartidor debe poder distinguirlas en su lista.
        entregado_a:     p.entregado_a || null,
        recibido_por:    p.recibido_por || null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Llegada al punto de entrega. Es el evento que decide la puntualidad, no el
// escaneo: repartir 30 box lunch toma diez minutos o más, así que medir comida
// por comida haría que la última siempre saliera tarde aunque el vehículo
// llegara a tiempo. El contrato penaliza el bloque, no la unidad.
//
// Viaja en la misma cola que los escaneos y por eso acepta su propia hora: la
// llegada ocurre en el puerto sin señal y sube después.
entregaRouter.post('/llegada', async (req, res) => {
  try {
    const { fecha, zona, turno, punto, llegada_en, lat, lon, precision_m } = req.body || {};
    if (!fecha || !zona || !turno) {
      return res.status(400).json({ error: 'Se requieren fecha, zona y turno' });
    }
    if (!ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (!TURNOS_VALIDOS.includes(turno)) {
      return res.status(400).json({ error: 'Turno inválido', turnos_validos: TURNOS_VALIDOS });
    }
    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const util = precision_m == null || precision_m <= PRECISION_MAXIMA_M;
    const r = await db.registrarLlegada({
      fecha, zona, turno, punto: punto || '',
      llegada_en: llegada_en || new Date().toISOString(),
      lat: util ? lat : null,
      lon: util ? lon : null,
      precision_m
    });
    res.json({ ...r, precision_descartada: !util });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fijar el punto de entrega del contrato. Se captura desde la tablet parada en
// el andén, que es el único equipo que puede hacerlo bien: el panel corre en
// una PC y ahí la ubicación sale del wifi o de la IP, con cientos de metros de
// error.
//
// Exige ADMIN_KEY y NO acepta la ENTREGA_KEY, a diferencia del resto de este
// router: este punto es la referencia contra la que se mide cada entrega, y si
// el repartidor pudiera moverlo bastaría con fijarlo donde uno esté parado para
// que todo saliera "a 0 m del punto". La evidencia dejaría de valer.
entregaRouter.post('/punto', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Solo la clave de administrador puede fijar el punto de entrega' });
  }
  try {
    const { zona, punto, nombre, direccion, lat, lon, radio_m, precision_m } = req.body || {};
    if (!ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'Se requieren lat y lon numéricas' });
    }
    // Un punto de referencia capturado con mala precisión contamina TODAS las
    // distancias que se calculen después. Aquí el listón es más alto que para
    // una entrega: se mide una vez y se usa durante todo el contrato.
    if (precision_m != null && precision_m > PRECISION_PUNTO_MAXIMA_M) {
      return res.status(400).json({
        error: 'Precisión insuficiente para fijar el punto',
        precision_m, maxima: PRECISION_PUNTO_MAXIMA_M
      });
    }
    const guardado = await db.guardarPuntoEntrega({ zona, punto, nombre, direccion, lat, lon, radio_m });
    res.json({ ok: true, punto: guardado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronización por lotes: el reparto ocurre sin señal, así que llegan
// varias entregas juntas cuando el vehículo recupera cobertura. Cada una
// se responde por separado para que la app sepa cuáles reintentar.
entregaRouter.post('/', async (req, res) => {
  try {
    const { fecha, zona, entregas } = req.body || {};
    if (!fecha || !Array.isArray(entregas)) {
      return res.status(400).json({ error: 'Se requieren fecha y entregas[]' });
    }

    // No se puede entregar comida que todavía no existe. Sin esto, la app —que
    // pedía la fecha de PEDIDO en vez de la de reparto— dejaba marcar como
    // entregados los pedidos de mañana, y una hora de entrega que se puede
    // sellar por anticipado no prueba nada ante el cliente.
    //
    // El corte va contra la fecha del servidor, no la del aparato: un teléfono
    // con el reloj adelantado no debe poder abrir el día siguiente.
    //
    // Se rechaza el lote entero y de forma DEFINITIVA (no es un error pasajero),
    // para que la cola del teléfono lo suelte en vez de reintentarlo por
    // siempre. Fechas pasadas sí pasan: son las colas que se sincronizan tarde.
    if (fecha > hoy()) {
      return res.status(400).json({
        error: 'No se puede registrar una entrega de una fecha futura',
        motivo: 'fecha_futura', fecha, hoy: hoy(), definitivo: true
      });
    }
    // La zona es opcional a propósito: los escaneos que quedaron en la cola de
    // la versión anterior no la traen, y rechazarlos perdería entregas reales.
    // Cuando SÍ viene, se verifica contra la base y no se confía en el filtro
    // del teléfono.
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }

    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const resultados = [];
    for (const e of entregas) {
      const numero = e?.numero_empleado;
      if (!numero) { resultados.push({ numero_empleado: null, ok: false, motivo: 'sin_numero' }); continue; }

      // Una cola formada por un repartidor no se sincroniza como si fuera de
      // otro. Cambiar de usuario ya está bloqueado con cola pendiente, así que
      // esto es la red de seguridad: ante la duda NO se atribuye mal, se
      // rechaza y el elemento se queda para que lo suba quien lo escaneó.
      if (req.repartidor && e?.repartidor_id != null && Number(e.repartidor_id) !== Number(req.repartidor.id)) {
        resultados.push({ numero_empleado: numero, ok: false, motivo: 'otro_repartidor' });
        continue;
      }
      // La zona del elemento también se comprueba contra la sesión: un lote sin
      // zona podría traer elementos de una ruta ajena.
      if (e?.zona && !puedeConZona(req, e.zona)) {
        resultados.push({ numero_empleado: numero, ok: false, motivo: 'zona_no_autorizada' });
        continue;
      }
      // Un motivo inventado no se guarda: solo los del catálogo
      const motivo = MOTIVOS_TARDIA_VALIDOS.includes(e?.motivo_tardia) ? e.motivo_tardia : null;
      try {
        // La zona del elemento manda sobre la del lote: así un escaneo viejo
        // sin zona viaja sin verificar aunque el lote sí la declare.
        const zonaItem = e?.zona !== undefined ? e.zona : zona;
        // La coordenada solo se guarda si el fix sirve. Por encima de este
        // radio el dato vino de antenas y no de satélites: aparenta prueba y
        // no la es, así que se descarta en vez de contaminar la evidencia.
        const util = e?.precision_m == null || e.precision_m <= PRECISION_MAXIMA_M;
        const reloj = horaEntregaConfiable(e?.entregado_en, fecha);
        if (reloj.estimada) {
          console.warn('[Entrega] Hora del equipo descartada (' + reloj.motivo + ') para',
                       numero, 'del', fecha, '— declarada:', reloj.declarada || '(ninguna)');
        }
        const r = await db.marcarEntregado(
          fecha, numero, reloj.hora, motivo, zonaItem || null,
          {
            lat: util ? e?.lat : null,
            lon: util ? e?.lon : null,
            precision_m: e?.precision_m,
            entregado_a: ENTREGADO_A_VALIDOS.includes(e?.entregado_a) ? e.entregado_a : 'empleado',
            recibido_por: typeof e?.recibido_por === 'string' ? e.recibido_por.slice(0, 120) : null,
            // De la SESIÓN, no del cuerpo. Si el equipo pudiera declararse a sí
            // mismo, la atribución no probaría nada. Con la clave compartida
            // queda en nulo: no se sabe quién fue y no se inventa.
            repartidor_id: req.repartidor?.id ?? null,
            repartidor_nombre: req.repartidor?.nombre ?? (req.esLegado ? 'Reparto general' : null)
          }
        );
        resultados.push({
          numero_empleado: numero,
          ok: r.ok,
          // Viaja para que el equipo pueda decir "este pedido es de la otra
          // ruta" en vez de "no existe", que es lo que veía antes.
          zona_esperada: r.zona_esperada || null,
          // Un reintento sobre algo ya entregado viaja como ok con esta marca:
          // la cola del teléfono se vacía y queda constancia de que la hora
          // guardada es la de la primera confirmación, no la de este reintento.
          ya_entregado: r.ya_entregado || false,
          motivo: r.motivo || null,
          nombre: r.pedido?.empleados?.nombre || null,
          entregado_en: r.pedido?.entregado_en || null,
          // Avisa que la hora guardada NO es la del escaneo sino la del
          // servidor, porque la del equipo no era creíble. La entrega vale
          // igual; lo que no vale es presentar esa hora como exacta ante el
          // cliente sin decirlo.
          hora_estimada: reloj.estimada || false
        });
      } catch (err) {
        resultados.push({ numero_empleado: numero, ok: false, motivo: 'error_servidor', detalle: err.message });
      }
    }

    res.json({ fecha, zona: zona || null, confirmadas: resultados.filter(r => r.ok).length, resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
