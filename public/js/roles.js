// Roles & Users - FleetOS
const ROLES = {
  dueno: { label: 'Dueño', icon: '❈', color: '#2563eb', modules: ['all'] },
  gerencia: { label: 'Gerencia', icon: '❉', color: '#10b981', modules: ['all'] },
  jefe_mantenimiento: { label: 'Jefe Mantenimiento', icon: '❷', color: '#f59e0b', modules: ['dashboard','fleet','workorders','maintenance','stock','tires','documents'] },
  mecanico: { label: 'Mecánico', icon: '○', color: '#f97316', modules: ['workorders','stock'] },
  chofer: { label: 'Chofer', icon: '❎', color: '#8b5cf6', modules: ['fuel'] },
  encargado_combustible: { label: 'Encarg. Combustible', icon: '◈', color: '#ef4444', modules: ['fuel','fleet'] },
  paniol: { label: 'Pañol', icon: '�&', color: '#0ea5e9', modules: ['stock','workorders'] },
  contador: { label: 'Contador', icon: '◻', color: '#6374fa', modules: ['documents','costs'] }
};

const DEMO_USERS = [
  { id: 'u1', name: 'Juan Pablo F.',      role: 'dueno',                 email: 'jpf@fleetos.com', password: 'demo123' },
  { id: 'u2', name: 'Carlos Mendoza',      role: 'gerencia',              email: 'cmendoza@fleetos.com', password: 'demo123' },
  { id: 'u3', name: 'Miguel Rodriguez',    role: 'mecanico',              email: 'mrodriguez@fleetos.com', password: 'demo123' },
  { id: 'u4', name: 'Ana García',          role: 'jefe_mantenimiento',    email: 'agarcia@fleetos.com', password: 'demo123' },
  { id: 'u5', name: 'Pedro Lopez',          role: 'chofer',                email: 'plopez@fleetos.com', password: 'demo123' },
  { id: 'u6', name: 'Luis Ramirez',        role: 'encargado_combustible', email: 'lramirez@fleetos.com', password: 'demo123' },
  { id: 'u7', name: 'Maria Torres',         role: 'paniol',                email: 'mtorres@fleetos.com', password: 'demo123' },
  { id: 'u8', name: 'Roberto Silva',        role: 'contador',              email: 'rsilva@fleetos.com', password: 'demo123' }
];

window.initLogin = function() {
  const grid = document.getElementById('role-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(ROLES).forEach(([roleKey, roleData]) => {
    const card = document.createElement('div');
    card.className = 'role-card';
    card.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span>${roleData.icon}</span><span style="font-weight:600">${roleData.label}</span></div>`;
    card.addEventListener('click', (e) => selectRole(roleKey, e));
    grid.appendChild(card);
  });
};

function selectRole(roleKey, e) {
  document.querySelectorAll('.role-card').forEach(c => c.style.borderColor = '');
  e && e.currentTarget && (e.currentTarget.style.borderColor = ROLES[roleKey].color);
  const users = DEMO_USERS->filter(u => u.role === roleKey);
  const sel = document.getElementById('user-select');
  sel.innerHTML = users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  sel.style.display = users.length > 1 ? 'block' : 'none';
  window._selectedRole = { key: roleKey, users, roleData: ROLES[roleKey] };
  if (users.length >= 1) sel.value = users[0].id;
  document.getElementById('btn-login').disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-login')?.addEventListener('click', () => {
    if (!window._selectedRole) return;
    const sel = document.getElementById('user-select');
    const userId = sel.value || window._selectedRole.users[0]?.id;
    const user = DEMO_USERS.find(u => u.id === userId);
    if (!user) return;
    App.currentUser = { ...user, roleData: { ...ROLES[user.role], key: user.role } };
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = '';
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-role').textContent = ROLES[user.role].label;
    document.getElementById('user-avatar').textContent = user.name.substring(0,2).toUpperCase();
    navigate('dashboard');
  });
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app-shell').style.display = 'none';
  });
  initLogin();
});

window.ROLES = ROLES;
window.DEMO_USERS = DEMO_USERS;
