// ═══════════════════════════════════════════════════════════
//  FleetOS — Sidebar y panel del rol Proveedores
//  Si el usuario logueado tiene rol = proveedores:
//    - Oculta todos los items del sidebar excepto "Mis OCs"
//    - Agrega item "📄 Mis OCs" al sidebar
//    - Lo navega como página por defecto al loguearse
// ═══════════════════════════════════════════════════════════

(function() {

  function aplicarUIProveedor() {
    if (!window.App?.currentUser) return;
    if (window.App.currentUser.role !== 'proveedores') return;
    if (document.querySelector('[data-page="proveedor_panel"]')) return; // ya aplicado

    // 1) Ocultar todos los items del sidebar
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.style.display = 'none';
    });

    // 2) Ocultar las secciones del sidebar (labels)
    document.querySelectorAll('.nav-section-label').forEach(el => {
      el.style.display = 'none';
    });

    // 3) Crear nuevo item "Mis OCs"
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const navSection = sidebar.querySelector('.nav-section');
    if (!navSection) return;

    const item = document.createElement('a');
    item.className = 'nav-item active';
    item.dataset.page = 'proveedor_panel';
    item.style.cssText = 'display:flex;cursor:pointer';
    item.innerHTML = '<span class="nav-icon">📄</span><span>Mis Órdenes de Compra</span>';
    item.onclick = () => navegarPanelProveedor();
    navSection.insertBefore(item, navSection.firstChild);

    // 4) Mostrar el label de la sección
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.style.cssText = 'display:block';
    label.textContent = 'Mi cuenta';
    navSection.insertBefore(label, item);

    // 5) Navegar al panel proveedor por defecto
    setTimeout(() => navegarPanelProveedor(), 100);
  }

  function navegarPanelProveedor() {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const me = document.querySelector('[data-page="proveedor_panel"]');
    if (me) me.classList.add('active');

    // Ocultar todas las páginas existentes y crear contenedor propio
    document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');

    let page = document.getElementById('page-proveedor_panel');
    if (!page) {
      page = document.createElement('div');
      page.id = 'page-proveedor_panel';
      page.className = 'page';
      const main = document.querySelector('.main') || document.querySelector('main') || document.body;
      main.appendChild(page);
    }
    page.style.display = 'block';

    // Header
    const header = document.querySelector('.page-header');
    if (header) {
      const title = header.querySelector('.page-title');
      const sub   = header.querySelector('.page-subtitle');
      if (title) title.textContent = 'Mis Órdenes de Compra';
      if (sub)   sub.textContent   = 'OCs aprobadas que recibiste · Cargá las facturas correspondientes';
    }

    renderProveedorPanelEnDiv(page);
  }

  async function renderProveedorPanelEnDiv(page) {
    page.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">Cargando OCs...</div>';
    try {
      const res = await apiFetch('/api/purchase-orders/mis-ocs');
      if (!res.ok) {
        const err = await res.json();
        page.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">${err.error || 'Error al cargar'}</div>`;
        return;
      }
      const ocs = await res.json();
      const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const badgeColor = (status) => {
        switch (status) {
          case 'total':   return '#064e3b';
          case 'parcial': return '#7c2d12';
          default:        return '#1e293b';
        }
      };

      page.innerHTML = `
        <div style="padding:20px">
          ${ocs.length === 0 ? '<div style="text-align:center;color:#94a3b8;padding:60px;background:#1e293b;border-radius:8px">No hay OCs aprobadas a tu nombre todavía</div>' : `
          <div style="background:#1e293b;border-radius:8px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:#0f172a;color:#94a3b8;font-size:13px">
                  <th style="padding:12px;text-align:left">OC</th>
                  <th style="padding:12px;text-align:left">Fecha</th>
                  <th style="padding:12px;text-align:right">Total OC</th>
                  <th style="padding:12px;text-align:right">Facturado</th>
                  <th style="padding:12px;text-align:center">Entrega</th>
                  <th style="padding:12px;text-align:center">Pago</th>
                  <th style="padding:12px;text-align:center"></th>
                </tr>
              </thead>
              <tbody>
                ${ocs.map(o => `
                  <tr style="border-bottom:1px solid #334155;color:#e2e8f0">
                    <td style="padding:12px;font-weight:600">${o.code}</td>
                    <td style="padding:12px;font-size:13px">${new Date(o.created_at).toLocaleDateString('es-AR')}</td>
                    <td style="padding:12px;text-align:right">$${fmt(o.total_estimado)}</td>
                    <td style="padding:12px;text-align:right;color:${parseFloat(o.total_facturado)>=parseFloat(o.total_estimado)?'#10b981':'#f59e0b'}">$${fmt(o.total_facturado)}</td>
                    <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.delivery_status)};padding:3px 8px;border-radius:4px;color:#fff">${o.delivery_status || 'pendiente'}</span></td>
                    <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.payment_status)};padding:3px 8px;border-radius:4px;color:#fff">${o.payment_status || 'pendiente'}</span></td>
                    <td style="padding:12px;text-align:center">
                      <button onclick="abrirModalFacturas('${o.id}')" style="background:#3b82f6;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">📄 Cargar factura</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      `;
    } catch (err) {
      console.error(err);
      page.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Error de conexión</div>';
    }
  }

  // Esperar a que App.currentUser exista Y que el sidebar tenga items renderizados
  function tryAplicar() {
    if (!window.App?.currentUser) return false;
    if (window.App.currentUser.role !== 'proveedores') return true; // no hace falta hacer nada
    const items = document.querySelectorAll('.nav-item[data-page]');
    if (items.length < 5) return false; // sidebar todavía no terminó de renderizar
    aplicarUIProveedor();
    return true;
  }

  const interval = setInterval(() => {
    if (tryAplicar()) clearInterval(interval);
  }, 100);

  // Timeout de seguridad: dejar de intentar después de 15 segundos
  setTimeout(() => clearInterval(interval), 15000);

  // Por si se hace re-login
  window._aplicarUIProveedor = aplicarUIProveedor;
})();
