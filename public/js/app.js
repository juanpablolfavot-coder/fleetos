// FleetOS - app.js bootstrap
window.App = {
  currentUser: null,
  currentPage: 'dashboard',
  data: { vehicles:[], workorders:[], stock:[], fuel:[], tires:[], documents:[], users:[], maintenance:[] },
  loading: {},
};

function fmtDate(d) { if(!d) return '-'; return new Date(d).toLocaleDateString('es-AR'); }
function fmtCurrency(i) { return '$ ' + Number(i||0).toLocaleString('es-AR'); }
function fmtNum(i) { return Number(i||0).toLocaleString('es-AR'); }
function el(id) { return document.getElementById(id); }

function showToast(msg, type='info') {
  const colors = {success:'#10b981',error:'#ef4444',warning:'#f59e0b',info:'#2563eb'};
  const t = document.createElement('div');
  t.style.cssText = `background:${colors[type]};padding:10px 16px;border-radius:6px;color:white;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.4)`;
  t.textContent = msg;
  el('toast-container')?.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

function openModal(title, bodyHTML, footerHTML='') {
  el('modal-title').innerHTML = title;
  el('modal-body').innerHTML = bodyHTML;
  el('modal-footer').innerHTML = footerHTML;
  el('modal-overlay').classList.add('active');
}
function closeModal() { el('modal-overlay').classList.remove('active'); }

function getPageTitle(p) {
  const titles = {dashboard:'Panel general',fleet:'Flota y vehiculos',workorders:'Ordenes de trabajo',
    maintenance:'Mantenimiento',fuel:'Combustible y urea',tires:'Cubiertas',
    stock:'Stock y paniol',documents:'Documentacion',costs:'Costos operativos'};
  return titles[p] || p;
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = el('page-'+page);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  App.currentPage = page;
  document.querySelector('.topbar-title').textContent = getPageTitle(page);
  switch(page) {
    case 'dashboard':   renderDashboard(); break;
    case 'fleet':       renderFleet(); break;
    case 'workorders':  renderWorkOrders(); break;
    case 'maintenance': renderMaintenance(); break;
    case 'fuel':        renderFuel(); break;
    case 'tires':       renderTires(); break;
    case 'stock':       renderStock(); break;
    case 'documents':   renderDocuments(); break;
    case 'costs':       renderCosts(); break;
  }
}

function renderDashboard(){ el('page-dashboard').innerHTML='<div class="empty"><div style="font-size:48px">\u2705</div><div style="font-size:20px;font-weight:700;margin:12px 0">FleetOS v2.0 Online</div><div>Backend conectado. Frontend cargando...</div></div>'; }
function renderFleet(){ el('page-fleet').innerHTML='<div class="empty">Flota</div>'; }
function renderWorkOrders(){ el('page-workorders').innerHTML='<div class="empty">\u00d3rdenes de trabajo</div>'; }
function renderMaintenance(){ el('page-maintenance').innerHTML='<div class="empty">Mantenimiento</div>'; }
function renderFuel(){ el('page-fuel').innerHTML='<div class="empty">Combustible</div>'; }
function renderTires(){ el('page-tires').innerHTML='<div class="empty">Cubiertas</div>'; }
function renderStock(){ el('page-stock').innerHTML='<div class="empty">Stock</div>'; }
function renderDocuments(){ el('page-documents').innerHTML='<div class="empty">Documentos</div>'; }
function renderCosts(){ el('page-costs').innerHTML='<div class="empty">Costos</div>'; }

document.addEventListener('DOMContentLoaded', () => { navigate('dashboard'); });
