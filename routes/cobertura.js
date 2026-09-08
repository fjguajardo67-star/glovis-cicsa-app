// routes/cobertura.js — API de supervisores para coberturas del segundo turno

import express from 'express';
import * as db from '../services/supabase.js';
import * as cobertura from '../services/cobertura.js';
import {
  verificarClave, emitirTokenSupervisor, leerTokenSupervisor,
  registrarIntento, limpiarIntentos, DURACION_SUPERVISOR_HORAS
} from '../services/sesion.js';

export const coberturaRouter = express.Router();

// La clave personal solo viaja una vez. La sesión queda firmada y con scope
// propio para que no sirva en la app de reparto.
coberturaRouter.post('/login', async (req, res) => {
  try {
    const numero = String(req.body?.numero_empleado || '').trim();
    const clave = String(req.body?.clave || '').trim();
    const origen = 'cobertura:' + (req.ip || req.headers['x-forwarded-for'] || 'sin_origen');
    const { bloqueado } = registrarIntento(origen);
    if (bloqueado) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    if (!numero || !clave) return res.status(400).json({ error: 'Escribe tu número de empleado y tu clave.' });

    const supervisor = await db.getSupervisorCoberturaParaLogin(numero);
    const fecha = cobertura.fechaCobertura();
    const vigente = supervisor && supervisor.activo && supervisor.empleados?.activo &&
      supervisor.vigente_desde <= fecha &&
      (!supervisor.vigente_hasta || supervisor.vigente_hasta >= fecha);
    if (!vigente || !(await verificarClave(clave, supervisor.clave_hash))) {
      return res.status(401).json({ error: 'Número o clave incorrectos.' });
    }

    limpiarIntentos(origen);
    const token = emitirTokenSupervisor(supervisor);
    res.json({
      token,
      expires_at: new Date(Date.now() + DURACION_SUPERVISOR_HORAS * 3600 * 1000).toISOString(),
      supervisor: {
        id: supervisor.id,
        numero_empleado: supervisor.empleados.numero_empleado,
        nombre: supervisor.empleados.nombre
      }
    });
  } catch (err) {
    console.error('[Cobertura] Error de acceso:', err);
    res.status(500).json({ error: 'No se pudo verificar el acceso. Intenta de nuevo.' });
  }
});

coberturaRouter.use(async (req, res, next) => {
  try {
    const cabecera = req.headers.authorization || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.', motivo: 'sin_sesion' });
    const datos = leerTokenSupervisor(token);
    if (!datos) return res.status(401).json({ error: 'Sesión inválida.', motivo: 'token_invalido' });
    if (datos.vencido) return res.status(401).json({ error: 'Tu sesión venció.', motivo: 'token_vencido' });

    const supervisor = await db.getSupervisorCobertura(datos.id);
    const fecha = cobertura.fechaCobertura();
    const vigente = supervisor && supervisor.activo && supervisor.empleados?.activo &&
      supervisor.vigente_desde <= fecha &&
      (!supervisor.vigente_hasta || supervisor.vigente_hasta >= fecha);
    if (!vigente) return res.status(401).json({ error: 'Tu autorización ya no está activa.', motivo: 'supervisor_inactivo' });
    if ((datos.v || 1) !== (supervisor.version_sesion || 1)) {
      return res.status(401).json({ error: 'El administrador cerró esta sesión.', motivo: 'sesion_invalidada' });
    }
    req.supervisor = supervisor;
    next();
  } catch (err) {
    console.error('[Cobertura] Error validando sesión:', err);
    res.status(500).json({ error: 'No se pudo validar la sesión.' });
  }
});

coberturaRouter.get('/estado', async (req, res) => {
  try {
    const estado = await cobertura.estadoSupervisor(req.supervisor.id);
    res.json({
      ...estado,
      supervisor: {
        id: req.supervisor.id,
        numero_empleado: req.supervisor.empleados.numero_empleado,
        nombre: req.supervisor.empleados.nombre
      }
    });
  } catch (err) {
    console.error('[Cobertura] Error consultando estado:', err);
    res.status(500).json({ error: 'No se pudo consultar el menú especial.' });
  }
});

// Búsqueda puntual, nunca descarga la plantilla. El supervisor ya conoce el
// número que captura; la respuesta solo confirma que no se equivocó.
coberturaRouter.get('/empleado/:numero', async (req, res) => {
  try {
    const empleado = await db.getEmpleadoPorNumero(req.params.numero);
    if (!empleado) return res.status(404).json({ error: 'No encontramos ese número en la plantilla activa.' });
    res.json({ empleado: { numero_empleado: empleado.numero_empleado, nombre: empleado.nombre } });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo consultar al empleado.' });
  }
});

coberturaRouter.post('/solicitud', async (req, res) => {
  try {
    const solicitud = await cobertura.guardarSolicitud(req.supervisor.id, req.body || {});
    res.json({ ok: true, solicitud });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, motivo: err.motivo, detalle: err.detalle });
  }
});

coberturaRouter.delete('/solicitud', async (req, res) => {
  try {
    await cobertura.cancelarSolicitud(req.supervisor.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, motivo: err.motivo });
  }
});
