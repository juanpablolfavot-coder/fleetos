// Presentación compartida. Los permisos siguen viniendo de buildNavForRole.
function uiIcon(name) {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    fleet: '<path d="M3 5h12v12H3zM15 9h4l3 5v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    maintenance: '<path d="M14 4a6 6 0 0 0-7 7l-4 7a2 2 0 0 0 3 3l7-7a6 6 0 0 0 7-7l-4 4-4-4z"/>',
    fuel: '<path d="M4 21V4h10v17M2 21h14M6 7h6v5H6zM14 10h3v7a2 2 0 0 0 4 0V8l-3-3"/>',
    purchase_orders: '<path d="M2 3h3l3 13h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
    documents: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>',
    flota: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    stock: '<path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 5 9-5M12 12v10M7 5l10 5"/>',
    costs: '<path d="M4 21V11h4v10M10 21V7h4v14M16 21V3h4v18"/>',
    more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  };
  const aliases = { workorders:'maintenance', tires:'flota', auditor_panel:'costs', contador_panel:'costs', suppliers:'stock', assets:'stock', config:'maintenance', chofer_panel:'fleet', proveedor_panel:'documents', tesoreria_panel:'purchase_orders' };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths[aliases[name]] || paths.dashboard}</svg>`;
}

function uiAllowed(page) {
  const modules = App.currentUser?.roleData?.modules || [];
  return modules.includes('all') || modules.includes(page);
}

function uiCloseMenu() {
  document.getElementById('app-shell')?.classList.remove('menu-open');
  document.querySelectorAll('[data-menu-toggle]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function uiToggleMenu() {
  const open = document.getElementById('app-shell')?.classList.toggle('menu-open');
  document.querySelectorAll('[data-menu-toggle]').forEach(b => b.setAttribute('aria-expanded', String(!!open)));
  if (open) document.querySelector('.sidebar .nav-item:not([style*="display: none"])')?.focus();
}

function refreshModernNav() {
  const links = [...document.querySelectorAll('.sidebar .nav-item[data-page]')];
  links.forEach(link => {
    const label = link.querySelector('span:not(.nav-icon)')?.textContent || link.dataset.page;
    link.setAttribute('aria-label', label);
    link.title = label;
    link.setAttribute('role', 'button');
    link.tabIndex = 0;
    link.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); link.click(); } };
    const icon = link.querySelector('.nav-icon');
    if (icon) icon.innerHTML = uiIcon(link.dataset.page);
    if (link.dataset.page === App.currentPage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const allowed = links.filter(l => l.style.display !== 'none');
  const preferred = ['home', 'fleet', 'flota', ...allowed.map(l => l.dataset.page)];
  const pages = [...new Set(preferred)].filter(p => allowed.some(l => l.dataset.page === p)).slice(0, 3);
  const bar = document.getElementById('mobile-nav');
  if (bar) bar.innerHTML = pages.map(page => {
    const label = {home:'Inicio', fleet:'Flota', flota:'En vivo', dashboard:'Resumen'}[page] || getPageTitle(page);
    return `<button type="button" class="${App.currentPage === page ? 'active' : ''}" ${App.currentPage === page ? 'aria-current="page"' : ''} onclick="navigate('${page}')">${uiIcon(page)}<span>${escapeHtml(label)}</span></button>`;
  }).join('') + `<button type="button" data-menu-toggle aria-controls="main-navigation" aria-expanded="false" onclick="uiToggleMenu()">${uiIcon('more')}<span>Más</span></button>`;
}

function uiHeading(title, subtitle) {
  return `<header class="overview-heading"><div><div class="eyebrow">EXPRESO BILETTA · FLEETOS</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><span class="overview-date">${new Date().toLocaleDateString('es-AR', {day:'numeric',month:'long',year:'numeric'})}</span></header>`;
}

function uiAttentionRow(icon, title, detail, page, action) {
  return `<div class="attention-row"><span class="attention-icon">${uiIcon(icon)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><button class="btn btn-primary" onclick="navigate('${page}')">${escapeHtml(action)} <span aria-hidden="true">→</span></button></div>`;
}

function renderModernHome() {
  const root = document.getElementById('page-home');
  if (!root) return;
  const modules = App.currentUser?.roleData?.modules || [];
  const pending = _homePendientes(modules);
  const maintenance = maintResumen();
  const attention = pending.length ? `<section class="attention-panel"><h2>Requiere tu atención</h2><p>Los pendientes de tus secciones, ordenados por prioridad.</p>${pending.map(p => uiAttentionRow(p.nav, `${p.n} ${p.texto}`, p.tone === 'danger' ? 'Requiere revisión' : 'Próximo a resolver', p.nav, 'Revisar')).join('')}</section>` : '';
  root.innerHTML = uiHeading(`Hola, ${(App.currentUser?.name || '').split(' ')[0]}`, 'Tu jornada, organizada. Encontrá lo que necesitás y seguí trabajando.') + `
    <section class="home-welcome"><div><span class="eyebrow">TU CENTRO DE OPERACIONES</span><h2>Tu flota.<br>Una visión más clara.</h2><p>Vehículos, mantenimiento y gestión, en un mismo lugar.</p>${uiAllowed('dashboard') ? '<button class="btn btn-primary" onclick="navigate(\'dashboard\')">Ver resumen operativo →</button>' : ''}</div><figure class="home-truck"><img src="/images/camion-iveco-stralis.png" alt="Camión Iveco Stralis blanco" width="1536" height="1024"><figcaption>Imagen ilustrativa</figcaption></figure></section>
    ${attention}
    ${uiAllowed('maintenance') && !maintenance.disponible ? '<p class="card">No se pudieron cargar los planes. Los pendientes de mantenimiento no están confirmados.</p>' : ''}
    <div class="section-header"><h2 class="section-title">Tus accesos</h2><span class="muted">${escapeHtml(App.currentUser?.roleData?.label || '')}</span></div>
    <div class="home-shortcuts">${_homeAccesos(modules)}</div>
    ${App.currentUser?.role === 'dueno' ? '<section class="home-notifications"><div><strong>La flota también te avisa</strong><p>Recibí alertas de velocidad aunque tengas la app cerrada. En iPhone, agregá primero FleetOS a la pantalla de inicio.</p></div><button class="btn btn-secondary" id="btn-speed-alerts" onclick="enableSpeedAlerts()">Activar alertas de velocidad</button></section>' : ''}`;
  if (App.currentUser?.role === 'dueno') _refreshSpeedAlertBtn();
}

// Etiquetas para transformar las tablas largas en tarjetas en pantallas chicas.
function labelResponsiveTable(table) {
  if (!table) return;
  const labels = [...table.querySelectorAll('thead th')].map(h => h.textContent.trim());
  table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, i) => {
    cell.dataset.label = labels[i] || 'Acciones';
  }));
  table.classList.add('responsive-records');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('app-shell')?.classList.contains('menu-open')) {
    uiCloseMenu();
    document.querySelector('[data-menu-toggle]')?.focus();
  }
});
