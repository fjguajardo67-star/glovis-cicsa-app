// services/sesion.js — Claves y sesiones de los repartidores
//
// Todo con módulos nativos de Node: nada de bcrypt ni de dependencias que
// compilan binarios, porque este proyecto se despliega en Railway desde un
// push y una dependencia nativa rota deja al comedor sin app un martes a las
// nueve de la mañana.
//
// Dos cosas viven aquí:
//   1. El hash de la clave del repartidor (scrypt).
//   2. El token de sesión firmado (HMAC-SHA256).

import crypto from 'node:crypto';

// ── Claves ────────────────────────────────────────────────────
// scrypt es lento a propósito: encarece probar claves por fuerza bruta. Los
// parámetros van GUARDADOS en el propio hash para poder subirlos después sin
// invalidar las claves ya emitidas.
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, LARGO = 32;

function scryptAsync(clave, sal, N, r, p, largo) {
  return new Promise((resolve, reject) => {
    // maxmem por defecto no alcanza para N=16384; se calcula con holgura.
    crypto.scrypt(clave, sal, largo, { N, r, p, maxmem: 256 * N * r }, (err, dk) => {
      if (err) reject(err); else resolve(dk);
    });
  });
}

export async function hashClave(clave) {
  if (typeof clave !== 'string' || clave.length < 4) {
    throw new Error('La clave debe tener al menos 4 caracteres');
  }
  const sal = crypto.randomBytes(16);
  const dk = await scryptAsync(clave, sal, SCRYPT_N, SCRYPT_R, SCRYPT_P, LARGO);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, sal.toString('base64'), dk.toString('base64')].join('$');
}

export async function verificarClave(clave, guardado) {
  try {
    if (typeof clave !== 'string' || typeof guardado !== 'string') return false;
    const [alg, N, r, p, salB64, hashB64] = guardado.split('$');
    if (alg !== 'scrypt') return false;
    const sal = Buffer.from(salB64, 'base64');
    const esperado = Buffer.from(hashB64, 'base64');
    const dk = await scryptAsync(clave, sal, Number(N), Number(r), Number(p), esperado.length);
    // timingSafeEqual y no ===: comparar byte por byte con salida temprana
    // filtra cuántos caracteres acertaste por el tiempo que tarda.
    return dk.length === esperado.length && crypto.timingSafeEqual(dk, esperado);
  } catch { return false; }
}

// Clave legible para dictarla por teléfono. Sin caracteres que se confundan
// (0/O, 1/l/I): el administrador se la lee al repartidor y un error ahí
// significa una llamada más.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generarClave(largo = 8) {
  const bytes = crypto.randomBytes(largo);
  let s = '';
  for (let i = 0; i < largo; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s;
}

// ── Tokens de sesión ──────────────────────────────────────────
// Firmados, no cifrados: el contenido se puede leer, pero no falsificar sin el
// secreto. No llevan nada sensible — solo id, versión y expiración.
const b64url = b => Buffer.from(b).toString('base64url');

function secreto() {
  const s = process.env.ENTREGA_SESSION_SECRET;
  if (!s) throw new Error('ENTREGA_SESSION_SECRET no está configurada en el servidor');
  return s;
}

function firmar(datos) {
  return crypto.createHmac('sha256', secreto()).update(datos).digest('base64url');
}

export const DURACION_SESION_HORAS = 16;

export function emitirToken(repartidor, horas = DURACION_SESION_HORAS) {
  const exp = Date.now() + horas * 3600 * 1000;
  // v = versión de sesión. Al restablecer la clave o desactivar al repartidor
  // se le sube el número en la base y todos los tokens viejos dejan de valer
  // sin tener que llevar una lista de tokens revocados.
  const carga = b64url(JSON.stringify({ id: repartidor.id, v: repartidor.version_sesion || 1, exp }));
  return carga + '.' + firmar(carga);
}

export function leerToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const i = token.lastIndexOf('.');
  const carga = token.slice(0, i), firma = token.slice(i + 1);
  const esperada = firmar(carga);
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    if (!d || typeof d.id === 'undefined' || !d.exp) return null;
    if (Date.now() > d.exp) return { vencido: true, id: d.id };
    return d;
  } catch { return null; }
}

// ── Límite de intentos ────────────────────────────────────────
// En memoria: hay una sola instancia en Railway y esto es un freno contra
// probar claves a mano o con un script simple, no un antifraude distribuido.
// Se cuenta por origen Y en total: un atacante que rote IPs se topa con el
// segundo contador.
const intentos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
const MAX_POR_ORIGEN = 10;
const MAX_TOTAL = 60;

export function registrarIntento(origen) {
  const ahora = Date.now();
  for (const [k, v] of intentos) if (ahora - v.desde > VENTANA_MS) intentos.delete(k);
  const clave = origen || 'sin_origen';
  const e = intentos.get(clave) || { n: 0, desde: ahora };
  e.n++; e.desde = e.desde || ahora;
  intentos.set(clave, e);
  const total = [...intentos.values()].reduce((s, x) => s + x.n, 0);
  return { bloqueado: e.n > MAX_POR_ORIGEN || total > MAX_TOTAL, intentos: e.n };
}

export function limpiarIntentos(origen) {
  intentos.delete(origen || 'sin_origen');
}
