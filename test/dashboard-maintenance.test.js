const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Ejecuta el render real con DOM mínimo: comprueba la fuente del estado,
// el caso de API caída y que una respuesta vieja no pise el resumen actual.
function dashboard(apiFetch) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML:'', textContent:'', appendChild() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    App: { currentUser:{id:'user-1', role:'auditor'}, data:{
      vehicles:[{code:'TEST-1', km:14900, status:'ok', tech_spec:{maint_interval_km:15000}}],
      documents:[], workOrders:[], stock:[], purchaseOrders:[], fuelLogs:[],
    } },
    document: { getElementById:node, createElement:() => ({ addEventListener() {} }), addEventListener() {} },
    apiFetch, console, setTimeout,
    escapeHtml: s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    _dashQuickAccess: () => '', _renderDailyActivityInto: () => {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/ui-shell.js'),'utf8'), context);
  const source = fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('let _dashboardRequest ='), source.indexOf('// ── FLOTA ──')), context);
  return {render:context.renderDashboard, nodes, context};
}

test('panel usa los planes del servidor aunque el odómetro sugiera otro estado', async () => {
  const calls = [];
  const d = dashboard(async url => { calls.push(url); return {ok:true,json:async()=>[
    {unidad:'TEST-1', nombre:'Aceite', estado:'ok', restante:23000, unidad_medida:'km'},
    {unidad:'TEST-2', nombre:'<Engrase>', estado:'vencido', restante:-25, unidad_medida:'h'},
    {unidad:'TEST-3', nombre:'VTV', estado:'proximo', restante:4, unidad_medida:'días'},
  ]}; });
  await d.render();
  assert.deepEqual(calls,['/api/mantenimiento/planes']);
  const alerts = d.nodes.get('dash-alerts').innerHTML;
  assert.doesNotMatch(alerts,/TEST-1/);
  assert.match(alerts,/TEST-2.*&lt;Engrase&gt;.*pasado por 25 h/);
  assert.match(alerts,/TEST-3.*faltan 4 días/);
});

test('API de planes caída no presenta estado saludable ni cero confirmado', async () => {
  const d = dashboard(async () => ({ok:false}));
  await d.render();
  assert.match(d.nodes.get('page-dashboard').innerHTML,/Mantenimiento no disponible/);
  assert.match(d.nodes.get('dash-alerts').innerHTML,/Su estado no está confirmado/);
  assert.doesNotMatch(d.nodes.get('dash-alerts').innerHTML,/Sin alertas críticas/);
});

test('una respuesta anterior no reemplaza los planes más recientes', async () => {
  let finishFirst;
  let n = 0;
  const d = dashboard(() => ++n === 1 ? new Promise(resolve => {finishFirst=resolve;}) : Promise.resolve({ok:true,json:async()=>[]}));
  const first = d.render();
  await d.render();
  const current = d.nodes.get('page-dashboard').innerHTML;
  finishFirst({ok:true,json:async()=>[{unidad:'OLD',nombre:'Viejo',estado:'vencido',restante:-8}]});
  await first;
  assert.equal(d.nodes.get('page-dashboard').innerHTML,current);
  assert.doesNotMatch(d.nodes.get('dash-alerts').innerHTML,/OLD/);
});
