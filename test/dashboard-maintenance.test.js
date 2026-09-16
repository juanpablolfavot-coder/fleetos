const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Ejecuta el render real con DOM mínimo: comprueba la fuente del estado,
// el caso de datos no disponibles y actualizaciones de la lista compartida.
function dashboard(plans) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML:'', textContent:'', appendChild() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    App: { currentUser:{id:'user-1', role:'auditor'}, data:{
      vehicles:[{code:'TEST-1', km:14900, status:'ok', tech_spec:{maint_interval_km:15000}}],
      documents:[], workOrders:[], stock:[], purchaseOrders:[], fuelLogs:[], maintPlanes:plans,
    } },
    document: { getElementById:node, createElement:() => ({ addEventListener() {} }), addEventListener() {} },
    console, setTimeout,
    escapeHtml: s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    _dashQuickAccess: () => '', _renderDailyActivityInto: () => {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/ui-shell.js'),'utf8'), context);
  const source = fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function maintResumen()'), source.indexOf('function getPageTitle')), context);
  vm.runInContext(source.slice(source.indexOf('function renderDashboard()'), source.indexOf('// ── FLOTA ──')), context);
  return {render:context.renderDashboard, nodes, context};
}

test('panel usa los planes del servidor aunque el odómetro sugiera otro estado', async () => {
  const d = dashboard([
    {unidad:'TEST-1', nombre:'Aceite', estado:'ok', restante:23000, unidad_medida:'km'},
    {unidad:'TEST-2', nombre:'<Engrase>', estado:'vencido', restante:-25, unidad_medida:'h'},
    {unidad:'TEST-3', nombre:'VTV', estado:'proximo', restante:4, unidad_medida:'días'},
  ]);
  await d.render();
  const alerts = d.nodes.get('dash-alerts').innerHTML;
  assert.doesNotMatch(alerts,/TEST-1/);
  assert.match(alerts,/TEST-2.*&lt;Engrase&gt;.*pasado por 25 h/);
  assert.match(alerts,/TEST-3.*faltan 4 días/);
});

test('API de planes caída no presenta estado saludable ni cero confirmado', async () => {
  const d = dashboard(null);
  await d.render();
  assert.match(d.nodes.get('page-dashboard').innerHTML,/Mantenimiento no disponible/);
  assert.match(d.nodes.get('dash-alerts').innerHTML,/Su estado no está confirmado/);
  assert.doesNotMatch(d.nodes.get('dash-alerts').innerHTML,/Sin alertas críticas/);
});

test('actualizar un plan compartido actualiza las alertas del panel', async () => {
  const d = dashboard([{unidad:'TEST-2', nombre:'Aceite', estado:'vencido', restante:-25, unidad_medida:'km'}]);
  await d.render();
  assert.match(d.nodes.get('dash-alerts').innerHTML,/TEST-2/);
  d.context.App.data.maintPlanes[0].estado = 'ok';
  await d.render();
  assert.doesNotMatch(d.nodes.get('dash-alerts').innerHTML,/TEST-2/);
});
