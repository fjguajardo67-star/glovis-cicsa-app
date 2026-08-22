// routes/pedido.js — API pública que consume la página web del empleado
//
// Va montada aparte de /api a propósito: ese router exige ADMIN_KEY y el
// empleado no la tiene. Aquí la identificación es el número de empleado,
// el mismo nivel de confianza que ya usa el bot con el número de WhatsApp.
//
// El número de empleado viaja siempre en el cuerpo del POST, nunca en la URL,
// para que no quede registrado en logs ni en el historial del navegador.

import express from 'express';
import * as pedidos from '../services/pedidos.js';
import * as db from '../services/supabase.js';
import { hoyMenos } from '../services/menu.js';

export const pedidoRouter = express.Router();

// Estado del día: qué fecha se está pidiendo, el menú y si sigue abierto.
// No expone datos de ningún empleado, así que puede ser GET.
pedidoRouter.get('/estado', async (req, res) => {
  try {
    res.json(await pedidos.estadoDelDia());
  } catch (err) {
    console.error('[Pedido] Error consultando estado:', err);
    res.status(500).json({ error: 'No se pudo consultar el menú. Intenta de nuevo.' });
  }
});

// Identificación: devuelve el nombre, la asignación de RRHH y el pedido que
// ya tenga registrado, para que la página pueda precargar todo.
pedidoRouter.post('/identificar', async (req, res) => {
  try {
    const { numero_empleado } = req.body || {};
    if (!numero_empleado) {
      return res.status(400).json({ error: 'Falta tu número de empleado.' });
    }

    const empleado = await db.getEmpleadoPorNumero(numero_empleado);
    if (!empleado) {
      return res.status(404).json({
        error: 'No encontramos ese número de empleado. Verifícalo o contacta a Recursos Humanos.'
      });
    }

    // Si ya pidió para la fecha de servicio, lo devolvemos para poder editarlo
    const fecha = await pedidos.fechaServicio();
    let pedidoActual = null;
    if (fecha) {
      const delDia = await db.getPedidosPorFecha(fecha);
      pedidoActual = delDia.find(p => p.empleado_telefono === empleado.telefono) || null;
    }

    // Queda constancia de que esta persona consultó el menú de ese día, haya
    // pedido o no. Es lo que separa "no le gustó" de "no se enteró": sin este
    // registro, los dos se ven idénticos en el panel y llevan a decisiones
    // opuestas. Envuelto y silencioso a propósito: es una bitácora de consulta
    // y jamás debe impedir que alguien pida si la tabla falta o falla.
    if (fecha) {
      try { await db.registrarAcceso(fecha, empleado.telefono); } catch {}
    }

    // ¿Trae algo entregado sin calificar de los últimos días?
    let porCalificar = null;
    try {
      // En zona del comedor, no en UTC: con toISOString() el borde de la
      // ventana se corría un día a partir de las 18:00 locales, justo en las
      // dos horas en que la gente alcanza a pedir antes del corte de las 8 PM.
      porCalificar = await db.pedidoPorCalificar(empleado.telefono, hoyMenos(7));
    } catch { /* calificar es opcional: nunca debe impedir pedir */ }

    res.json({
      empleado: {
        nombre:          empleado.nombre,
        numero_empleado: empleado.numero_empleado,
        zona_default:    empleado.zona_default,
        turno_default:   empleado.turno_default
      },
      pedido_actual: pedidoActual,
      por_calificar: porCalificar
    });
  } catch (err) {
    console.error('[Pedido] Error identificando empleado:', err);
    res.status(500).json({ error: 'No se pudo verificar tu número. Intenta de nuevo.' });
  }
});

// Calificar un pedido ya entregado. Se le pregunta al empleado cuando vuelve
// a la página, antes de mostrarle el menú del día.
pedidoRouter.post('/rating', async (req, res) => {
  try {
    const { numero_empleado, fecha, rating } = req.body || {};
    if (!numero_empleado || !fecha || !['si', 'tal_vez', 'no'].includes(rating)) {
      return res.status(400).json({ error: 'Datos incompletos para calificar.' });
    }
    const empleado = await db.getEmpleadoPorNumero(numero_empleado);
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

    const ok = await db.calificarPedido(fecha, empleado.telefono, rating);
    if (!ok) return res.status(404).json({ error: 'No hay pedido entregado para calificar.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Pedido] Error guardando rating:', err);
    res.status(500).json({ error: 'No se pudo guardar tu respuesta.' });
  }
});

// Registrar o cambiar el pedido. `zona` y `turno` son opcionales: sin ellos
// se hereda la asignación de RRHH.
pedidoRouter.post('/', async (req, res) => {
  try {
    const { numero_empleado, opcion_id, zona, turno, fecha_esperada } = req.body || {};
    if (!numero_empleado || !opcion_id) {
      return res.status(400).json({ error: 'Falta tu número de empleado o el platillo.' });
    }

    // Se EXIGE en la web, no solo se acepta. Una página tan vieja que ni
    // siquiera la manda es justo la que trae el menú equivocado en pantalla:
    // dejarla pasar sería mantener abierto el hueco para el único caso que
    // esta comprobación existe para tapar. El mensaje dice qué hacer, y
    // recargar cuesta un segundo. WhatsApp no pasa por aquí (va por
    // routes/webhook.js), así que ese canal no se ve afectado.
    if (!fecha_esperada) {
      return res.status(409).json({
        error: 'Tu página está desactualizada. Recárgala y vuelve a elegir tu platillo.',
        motivo: 'estado_desactualizado'
      });
    }

    const resultado = await pedidos.crearPedido({ numero_empleado, opcion_id, zona, turno, fecha_esperada });

    if (!resultado.ok) {
      // 404 si no lo conocemos, 409 si el comedor ya cerró o el estado quedó
      // viejo, 400 si el dato viene mal
      const status = resultado.motivo === 'no_registrado' ? 404
                   : ['fuera_de_horario', 'sin_menu', 'estado_desactualizado'].includes(resultado.motivo) ? 409
                   : 400;
      return res.status(status).json({
        error: resultado.mensaje, motivo: resultado.motivo,
        // Viajan para que la página pueda decir qué cambió en vez de un error
        // pelón, y recargar sola sobre el menú correcto.
        fecha_esperada: resultado.fecha_esperada, fecha_actual: resultado.fecha_actual
      });
    }

    res.json(resultado);
  } catch (err) {
    console.error('[Pedido] Error registrando pedido:', err);
    res.status(500).json({ error: 'No se pudo registrar tu pedido. Intenta de nuevo.' });
  }
});
