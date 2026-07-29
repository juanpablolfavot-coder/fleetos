#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  Alta y control del webhook de Powerfleet
//
//  Con el webhook, la alerta de exceso de velocidad llega en el momento en vez
//  de esperar al sondeo (hasta 2 minutos). El sondeo se mantiene: el webhook
//  solo adelanta la apertura del evento.
//
//  Orden recomendado (desde el Shell de Render, que es donde están las
//  credenciales y la base):
//
//    1)  node scripts/webhook-powerfleet.js tipos      ← qué eventos ofrece la cuenta
//    2)  node scripts/webhook-powerfleet.js listar     ← qué hay registrado hoy
//    3)  node scripts/webhook-powerfleet.js alta       ← registra el nuestro
//    4)  node scripts/webhook-powerfleet.js estado     ← qué avisos fueron llegando
//
//  Antes del alta hacen falta dos variables de entorno en Render:
//    GPS_WEBHOOK_SECRET=<string aleatorio largo>   (la puerta del endpoint)
//    FRONTEND_URL=https://fleetos-bn5v.onrender.com  (o GPS_WEBHOOK_URL)
//
//  Otros comandos:
//    baja <id>       da de baja una suscripción
//    simular [kmh]   inyecta un aviso de prueba SIN tocar Powerfleet, para
//                    verificar de punta a punta que llega la notificación
// ═══════════════════════════════════════════════════════════════════════
require('dotenv').config();
const webhook = require('../services/webhook-powerfleet');

const [, , comando = 'ayuda', ...resto] = process.argv;
const flag = (n, def = null) => {
  const i = resto.indexOf('--' + n);
  return i >= 0 && resto[i + 1] ? resto[i + 1] : def;
};

function mostrar(x) { console.log(JSON.stringify(x, null, 2)); }

async function main() {
  switch (comando) {
    case 'tipos': {
      const gps = require('../services/gps-powerfleet');
      const res = await gps.apiRequest('/Fleetcore.api/api/webhooks/types');
      console.log('HTTP', res.status);
      try {
        const d = JSON.parse(res.body);
        (d.data || []).forEach((t) => console.log(`  ${t.webhookType}: ${t.name}`));
      } catch (_) { console.log(res.body.slice(0, 500)); }
      break;
    }

    case 'listar': {
      const r = await webhook.listar();
      console.log('HTTP', r.status);
      if (!r.webhooks.length) console.log('  (ninguna suscripción registrada)');
      r.webhooks.forEach((w) => console.log(`  id=${w.id ?? w.Id}  tipo=${w.webhookType}  ${w.name || w.Name}\n     → ${w.url || w.URL}\n     vence: ${w.expirationDate || '—'}`));
      break;
    }

    case 'alta': {
      const url = flag('url') || webhook.urlPublica();
      if (!url) {
        console.error('❌ No se pudo armar la URL pública.');
        console.error('   Configurá GPS_WEBHOOK_SECRET y FRONTEND_URL (o pasá --url https://.../api/gps/webhook/<secreto>).');
        process.exit(1);
      }
      console.log('URL a registrar:', url);
      const r = await webhook.alta({
        url,
        nombre: flag('nombre'),
        accountId: flag('cuenta'),
        dias: parseInt(flag('dias', '365'), 10),
      });
      console.log(r.ok ? '\n✅ Alta OK' : '\n❌ El alta falló');
      console.log('\nVariantes probadas:'); mostrar(r.intentos);
      console.log('\nCuerpo que se envió en el último intento:'); mostrar(r.cuerpo);
      console.log('\nRespuesta del proveedor (HTTP ' + r.status + '):'); mostrar(r.respuesta);
      if (!r.ok) {
        console.log('\nSi se queja por un campo que falta, pasalo a mano:');
        console.log('  node scripts/webhook-powerfleet.js alta --cuenta <AccountId>');
      } else {
        console.log('\nAhora esperá a que una unidad pase de su límite y mirá:');
        console.log('  node scripts/webhook-powerfleet.js estado');
      }
      break;
    }

    case 'baja': {
      const id = resto[0];
      if (!id) { console.error('Falta el id. Sacalo de: node scripts/webhook-powerfleet.js listar'); process.exit(1); }
      mostrar(await webhook.baja(id));
      break;
    }

    case 'estado': {
      const e = await webhook.ultimos(flag('limite', 20));
      console.log('Configurado:', e.configurado ? 'sí' : 'NO (falta GPS_WEBHOOK_SECRET)');
      console.log('URL:', e.url || '—');

      // La mitad que no se ve desde la base: si Powerfleet todavía la tiene
      // registrada. Sin esto, "no llegó nada" no distingue entre "no hubo
      // excesos" y "la suscripción se cayó".
      const l = await webhook.listar().catch((err) => ({ status: 0, webhooks: [], error: err.message }));
      if (l.status !== 200) {
        console.log('Del lado de Powerfleet: no se pudo consultar (HTTP ' + l.status + ')');
      } else {
        const mia = l.webhooks.find((w) => String(w.url || w.URL || '') === webhook.urlPublica());
        console.log('Del lado de Powerfleet:', mia
          ? `registrada (id ${mia.id ?? mia.Id}, tipo ${mia.webhookType}, vence ${webhook.fechaUtil(mia.expirationDate) ? mia.expirationDate : 'sin declarar'})`
          : `❌ NO figura — el aviso no va a llegar. Correr: node ${require('path').basename(__filename)} alta`);
        if (l.webhooks.length > 1) console.log(`  (hay ${l.webhooks.length} suscripciones en la cuenta)`);
      }

      console.log(`\nAvisos recibidos: ${e.resumen.total} (procesados: ${e.resumen.procesados}) · último: ${e.resumen.ultimo || 'ninguno'}\n`);
      if (!e.eventos.length) {
        console.log('Todavía no llegó ningún aviso. Puede ser normal: solo llegan cuando');
        console.log('Powerfleet detecta un exceso según SU umbral.');
        break;
      }
      e.eventos.forEach((v) => {
        console.log(`#${v.id}  ${new Date(v.recibido_at).toLocaleString('es-AR')}  ${v.patente || '—'}  ${v.velocidad ?? '—'} km/h`);
        console.log(`      ${v.resultado || '(sin procesar)'}`);
      });
      console.log('\nPayload crudo del último (así se ve lo que manda el proveedor):');
      mostrar(e.eventos[0].payload);
      break;
    }

    // Prueba de punta a punta sin depender de que una unidad pase de velocidad:
    // arma un aviso con la forma más probable y lo pasa por el mismo camino que
    // usaría el real. Si la unidad supera su límite, tiene que salir el push.
    case 'simular': {
      const kmh = parseFloat(resto[0]) || 95;
      const patente = flag('patente', 'AA111AA');
      const r = await webhook.procesar({
        webhookType: 1,
        data: { vehicle: { licensePlate: patente, speed: kmh }, eventDate: new Date().toISOString() },
      });
      console.log('Aviso simulado #' + r.id);
      console.log('Resultado:', r.resultado);
      break;
    }

    default:
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌', e.message); process.exit(1); });
