// public/sw.js — Service worker de CICSA Go Lunch
//
// Existe por el reparto: las entregas se escanean al aire libre en los puertos,
// donde no hay señal. La app de entrega ya guardaba su lista y su cola en el
// dispositivo, pero la PÁGINA seguía necesitando red para abrir; si el
// repartidor cerraba la app a media ruta, ya no volvía a entrar. Con esto el
// arranque también vive en el dispositivo.
//
// Al cambiar los archivos de /public hay que subirle el número a VERSION: eso
// tira el caché viejo. Las páginas van por red primero, así que se actualizan
// solas; el número importa sobre todo para íconos y librerías.
const VERSION = 'v20';
const CACHE = 'golunch-' + VERSION;

// jsQR viene de un CDN y es lo que lee los códigos con la cámara: sin él la
// página abre pero no escanea, así que se guarda igual que lo propio.
const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

const PRECARGA = [
  '/entrega.html',
  '/entrega.css',
  '/pedido.html',
  '/app-entrega.webmanifest',
  '/app-pedido.webmanifest',
  '/favicon.ico',
  '/icono-16.png',
  '/icono-32.png',
  '/icono-180.png',
  '/icono-192.png',
  '/icono-512.png',
  '/golunch-mark.png',
  '/golunch-compacto.png',
  '/golunch-lateral.png',
  '/glovis-logo.png',
  JSQR
];

const HTML_SIN_CONEXION = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sin conexión — Go Lunch</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f4f6fb;
color:#0d1b3e;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;padding:24px;max-width:340px">
<div style="font-size:2.4rem;margin-bottom:10px">📡</div>
<h1 style="font-size:1.15rem;margin-bottom:8px">Sin conexión</h1>
<p style="font-size:.9rem;color:#5a6480;line-height:1.5">
Esta pantalla necesita señal. La app de entrega sí funciona sin conexión:
ábrela desde su acceso directo.</p></div></body></html>`;

// Instalación: se guarda cada recurso por separado a propósito. Con addAll,
// un solo archivo caído (el CDN, por ejemplo) tumbaría toda la instalación y
// la app se quedaría sin service worker.
self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECARGA.map(async url => {
      try {
        // cache: 'reload' evita guardar una copia ya vieja del navegador
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[SW] No se pudo precargar', url, err.message);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Red primero: la copia guardada es el respaldo, no la fuente. Así un cambio
// publicado llega en cuanto hay señal y una versión rota se corrige sola.
async function redPrimero(peticion) {
  try {
    const respuesta = await fetch(peticion);
    // Las redirecciones no se guardan: la raíz manda a /pedido.html, y una
    // respuesta con bandera de redirigido, servida después desde caché para
    // una navegación, el navegador la rechaza y la pantalla queda en blanco.
    // La página destino sí se cachea cuando se pide directo.
    if (respuesta && respuesta.ok && !respuesta.redirected) {
      const cache = await caches.open(CACHE);
      cache.put(peticion, respuesta.clone());
    }
    return respuesta;
  } catch {
    const guardada = await caches.match(peticion, { ignoreSearch: true });
    return guardada || new Response(HTML_SIN_CONEXION, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// Caché primero: para lo que no cambia (íconos, jsQR). Ahorra red en la ruta.
async function cachePrimero(peticion) {
  const guardada = await caches.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta && respuesta.ok) {
    const cache = await caches.open(CACHE);
    cache.put(peticion, respuesta.clone());
  }
  return respuesta;
}

// Qué se guarda por archivo, en lista blanca. Va al revés de lo obvio —en vez
// de excluir la API, se incluye solo lo estático— porque los endpoints del
// servidor no viven todos bajo /api: los del empleado cuelgan de /pedido
// (ver index.js). Con una lista de exclusión, /pedido/estado se habría
// cacheado y el menú del día se congelaba. Con esta, cualquier ruta nueva
// del servidor pasa derecho a la red aunque nadie se acuerde de tocar este
// archivo. Ojo: .js queda fuera a propósito, para no interceptar /sw.js.
const ESTATICO = /\.(png|jpe?g|svg|gif|ico|webmanifest|css|woff2?)$/i;

self.addEventListener('fetch', evento => {
  const peticion = evento.request;

  // Todo lo que escribe (subir entregas, registrar pedidos) va derecho a la
  // red. Nunca se responde desde caché: una entrega que el repartidor cree
  // subida y no subió es peor que un error a la vista.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  const propio = url.origin === self.location.origin;

  // Las páginas van por red primero, con la copia guardada de respaldo.
  if (peticion.mode === 'navigate') {
    evento.respondWith(redPrimero(peticion));
    return;
  }

  if (peticion.url === JSQR || (propio && ESTATICO.test(url.pathname))) {
    evento.respondWith(cachePrimero(peticion));
  }
  // Lo demás —la API en /api y en /pedido— ni se toca: la lista del día y el
  // estado del comedor cambian durante el servicio, y la app de entrega ya
  // guarda su propia copia offline.
});
