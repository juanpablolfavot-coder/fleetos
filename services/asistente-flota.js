// ════════════════════════════════════════════════════════════════════
//  Asistente de flota — preguntar en criollo
//
//  Reemplaza lo último que hacía el agente de WhatsApp: poder escribir
//  "¿dónde está el AH327RZ?" y que conteste con datos reales.
//
//  La diferencia con el endpoint /api/auditor/ia —que es un proxy ciego, le
//  mandás la pregunta y el contexto va armado a mano desde el frontend— es
//  que acá el modelo tiene HERRAMIENTAS: decide qué consultar y consulta.
//  Así no hay que adivinar de antemano qué datos va a necesitar.
//
//  Las herramientas leen de services/flota-datos.js, el mismo módulo que
//  alimenta la pantalla. Si el asistente y la pantalla dieran números
//  distintos, no se sabría a cuál creerle.
//
//  Requiere ANTHROPIC_API_KEY. Sin eso el endpoint responde 503 y el resto
//  de la app sigue funcionando igual.
// ════════════════════════════════════════════════════════════════════
const Anthropic = require('@anthropic-ai/sdk');
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const datos = require('./flota-datos');

const MODELO = 'claude-opus-5';
// Techo de salida. En este modelo el pensamiento va contra el mismo cupo que la
// respuesta, así que hay que dejar aire: con poco margen la respuesta se corta
// a la mitad.
const MAX_TOKENS = 4096;
// Preguntas cortas sobre datos concretos: no hace falta el esfuerzo máximo, y
// menos esfuerzo es menos espera para el que está mirando el celular.
const ESFUERZO = 'medium';
// Cuántos turnos previos se aceptan del cliente. Sin tope, una charla larga
// crece sin control y encarece cada pregunta.
const MAX_HISTORIAL = 12;

const SISTEMA = `Sos el asistente de flota de Expreso Biletta, una empresa de transporte argentina.
Contestás preguntas del DUEÑO sobre su flota, en español rioplatense, con el "vos".

CÓMO CONTESTAR
- Andá al grano. Una o dos frases alcanzan para la mayoría de las preguntas.
- Datos concretos: patente, dirección, hora, número. Nada de rodeos ni disclaimers.
- Si la respuesta es una lista, poné como mucho las 5 más relevantes y decí cuántas quedan.
- No uses tablas ni markdown pesado: esto se lee en un celular.

DE DÓNDE SACÁS LOS DATOS
- SIEMPRE de las herramientas. Nunca inventes una posición, una velocidad ni un número.
- Si una herramienta no encuentra la unidad, decilo y pedí la patente completa.
- Si te preguntan algo que las herramientas no cubren (costos, órdenes de trabajo,
  combustible cargado, documentación), decí que eso se ve en la sección
  correspondiente de FleetOS y no lo inventes.

LO QUE TENÉS QUE SABER DEL NEGOCIO
- Los semirremolques y acoplados llevan GPS pero NO tienen motor. Cuando se mueven es
  porque un camión los está remolcando. No cuentan como unidades "en ruta" ni generan
  ralentí. Si te preguntan "cuántos camiones tengo andando", son las motorizadas.
- "Ralentí" es motor encendido con la unidad parada: gasoil que se quema sin moverse.
  Los litros son una ESTIMACIÓN por modelo, no una medición del tanque. Decilo si el
  número es protagonista de la respuesta.
- El límite de velocidad general es 80 km/h, pero los utilitarios livianos tienen el
  suyo (algunos 90, las Berlingo 110). Cada exceso registrado guarda contra qué límite
  se midió: usá ese, no asumas 80.
- "Sin reportar" significa más de 30 minutos sin novedades del equipo GPS: apagado, sin
  señal o con problema. No significa que la unidad esté parada.

Hoy es ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;

// ── Herramientas ──────────────────────────────────────────────────────
// Cada descripción dice CUÁNDO usarla, no solo qué hace: es lo que más mueve
// la aguja para que el modelo elija bien.
const herramientas = [
  betaTool({
    name: 'estado_flota',
    description: 'Devuelve dónde está cada unidad AHORA: dirección, velocidad, si está en ruta, '
      + 'detenida, en ralentí o sin reportar. Usala para preguntas sobre el estado actual de la '
      + 'flota o de varias unidades a la vez ("cuántos camiones andando", "quién está parado", '
      + '"cuántos en ralentí"). Los semirremolques vienen en una lista aparte.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    run: async () => JSON.stringify(await datos.estadoFlota()),
  }),

  betaTool({
    name: 'buscar_unidad',
    description: 'Devuelve el detalle de UNA unidad: dónde está, a qué velocidad, kilómetros, '
      + 'horas de motor y desde cuándo no reporta. Usala cuando la pregunta es sobre una unidad '
      + 'puntual identificada por patente o código ("dónde está el AH327RZ"). Devuelve null si '
      + 'no la encuentra o si el texto coincide con más de una.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Patente o código de la unidad, entero o los últimos caracteres' },
      },
      required: ['codigo'],
    },
    run: async ({ codigo }) => JSON.stringify(await datos.buscarUnidad(codigo)),
  }),

  betaTool({
    name: 'excesos_y_ralenti',
    description: 'Devuelve los excesos de velocidad y los episodios de ralentí de un período, '
      + 'con el total de litros estimados quemados parado. Usala para preguntas sobre lo que PASÓ '
      + '("cuántos excesos hubo hoy", "quién desperdició más gasoil esta semana", "a qué velocidad '
      + 'máxima anduvieron"). Por defecto mira las últimas 24 horas.',
    inputSchema: {
      type: 'object',
      properties: {
        horas: { type: 'integer', description: 'Cuántas horas hacia atrás mirar. Máximo 168 (una semana). Default 24.' },
      },
      required: [],
    },
    run: async ({ horas }) => JSON.stringify(await datos.eventos({ horas })),
  }),
];

function configurado() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Deja el historial que manda el cliente en una forma que la API acepte:
// solo turnos user/assistant con texto, y acotado.
function sanearHistorial(historial) {
  if (!Array.isArray(historial)) return [];
  return historial
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

let _cliente = null;
function cliente() {
  if (!_cliente) _cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _cliente;
}

async function preguntar(pregunta, historial) {
  if (!configurado()) {
    const e = new Error('El asistente no está configurado: falta ANTHROPIC_API_KEY en el Environment.');
    e.code = 'SIN_API_KEY';
    throw e;
  }
  const texto = String(pregunta || '').trim();
  if (!texto) {
    const e = new Error('Falta la pregunta.');
    e.code = 'SIN_PREGUNTA';
    throw e;
  }

  // El tool runner se encarga del ida y vuelta: pide una herramienta, la
  // ejecutamos, le devolvemos el resultado, y así hasta que tenga la respuesta.
  const final = await cliente().beta.messages.toolRunner({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: SISTEMA,
    thinking: { type: 'adaptive' },
    output_config: { effort: ESFUERZO },
    tools: herramientas,
    messages: [...sanearHistorial(historial), { role: 'user', content: texto.slice(0, 2000) }],
  });

  // Los clasificadores de seguridad pueden rechazar un pedido: llega un 200 con
  // stop_reason 'refusal' y content vacío. Sin este chequeo, leer content[0]
  // reventaría. No se configuran fallbacks a otro modelo: son preguntas sobre
  // camiones, un rechazo acá sería un falso positivo raro y preferimos decirlo
  // antes que resolverlo por un camino que nadie va a ejercitar.
  if (final.stop_reason === 'refusal') {
    const e = new Error('El asistente no pudo responder esa consulta.');
    e.code = 'RECHAZADA';
    throw e;
  }

  const respuesta = (final.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!respuesta) {
    const e = new Error('El asistente no devolvió texto.');
    e.code = 'SIN_TEXTO';
    throw e;
  }

  return {
    respuesta,
    // Sirve para vigilar el gasto sin tener que abrir la consola de Anthropic.
    uso: final.usage ? { entrada: final.usage.input_tokens, salida: final.usage.output_tokens } : null,
  };
}

module.exports = { preguntar, configurado, herramientas, sanearHistorial, SISTEMA, MODELO };
