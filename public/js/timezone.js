// FleetOS — zona horaria única del sistema
// Argentina no cambia por horario de verano: siempre usamos America/Argentina/Buenos_Aires.

// ── Escape HTML (anti-XSS) ──────────────────────────────────────────────
// Convierte caracteres peligrosos en su entidad para que un dato de usuario
// se muestre SIEMPRE como texto y nunca se ejecute como HTML/JS.
// Seguro para texto y para atributos entre comillas. NO usar dentro de
// strings de JavaScript (ej: onclick="algo('...')"), ahí no aplica.
window.escapeHtml = function (value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// ── Escape para argumento dentro de un string JS en un atributo HTML ──────
// Para el patrón onclick="fn('${valor}')": el valor vive a la vez dentro de un
// string JS con comillas simples Y dentro de un atributo HTML con comillas
// dobles. escapeHtml NO sirve acá (el navegador des-escapa las entidades antes
// de que corra el JS, así que un &#39; vuelve a ser ' y rompe el string).
//   - \  y  '   se escapan al estilo JS (\\ y \') para no cerrar el string.
//   - "  <  >   se pasan a entidad para no cerrar el atributo ni la etiqueta.
//   - saltos de línea se neutralizan (romperían el literal JS).
window.escapeJsArg = function (value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
};

(function () {
  const TZ = 'America/Argentina/Buenos_Aires';
  const pad2 = (n) => String(n).padStart(2, '0');

  function toDate(value) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    const raw = String(value).trim();

    // 1) Intento directo. Postgres devuelve "YYYY-MM-DD HH:MM:SS.ffffff-03"
    //    (con espacio y offset corto), y V8 ESO lo parsea bien.
    //    OJO: antes se hacía replace(' ','T') siempre, y con la 'T' el motor pasa
    //    a modo ISO estricto donde el offset "-03" (sin ":00") es inválido →
    //    new Date() caía al fallback = AHORA, y todo figuraba con la hora de recarga.
    let d = new Date(raw);
    if (!isNaN(d.getTime())) return d;

    // 2) Fallback: normalizar a ISO estricto (T, milisegundos de 3 dígitos,
    //    offset "±HH" → "±HH:00") por si algún formato no parseó directo.
    const iso = raw
      .replace(' ', 'T')
      .replace(/(\.\d{3})\d+/, '$1')
      .replace(/([+-]\d{2})$/, '$1:00');
    d = new Date(iso);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  function parts(value) {
    const d = toDate(value);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, hourCycle: 'h23'
    });
    const obj = {};
    for (const p of formatter.formatToParts(d)) obj[p.type] = p.value;
    return {
      year: obj.year,
      month: obj.month,
      day: obj.day,
      hour: obj.hour === '24' ? '00' : obj.hour,
      minute: obj.minute,
      second: obj.second
    };
  }

  function dateInputAR(value) {
    const p = parts(value);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function datetimeLocalAR(value) {
    const p = parts(value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function displayAR(value) {
    return datetimeLocalAR(value).replace('T', ' ');
  }

  function dateDisplayAR(value) {
    const p = parts(value);
    return `${p.day}/${p.month}/${p.year}`;
  }

  function dateTimeDisplayAR(value) {
    const p = parts(value);
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  }

  function timeAR(value) {
    const p = parts(value);
    return `${p.hour}:${p.minute}`;
  }

  function ymdCompactAR(value) {
    const p = parts(value);
    return `${p.year}${p.month}${p.day}`;
  }

  // Timestamp de Argentina para guardar en memoria local o enviar cuando haga falta.
  // Ej.: 2026-06-17T21:35:00-03:00
  function isoAR(value) {
    const p = parts(value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
  }

  window.FleetTime = {
    TZ,
    dateInputAR,
    datetimeLocalAR,
    displayAR,
    dateDisplayAR,
    dateTimeDisplayAR,
    timeAR,
    ymdCompactAR,
    isoAR,
  };

  window.todayISO = window.todayISO || (() => dateInputAR());
  window.nowDatetimeLocal = window.nowDatetimeLocal || (() => datetimeLocalAR());
  window.nowTimeAR = window.nowTimeAR || (() => timeAR());
  window.nowDateAR = window.nowDateAR || (() => dateDisplayAR());
})();
