// services/telefono.js — Normalización de teléfonos para México
//
// Problema: WhatsApp envía los números mexicanos como 521 + 10 dígitos
// (el "1" después del 52), pero las listas de empleados a veces se capturan
// como 52 + 10 dígitos (sin el "1"). Esto causa que el bot no reconozca a la
// persona aunque sí esté registrada.
//
// Solución: para cualquier número, generamos TODAS sus variantes equivalentes
// para poder buscarlo sin importar cómo se haya guardado o cómo llegue.

// Devuelve solo los dígitos de un string
function soloDigitos(tel) {
  return String(tel || '').replace(/\D/g, '');
}

// Extrae los 10 dígitos "nacionales" de un número mexicano,
// quitando el código de país 52 y el "1" de móvil si existen.
export function diezDigitos(tel) {
  let d = soloDigitos(tel);
  // Quitar prefijo 52 (país) y luego 1 (móvil) si están presentes
  if (d.startsWith('52')) d = d.slice(2);
  if (d.startsWith('1') && d.length === 11) d = d.slice(1);
  // Si quedan más de 10 (caso 1 + 10), recortar al final
  if (d.length > 10) d = d.slice(-10);
  return d;
}

// Genera todas las variantes equivalentes de un número mexicano:
//   - 10 dígitos              (6361037574)
//   - 52 + 10                 (526361037574)
//   - 521 + 10                (5216361037574)
// Devuelve un array sin duplicados, útil para buscar con .in()
export function variantesTelefono(tel) {
  const base = diezDigitos(tel);
  if (base.length !== 10) {
    // No es un número mexicano estándar: devolver tal cual en dígitos
    const d = soloDigitos(tel);
    return [...new Set([d, tel].filter(Boolean))];
  }
  return [...new Set([
    base,             // 6361037574
    '52' + base,      // 526361037574
    '521' + base,     // 5216361037574
  ])];
}

// Formato canónico que usaremos para GUARDAR nuevos empleados:
// siempre 521 + 10 dígitos, que es como WhatsApp identifica a México.
export function formatoCanonico(tel) {
  const base = diezDigitos(tel);
  if (base.length !== 10) return soloDigitos(tel);
  return '521' + base;
}
