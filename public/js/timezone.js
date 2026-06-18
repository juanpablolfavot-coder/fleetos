// FleetOS — zona horaria única del sistema
// Argentina no cambia por horario de verano: siempre usamos America/Argentina/Buenos_Aires.
(function () {
  const TZ = 'America/Argentina/Buenos_Aires';
  const pad2 = (n) => String(n).padStart(2, '0');

  function toDate(value) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    // Si viene "YYYY-MM-DD HH:mm:ss-03" o "YYYY-MM-DD HH:mm:ss", JS lo entiende mejor con T.
    const txt = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(txt) ? txt.replace(' ', 'T') : txt;
    const d = new Date(normalized);
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
