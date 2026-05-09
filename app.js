import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ─── Helpers ─────────────────────────────────────────────
const $ = q => document.querySelector(q);
const $$ = q => Array.from(document.querySelectorAll(q));
const uid = () => crypto?.randomUUID?.() || String(Date.now() + Math.random());
const today = () => new Date().toISOString().slice(0, 10);
const money = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const monthYM = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7); };

// ─── Default state ────────────────────────────────────────
const defaultData = () => ({
  tasks: [
    { id: uid(), title: 'Revisar pedidos da Neon Sanja', area: 'Neon Sanja', priority: 'high', done: false, due: '', notes: '', tags: ['neon'], subtasks: [] },
    { id: uid(), title: 'Conferir estoque de pudins', area: 'Sanja Pudding', priority: 'medium', done: false, due: '', notes: '', tags: ['estoque'], subtasks: [] }
  ],
  finances: [
    { id: uid(), type: 'income', title: 'Venda exemplo', area: 'Sanja Pudding', value: 120, date: today(), notes: '', recurring: false },
    { id: uid(), type: 'expense', title: 'Insumos exemplo', area: 'Sanja Pudding', value: 45, date: today(), notes: '', recurring: false }
  ],
  habits: [
    { id: uid(), title: 'Planejar o dia', area: 'Pessoal', streak: 0, checked: false, lastCheckedDate: '', history: [] },
    { id: uid(), title: 'Prospectar clientes', area: 'Negócios', streak: 0, checked: false, lastCheckedDate: '', history: [] }
  ],
  goals: [],
  chat: [],
  settings: {
    backupReminder: true, lastBackupNotice: '',
    aiEndpoint: '', apiKey: '',
    lastHabitReset: '', onboardingDone: false,
    theme: 'dark', notifPermission: 'default'
  }
});

let state = defaultData();
let currentUser = null;
let demoMode = false;
let auth = null, db = null;
let firebaseReady = false;
let activeTaskFilter = 'all';
let activeFinanceFilter = 'all';
let recognition = null, listening = false, voiceAvailable = false;
let homeChartInst = null, finChartInst = null;

// ─── Toast ────────────────────────────────────────────────
function toast(msg, duration = 4200) {
  const el = $('#toast');
  el.className = 'toast show'; el.textContent = msg;
  clearTimeout(window.__tt);
  window.__tt = setTimeout(() => el.classList.remove('show'), duration);
}

// ─── Theme ────────────────────────────────────────────────
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  const icon = $('#themeIcon'), label = $('#themeLabel');
  if (icon) icon.textContent = t === 'light' ? '☀️' : '🌙';
  if (label) label.textContent = t === 'light' ? 'Claro' : 'Escuro';
}
function toggleTheme() {
  state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
  applyTheme(state.settings.theme);
  saveCloud();
}

// ─── Storage ─────────────────────────────────────────────
const storageKey = () => currentUser && !demoMode ? `assistente-v40-${currentUser.uid}` : 'assistente-v40-demo';
function normalizeData(data) {
  const def = defaultData();
  state = { ...def, ...(data || {}) };
  state.tasks = (state.tasks || []).map(t => ({ tags: [], subtasks: [], ...t }));
  state.finances = (state.finances || []).map(f => ({ recurring: false, ...f }));
  state.habits = (state.habits || []).map(h => ({ lastCheckedDate: '', history: [], ...h }));
  state.goals ||= [];
  state.chat ||= [];
  state.settings = { ...def.settings, ...(state.settings || {}) };
}
const saveLocal = () => localStorage.setItem(storageKey(), JSON.stringify(state));
function loadLocal() { try { normalizeData(JSON.parse(localStorage.getItem(storageKey()))); } catch { normalizeData(null); } }
async function saveCloud() {
  saveLocal();
  if (firebaseReady && currentUser && !demoMode) {
    try { await setDoc(doc(db, 'users', currentUser.uid), { data: state, updatedAt: new Date().toISOString() }, { merge: true }); } catch {}
  }
}
async function loadCloud() {
  loadLocal();
  if (firebaseReady && currentUser && !demoMode) {
    try {
      const snap = await getDoc(doc(db, 'users', currentUser.uid));
      if (snap.exists() && snap.data().data) normalizeData(snap.data().data);
      else await saveCloud();
    } catch {}
  }
}

// ─── Daily habit reset ────────────────────────────────────
function maybeDailyHabitReset() {
  const t = today();
  if (state.settings.lastHabitReset === t) return false;
  let reset = false;
  state.habits = state.habits.map(h => {
    if (h.checked && h.lastCheckedDate && h.lastCheckedDate !== t) { reset = true; return { ...h, checked: false }; }
    return h;
  });
  state.settings.lastHabitReset = t;
  // Apply recurring finances
  applyRecurringFinances();
  return reset;
}

function applyRecurringFinances() {
  const t = today();
  const ym = t.slice(0, 7);
  state.finances.filter(f => f.recurring).forEach(f => {
    const alreadyThisMonth = state.finances.some(x => x.recurringParent === f.id && String(x.date).startsWith(ym));
    if (!alreadyThisMonth && f.date && !String(f.date).startsWith(ym)) {
      state.finances.push({ ...f, id: uid(), date: ym + '-' + String(f.date).slice(8), recurringParent: f.id, recurring: false });
    }
  });
}

// ─── Firebase ─────────────────────────────────────────────
async function initFirebase() {
  try {
    if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.includes('SUA_')) throw new Error('no config');
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app); db = getFirestore(app); firebaseReady = true;
    onAuthStateChanged(auth, async user => { if (user) { currentUser = user; demoMode = false; await enterApp(); } });
  } catch { firebaseReady = false; setText('#syncStatus', 'Modo local ativo'); }
}

// ─── Auth ─────────────────────────────────────────────────
function validateLogin() {
  const email = $('#email')?.value.trim() || '';
  const pass = $('#password')?.value || '';
  if (!email.includes('@')) throw new Error('E-mail inválido.');
  if (pass.length < 6) throw new Error('Senha mínimo 6 caracteres.');
  return { email, pass };
}
async function login() { try { const { email, pass } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não configurado. Use modo demonstração.'); await signInWithEmailAndPassword(auth, email, pass); } catch (e) { toast(firebaseMsg(e)); } }
async function register() { try { const { email, pass } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não configurado.'); await createUserWithEmailAndPassword(auth, email, pass); } catch (e) { toast(firebaseMsg(e)); } }
async function googleLogin() {
  if (!firebaseReady) { toast('Firebase não configurado.'); return; }
  try { const provider = new GoogleAuthProvider(); await signInWithPopup(auth, provider); }
  catch (e) { toast(firebaseMsg(e)); }
}
function firebaseMsg(e) {
  const c = e?.code || '';
  if (c.includes('email-already-in-use')) return 'E-mail já cadastrado. Use Entrar.';
  if (c.includes('wrong-password') || c.includes('invalid-credential')) return 'E-mail ou senha incorretos.';
  if (c.includes('user-not-found')) return 'Conta não encontrada. Use Criar conta.';
  if (c.includes('popup-closed')) return 'Login com Google cancelado.';
  return e?.message || 'Erro inesperado.';
}

// ─── Onboarding ───────────────────────────────────────────
let obSlide = 0;
function showOnboarding() {
  $('#loginScreen')?.classList.add('hidden');
  $('#onboardingScreen')?.classList.remove('hidden');
  goSlide(0);
}
function goSlide(i) {
  obSlide = i;
  $$('.onboarding-slide').forEach((s, idx) => s.classList.toggle('active', idx === i));
  $$('.ob-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
  const btn = $('#obNext');
  if (btn) btn.textContent = i === 3 ? 'Começar' : 'Próximo';
}
function obNext() {
  if (obSlide < 3) goSlide(obSlide + 1);
  else finishOnboarding();
}
function finishOnboarding() {
  state.settings.onboardingDone = true;
  saveLocal();
  $('#onboardingScreen')?.classList.add('hidden');
  $('#appScreen')?.classList.remove('hidden');
  $('#bottomNav')?.classList.remove('hidden');
  showScreen('home'); renderAll();
}

// ─── Enter/exit app ───────────────────────────────────────
async function enterApp() {
  await loadCloud();
  const wasReset = maybeDailyHabitReset();
  if (wasReset) { await saveCloud(); toast('Hábitos do dia anterior resetados. Bom dia! 🌅'); }
  applyTheme(state.settings.theme || 'dark');
  updateSettingsInputs();

  // Show onboarding for new users
  if (!state.settings.onboardingDone) { showOnboarding(); return; }

  $('#loginScreen')?.classList.add('hidden');
  $('#appScreen')?.classList.remove('hidden');
  $('#bottomNav')?.classList.remove('hidden');
  showScreen('home'); renderAll();
  maybeBackupNotice();
  scheduleProactiveInsight();
}
function exitApp() {
  currentUser = null; demoMode = false;
  $('#loginScreen')?.classList.remove('hidden');
  ['#appScreen','#bottomNav','#onboardingScreen'].forEach(s => $(s)?.classList.add('hidden'));
}

// ─── Navigation ───────────────────────────────────────────
const setText = (q, v) => { const el = $(q); if (el) el.textContent = v; };
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id)?.classList.add('active');
  $$('#bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'home') setTimeout(renderCharts, 50);
  if (id === 'finance') setTimeout(renderFinanceChart, 50);
}

// ─── Finance helpers ──────────────────────────────────────
const monthFinances = (ym = monthYM()) => state.finances.filter(f => String(f.date || '').startsWith(ym));
function financeSummary(arr) {
  const income = arr.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.value || 0), 0);
  const expense = arr.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.value || 0), 0);
  return { income, expense, balance: income - expense };
}

// ─── RENDER ALL ───────────────────────────────────────────
function renderAll() { renderHome(); renderTasks(activeTaskFilter); renderFinance(activeFinanceFilter); renderHabits(); renderFocus(); renderChat(); }

function renderHome() {
  const open = state.tasks.filter(t => !t.done).length;
  const doneH = state.habits.filter(h => h.checked).length;
  const pct = state.habits.length ? Math.round(doneH / state.habits.length * 100) : 0;
  const m = financeSummary(monthFinances());
  setText('#syncStatus', firebaseReady && currentUser && !demoMode ? '☁ Sincronizado' : '💾 Modo local');
  setText('#statTasks', state.tasks.length);
  setText('#statTasksSub', `${open} pendente${open !== 1 ? 's' : ''}`);
  setText('#statHabits', `${pct}%`);
  setText('#statMoney', money(m.balance));
  setText('#missionText', buildMission());
  renderInsights();

  // Avatar initials from user email
  const av = $('#profileBtn');
  if (av && currentUser?.email) av.textContent = currentUser.email.slice(0, 2).toUpperCase();
  else if (av) av.textContent = 'IA';
}

function buildMission() {
  const high = state.tasks.filter(t => !t.done && t.priority === 'high').length;
  const balance = financeSummary(monthFinances()).balance;
  const daysNoFinance = daysSinceLastFinance();
  if (high) return `Você tem ${high} tarefa${high > 1 ? 's' : ''} de alta prioridade. Resolva pelo menos uma antes de abrir novas frentes.`;
  if (daysNoFinance > 2) return `Você não registra finanças há ${daysNoFinance} dias. Mantenha o controle do seu mês.`;
  if (balance < 0) return `Mês negativo em ${money(Math.abs(balance))}. Revise suas despesas e busque novas receitas.`;
  return 'Painel estável. Escolha uma prioridade, registre os gastos do dia e mantenha os hábitos.';
}

function daysSinceLastFinance() {
  if (!state.finances.length) return 999;
  const last = state.finances.map(f => f.date || '').filter(Boolean).sort().reverse()[0];
  if (!last) return 999;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

function renderInsights() {
  const box = $('#insightList'); if (!box) return;
  const m = financeSummary(monthFinances());
  const open = state.tasks.filter(t => !t.done).length;
  const high = state.tasks.filter(t => !t.done && t.priority === 'high').length;
  const list = [];
  if (high > 0) list.push({ c: 'warn', t: `🔴 ${high} tarefa${high > 1 ? 's' : ''} de alta prioridade em aberto.` });
  if (m.expense > m.income && m.expense > 0) list.push({ c: 'warn', t: `⚠️ Despesas maiores que receitas: ${money(m.balance)} negativo.` });
  if (daysSinceLastFinance() > 2) list.push({ c: 'warn', t: `📅 Você não lança finanças há ${daysSinceLastFinance()} dias.` });
  if (state.habits.length && state.habits.every(h => h.checked)) list.push({ c: 'good', t: '🎉 Todos os hábitos do dia concluídos!' });
  if (open === 0 && state.tasks.length > 0) list.push({ c: 'good', t: '✅ Todas as tarefas estão concluídas. Ótimo trabalho!' });
  if (!list.length) list.push({ c: 'good', t: '✓ Sem alertas críticos. Continue registrando tarefas e finanças.' });
  box.innerHTML = list.map(i => `<div class="insight ${i.c}">${esc(i.t)}</div>`).join('');
}

// ─── CHARTS ──────────────────────────────────────────────
function renderCharts() {
  const canvas = $('#homeChart'); if (!canvas || !window.Chart) return;
  const months = [-5, -4, -3, -2, -1, 0].map(i => monthYM(i));
  const labels = months.map(ym => { const [y, m] = ym.split('-'); return new Date(+y, +m - 1).toLocaleDateString('pt-BR', { month: 'short' }); });
  const balances = months.map(ym => financeSummary(monthFinances(ym)).balance);
  const incomes = months.map(ym => financeSummary(monthFinances(ym)).income);
  const expenses = months.map(ym => financeSummary(monthFinances(ym)).expense);
  if (homeChartInst) homeChartInst.destroy();
  homeChartInst = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Saldo', data: balances, borderColor: '#2dd4f5', backgroundColor: 'rgba(45,212,245,.08)', tension: .4, fill: true, pointRadius: 3 },
        { label: 'Receitas', data: incomes, borderColor: '#3af098', backgroundColor: 'rgba(58,240,152,.05)', tension: .4, fill: false, pointRadius: 3, hidden: true },
        { label: 'Despesas', data: expenses, borderColor: '#ff5f72', backgroundColor: 'rgba(255,95,114,.05)', tension: .4, fill: false, pointRadius: 3, hidden: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#6e8f9a', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#6e8f9a', font: { size: 10 }, callback: v => money(v).replace('R$', '') } }
      }
    }
  });
}

function renderFinanceChart() {
  const canvas = $('#financeChart'); if (!canvas || !window.Chart) return;
  const arr = monthFinances();
  // Group expenses by area
  const byArea = {};
  arr.filter(f => f.type === 'expense').forEach(f => { byArea[f.area || 'Outros'] = (byArea[f.area || 'Outros'] || 0) + Number(f.value || 0); });
  const labels = Object.keys(byArea);
  const data = Object.values(byArea);
  if (!labels.length) { canvas.parentElement.style.display = 'none'; return; }
  canvas.parentElement.style.display = '';
  if (finChartInst) finChartInst.destroy();
  finChartInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: ['#2dd4f5','#3af098','#ff5f72','#ffb347','#f0c060','#7eeeff'], borderWidth: 0 }]
    },
    options: {
      responsive: true, cutout: '68%',
      plugins: { legend: { position: 'right', labels: { color: '#6e8f9a', font: { size: 11 }, boxWidth: 10 } } }
    }
  });
}

// ─── TASKS ────────────────────────────────────────────────
const priorityName = p => ({ high: 'Alta', medium: 'Média', low: 'Baixa' }[p] || 'Média');
const priorityClass = p => ({ high: 'prio-high', medium: 'prio-med', low: 'prio-low' }[p] || '');
const itemActions = (type, id) => `<div class="actions"><button class="mini" data-edit="${type}" data-id="${id}" title="Editar">✎</button><button class="mini danger" data-del="${type}" data-id="${id}" title="Excluir">🗑</button></div>`;

function renderTasks(filter = 'all') {
  const list = $('#taskList'); if (!list) return;
  let arr = [...state.tasks];
  if (filter === 'open') arr = arr.filter(t => !t.done);
  if (filter === 'done') arr = arr.filter(t => t.done);
  if (filter === 'high') arr = arr.filter(t => t.priority === 'high' && !t.done);
  if (filter === 'today') arr = arr.filter(t => t.due === today() && !t.done);

  list.innerHTML = arr.length ? arr.map(t => {
    const subDone = (t.subtasks || []).filter(s => s.done).length;
    const subTotal = (t.subtasks || []).length;
    const subInfo = subTotal ? ` • ${subDone}/${subTotal} subtarefas` : '';
    const tagsHtml = (t.tags || []).filter(Boolean).map(tag => `<span class="tag">#${esc(tag)}</span>`).join('');
    return `
      <div class="item${t.done ? ' item-done' : ''}">
        <div class="itemIcon">☑</div>
        <div class="itemMain">
          <label class="checkline"><input type="checkbox" data-toggle-task="${t.id}" ${t.done ? 'checked' : ''}> <strong>${esc(t.title)}</strong></label>
          <p>${esc(t.area || 'Sem área')}${t.due ? ' • 📅 ' + esc(t.due) : ''}${subInfo}</p>
          ${tagsHtml ? `<div class="tags-wrap">${tagsHtml}</div>` : ''}
        </div>
        <span class="badge ${priorityClass(t.priority)}">${priorityName(t.priority)}</span>
        ${itemActions('task', t.id)}
      </div>
      ${subTotal ? `<div class="item-subtasks">${(t.subtasks || []).map(s => `
        <div class="subtask-item"><input type="checkbox" data-toggle-subtask="${t.id}" data-sub-id="${s.id}" ${s.done ? 'checked' : ''}><label>${esc(s.title)}</label></div>`).join('')}</div>` : ''}
    `;
  }).join('') : '<div class="item"><p>Nenhuma tarefa neste filtro.</p></div>';
}

// ─── FINANCE ──────────────────────────────────────────────
function renderFinance(filter = 'all') {
  const list = $('#financeList'); if (!list) return;
  const m = financeSummary(monthFinances());
  setText('#financeTotal', money(m.balance));
  setText('#incomeTotal', `↑ ${money(m.income)}`);
  setText('#expenseTotal', `↓ ${money(m.expense)}`);

  // Goals
  renderGoals();

  let arr = [...state.finances].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (filter === 'income') arr = arr.filter(f => f.type === 'income');
  if (filter === 'expense') arr = arr.filter(f => f.type === 'expense');
  if (filter === 'recurring') arr = arr.filter(f => f.recurring);

  list.innerHTML = arr.length ? arr.map(f => `
    <div class="item">
      <div class="itemIcon" style="${f.type === 'income' ? 'color:var(--green);background:rgba(58,240,152,.08);border-color:rgba(58,240,152,.12)' : 'color:var(--red);background:rgba(255,95,114,.08);border-color:rgba(255,95,114,.12)'}">${f.type === 'income' ? '＋' : '−'}</div>
      <div class="itemMain">
        <h4>${f.type === 'income' ? 'Receita' : 'Despesa'}: ${esc(f.title)}${f.recurring ? ' 🔁' : ''}</h4>
        <p>${esc(f.area || 'Sem área')} • ${money(f.value)} • ${esc(f.date || '')}</p>
      </div>
      ${itemActions('finance', f.id)}
    </div>`).join('') : '<div class="item"><p>Nenhum lançamento.</p></div>';
}

function renderGoals() {
  const box = $('#goalsList'); if (!box) return;
  if (!state.goals.length) { box.innerHTML = ''; return; }
  box.innerHTML = state.goals.map(g => {
    const pct = Math.min(100, Math.round((Number(g.current || 0) / Number(g.target || 1)) * 100));
    return `<div class="goal-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h5>🎯 ${esc(g.title)}</h5>
        <button class="mini danger" data-del="goal" data-id="${g.id}" title="Remover">🗑</button>
      </div>
      <small>${money(g.current || 0)} de ${money(g.target)} — ${pct}%</small>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ─── HABITS ───────────────────────────────────────────────
function renderHabits() {
  const list = $('#habitList'); if (!list) return;
  const label = $('#habitDateLabel');
  if (label) label.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });

  list.innerHTML = state.habits.length ? state.habits.map(h => {
    const hist = buildHabitCalendar(h);
    return `
      <div class="item" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="itemIcon" style="${h.checked ? 'background:rgba(58,240,152,.15);border-color:rgba(58,240,152,.3);color:var(--green)' : ''}">◎</div>
          <div class="itemMain">
            <label class="checkline"><input type="checkbox" data-toggle-habit="${h.id}" ${h.checked ? 'checked' : ''}> <strong>${esc(h.title)}</strong></label>
            <p>${esc(h.area || '')} • 🔥 ${Number(h.streak || 0)} dia${h.streak !== 1 ? 's' : ''}</p>
          </div>
          ${itemActions('habit', h.id)}
        </div>
        <div class="habit-calendar">${hist}</div>
      </div>`;
  }).join('') : '<div class="item"><p>Nenhum hábito. Toque em + para criar.</p></div>';
}

function buildHabitCalendar(h) {
  const days = 21;
  const hist = new Set(h.history || []);
  let html = '';
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const done = hist.has(key);
    html += `<div class="cal-day ${done ? 'done' : ''}" title="${key}"></div>`;
  }
  return html;
}

// ─── FOCUS ────────────────────────────────────────────────
function renderFocus() {
  const list = $('#focusList'); if (!list) return;
  const prio = { high: 3, medium: 2, low: 1 };
  const arr = state.tasks.filter(t => !t.done).sort((a, b) => (prio[b.priority] || 2) - (prio[a.priority] || 2)).slice(0, 3);
  setText('#focusAdvice', arr.length ? 'Resolva estas antes de abrir novas tarefas.' : 'Nenhuma tarefa aberta. Excelente! 🎉');
  list.innerHTML = arr.length ? arr.map((t, i) => `
    <div class="item">
      <div class="itemIcon">${i + 1}</div>
      <div class="itemMain"><h4>${esc(t.title)}</h4><p>${esc(t.area || '')} • ${priorityName(t.priority)}${t.due ? ' • 📅 ' + esc(t.due) : ''}</p></div>
      <span class="badge ${priorityClass(t.priority)}">${priorityName(t.priority)}</span>
    </div>`).join('') : '<div class="item"><p>Nada pendente! 🎉</p></div>';
}

// ─── CHAT / AI ────────────────────────────────────────────
function addChat(role, text) {
  state.chat.push({ role, text, at: new Date().toISOString() });
  state.chat = state.chat.slice(-100);
  saveLocal(); renderChat();
}

function renderChat() {
  const box = $('#chatBox'); if (!box) return;
  const apiKey = state.settings?.apiKey || '';
  setText('#aiModelLabel', apiKey ? 'Claude Sonnet — ativo' : 'Configure a API key em Configurações');
  box.innerHTML = state.chat.length
    ? state.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('')
    : `<div class="msg ai">Olá! 👋 Sou seu assistente IA.\n\n${apiKey ? 'Minha API key está configurada. Você pode me fazer perguntas abertas!' : 'Configure sua API key da Anthropic em Configurações para usar o Claude real.'}\n\nComandos rápidos:\n• "crie uma tarefa X amanhã"\n• "despesa de 35 reais com Y"\n• "receita de 120 reais venda Z"\n• "analise meu dia"</div>`;
  box.scrollTop = box.scrollHeight;
}

async function handleAiMessage(text, spoken = false) {
  const clean = text.trim(); if (!clean) return;
  const input = $('#aiInput'); if (input) input.value = '';
  addChat('user', clean);

  // Show typing indicator
  const box = $('#chatBox');
  const typing = document.createElement('div');
  typing.className = 'msg ai typing'; typing.textContent = '...'; box?.appendChild(typing);
  box.scrollTop = box.scrollHeight;

  const result = await runAI(clean);
  typing.remove();
  addChat('ai', result);
  if (spoken) speak(result);
  renderAll();
}

async function runAI(text) {
  const lower = text.toLowerCase();
  const value = extractValue(lower);

  // Local commands first (fast)
  if (/\b(tarefa|lembrete|atividade)\b/.test(lower) && /\b(cri|adicion|coloc|cadast|inclu)\b/.test(lower)) {
    const title = cleanupTitle(text, ['criar','crie','adicione','adicionar','coloque','cadastrar','cadastre','uma tarefa','tarefa','lembrete']);
    state.tasks.unshift({ id: uid(), title: title || 'Nova tarefa', area: inferArea(lower), priority: lower.includes('urgente')||lower.includes('alta') ? 'high' : 'medium', done: false, due: inferDate(lower), notes: 'Criada por IA.', tags: [], subtasks: [] });
    await saveCloud(); return `✅ Tarefa criada: "${title || 'Nova tarefa'}"`;
  }
  if (/\b(despesa|gasto|paguei|compra|comprei)\b/.test(lower)) {
    const title = cleanupTitle(text, ['registrar','registre','lançar','lance','adicionar','adicione','despesa','gasto','paguei','compra','comprei',String(value||'')]);
    state.finances.unshift({ id: uid(), type: 'expense', title: title || 'Despesa', area: inferArea(lower), value: value ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💸 Despesa registrada: ${money(value ?? 0)} — "${title || 'Despesa'}"`;
  }
  if (/\b(receita|venda|recebi|entrada|faturamento)\b/.test(lower)) {
    const title = cleanupTitle(text, ['registrar','registre','lançar','lance','adicionar','adicione','receita','venda','recebi','entrada',String(value||'')]);
    state.finances.unshift({ id: uid(), type: 'income', title: title || 'Receita', area: inferArea(lower), value: value ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💰 Receita registrada: ${money(value ?? 0)} — "${title || 'Receita'}"`;
  }
  if (/\b(analise|analisar|resumo|prioridade|dia|finanças|financeiro|hábito)\b/.test(lower) && !state.settings?.apiKey) return smartAnswer();

  // Claude API (real AI)
  const apiKey = state.settings?.apiKey || '';
  if (apiKey) return callClaude(text, apiKey);

  // Fallback endpoint
  const endpoint = state.settings?.aiEndpoint || window.AI_ENDPOINT || '';
  if (endpoint) return callEndpoint(text, endpoint);

  return smartAnswer();
}

function buildContext() {
  const m = financeSummary(monthFinances());
  const open = state.tasks.filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  const habits = state.habits;
  return `Contexto do usuário (hoje: ${today()}):
- Tarefas abertas: ${open.length} (${high.length} alta prioridade): ${high.slice(0,3).map(t=>t.title).join(', ')}
- Finanças do mês: receitas ${money(m.income)}, despesas ${money(m.expense)}, saldo ${money(m.balance)}
- Hábitos: ${habits.filter(h=>h.checked).length}/${habits.length} concluídos hoje
- Último lançamento financeiro: ${daysSinceLastFinance()} dias atrás`;
}

async function callClaude(text, apiKey) {
  try {
    const context = buildContext();
    const messages = [
      ...state.chat.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: text }
    ];
    // Remove last user message since it's already in chat
    messages.pop();
    messages.push({ role: 'user', content: text });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `Você é um assistente pessoal inteligente integrado ao app do usuário. Responda sempre em português brasileiro. Seja direto, prático e útil. ${context}`,
        messages: state.chat.slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })).concat([{ role: 'user', content: text }])
      })
    });
    const data = await res.json();
    if (data.error) return `Erro da API: ${data.error.message}`;
    return data.content?.[0]?.text || 'Sem resposta.';
  } catch (e) {
    return `Erro ao chamar Claude: ${e.message}. Verifique a API key em Configurações.`;
  }
}

async function callEndpoint(text, endpoint) {
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, context: buildContext(), data: state }) });
    const data = await r.json();
    return data.reply || 'Backend respondeu sem texto.';
  } catch { return 'Não foi possível acessar o backend. Verifique o endpoint em Configurações.'; }
}

function smartAnswer() {
  const m = financeSummary(monthFinances());
  const open = state.tasks.filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  const doneH = state.habits.filter(h => h.checked).length;
  return `📊 Resumo inteligente:\n• ${open.length} tarefa${open.length !== 1 ? 's' : ''} aberta${open.length !== 1 ? 's' : ''}, ${high.length} de alta prioridade${high.length ? ': ' + high.slice(0,2).map(t=>t.title).join(', ') : ''}.\n• Saldo do mês: ${money(m.balance)} (↑${money(m.income)} / ↓${money(m.expense)}).\n• Hábitos hoje: ${doneH}/${state.habits.length} concluídos.\n\n💡 ${high.length ? 'Prioridade: resolva primeiro uma tarefa urgente.' : daysSinceLastFinance() > 1 ? 'Registre os gastos do dia para manter o controle.' : 'Tudo em dia! Mantenha a consistência.'}`;
}

// ─── NLP helpers ──────────────────────────────────────────
function extractValue(t) { const m = t.replace(',', '.').match(/(?:r\$\s*)?(\d+(?:\.\d{1,2})?)\s*(?:reais|real)?/); return m ? Number(m[1]) : null; }
function cleanupTitle(text, words) {
  let s = text;
  words.forEach(w => { if (w) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '); });
  return s.replace(/\b(de|do|da|com|para|por|reais|real|r\$|\d+)\b/ig, ' ').replace(/\s+/g, ' ').trim();
}
function inferArea(t) {
  if (t.includes('pudim') || t.includes('pudding') || t.includes('sanja pudding')) return 'Sanja Pudding';
  if (t.includes('neon') || t.includes('letreiro') || t.includes('acrílico')) return 'Neon Sanja';
  return 'Geral';
}
function inferDate(t) {
  const d = new Date();
  const lower = t.toLowerCase();
  if (lower.includes('amanhã')) { d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  if (lower.includes('semana que vem') || lower.includes('próxima semana')) { d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }
  if (lower.includes('segunda')) { return nextWeekday(1); }
  if (lower.includes('terça')) { return nextWeekday(2); }
  if (lower.includes('quarta')) { return nextWeekday(3); }
  if (lower.includes('quinta')) { return nextWeekday(4); }
  if (lower.includes('sexta')) { return nextWeekday(5); }
  if (lower.includes('final do mês') || lower.includes('fim do mês')) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }
  const dayMatch = lower.match(/dia\s+(\d{1,2})/);
  if (dayMatch) { const day = parseInt(dayMatch[1]); d.setDate(day); return d.toISOString().slice(0, 10); }
  return '';
}
function nextWeekday(wd) {
  const d = new Date(); const diff = (wd + 7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10);
}

// ─── Voice ────────────────────────────────────────────────
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#voiceBtn');
  if (!SR) {
    voiceAvailable = false;
    if (mic) { mic.classList.add('disabled'); mic.title = 'Voz indisponível. Use Chrome no Android em HTTPS.'; mic.setAttribute('aria-disabled', 'true'); }
    return;
  }
  voiceAvailable = true;
  recognition = new SR(); recognition.lang = 'pt-BR'; recognition.continuous = false; recognition.interimResults = false;
  recognition.onstart = () => { listening = true; mic?.classList.add('recording'); toast('🎙 Ouvindo... fale o comando.'); };
  recognition.onend = () => { listening = false; mic?.classList.remove('recording'); };
  recognition.onerror = e => {
    listening = false; mic?.classList.remove('recording');
    if (e.error === 'not-allowed') toast('Microfone bloqueado. Permita o acesso nas configurações do Chrome.');
    else if (e.error === 'no-speech') toast('Nenhuma fala detectada. Tente novamente.');
    else toast('Erro de voz. Verifique o microfone.');
  };
  recognition.onresult = ev => { const text = ev.results?.[0]?.[0]?.transcript || ''; const inp = $('#aiInput'); if (inp) inp.value = text; handleAiMessage(text, true); };
}
function startVoice() {
  if (!voiceAvailable) { toast('Reconhecimento de voz não disponível. Use Chrome no Android em HTTPS.'); return; }
  listening ? recognition.stop() : recognition.start();
}
function speak(text) {
  try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\n/g, '. ')); u.lang = 'pt-BR'; u.rate = 1.05; speechSynthesis.speak(u); } catch {}
}

// ─── Notifications ────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) { toast('Notificações não suportadas neste navegador.'); return; }
  const perm = await Notification.requestPermission();
  state.settings.notifPermission = perm;
  saveCloud();
  const status = $('#notifStatus');
  if (status) status.textContent = perm === 'granted' ? 'Ativadas ✓' : perm === 'denied' ? 'Bloqueadas pelo usuário' : 'Não concedidas';
  toast(perm === 'granted' ? '🔔 Notificações ativadas!' : 'Permissão não concedida.');
}
function scheduleProactiveInsight() {
  if (Notification.permission !== 'granted') return;
  const high = state.tasks.filter(t => !t.done && t.priority === 'high');
  const daysNoFin = daysSinceLastFinance();
  setTimeout(() => {
    if (high.length) new Notification('Assistente IA — Prioridade', { body: `Você tem ${high.length} tarefa(s) urgente(s). Verifique o app.`, icon: 'icons/icon-192.png' });
    else if (daysNoFin > 2) new Notification('Assistente IA — Finanças', { body: `Você não lança finanças há ${daysNoFin} dias. Registre hoje!`, icon: 'icons/icon-192.png' });
  }, 3000);
}
function updateNotifStatus() {
  const status = $('#notifStatus');
  if (!status) return;
  const p = Notification?.permission || 'default';
  status.textContent = p === 'granted' ? 'Ativadas ✓' : p === 'denied' ? 'Bloqueadas pelo usuário' : 'Clique para permitir';
}

// ─── Exports ──────────────────────────────────────────────
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `backup-ia-v40-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  state.settings.lastBackupNotice = today(); saveLocal(); toast('Backup JSON exportado.');
}
function exportCSV() {
  const rows = [['Tipo','Título','Área','Valor','Data','Recorrente']];
  state.finances.forEach(f => rows.push([f.type === 'income' ? 'Receita' : 'Despesa', f.title, f.area || '', f.value, f.date, f.recurring ? 'Sim' : 'Não']));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `financas-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast('CSV exportado. Abre no Excel ou Google Sheets.');
}
function importBackup(file) {
  const r = new FileReader();
  r.onload = async () => { try { normalizeData(JSON.parse(r.result)); await saveCloud(); renderAll(); updateSettingsInputs(); toast('Backup importado!'); } catch { toast('Arquivo inválido.'); } };
  r.readAsText(file);
}
function maybeBackupNotice() {
  if (!state.settings.backupReminder) return;
  const last = state.settings.lastBackupNotice || '';
  if (last !== today() && (!firebaseReady || demoMode)) toast('⚠️ Dados locais. Exporte backup em Configurações.', 6000);
}

// ─── Settings helpers ─────────────────────────────────────
function updateSettingsInputs() {
  const apiInput = $('#apiKeyInput'); if (apiInput) apiInput.value = state.settings?.apiKey || '';
  const epInput = $('#aiEndpointInput'); if (epInput) epInput.value = state.settings?.aiEndpoint || '';
  applyTheme(state.settings?.theme || 'dark');
  updateNotifStatus();
}
async function saveApiKey() {
  state.settings.apiKey = ($('#apiKeyInput')?.value || '').trim();
  await saveCloud(); toast(state.settings.apiKey ? '🧠 API key do Claude salva!' : 'API key removida. Modo local ativo.');
  renderChat();
}
async function saveEndpoint() {
  state.settings.aiEndpoint = ($('#aiEndpointInput')?.value || '').trim();
  await saveCloud(); toast(state.settings.aiEndpoint ? 'Endpoint salvo.' : 'Endpoint removido.');
}

// ─── Modal ────────────────────────────────────────────────
const findArr = type => type === 'task' ? state.tasks : type === 'finance' ? state.finances : type === 'habit' ? state.habits : state.goals;
const findObj = (type, id) => findArr(type).find(x => x.id === id);

function openModal(type, id = null) {
  const modal = $('#modal'), title = $('#modalTitle'), body = $('#modalBody');
  const obj = id ? findObj(type, id) : null;
  title.textContent = (id ? 'Editar ' : 'Adicionar ') + ({ task: 'tarefa', finance: 'lançamento', habit: 'hábito', goal: 'meta financeira' }[type] || 'item');
  if (type === 'task') body.innerHTML = formTask(obj);
  if (type === 'finance') body.innerHTML = formFinance(obj);
  if (type === 'habit') body.innerHTML = formHabit(obj);
  if (type === 'goal') body.innerHTML = formGoal(obj);
  body.innerHTML += `<div class="modalActions"><button id="modalSave" class="btn primary">Salvar</button><button id="modalCancel" class="btn secondary">Cancelar</button></div>`;
  if (obj?.priority) { const el = $('#mPriority'); if (el) el.value = obj.priority; }
  if (obj?.type) { const el = $('#mType'); if (el) el.value = obj.type; }
  $('#modalSave').onclick = async () => { await saveModal(type, id); closeModal(); };
  $('#modalCancel').onclick = closeModal;
  modal.classList.remove('hidden');
}
const closeModal = () => $('#modal')?.classList.add('hidden');

function formTask(o = {}) {
  return `
    <label>Título</label><input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: ligar para cliente">
    <label>Área/negócio</label><input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Neon Sanja, Sanja Pudding...">
    <label>Prioridade</label><select id="mPriority"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Alta</option></select>
    <label>Prazo</label><input id="mDue" class="input" type="date" value="${esc(o?.due||'')}">
    <label>Tags (separadas por vírgula)</label><input id="mTags" class="input" value="${esc((o?.tags||[]).join(', '))}" placeholder="marketing, urgente, cliente">
    <label>Subtarefas (uma por linha)</label><textarea id="mSubtasks" placeholder="Etapa 1&#10;Etapa 2">${(o?.subtasks||[]).map(s=>s.title).join('\n')}</textarea>
    <label>Observações</label><textarea id="mNotes" placeholder="Detalhes">${esc(o?.notes||'')}</textarea>`;
}
function formFinance(o = {}) {
  return `
    <label>Tipo</label><select id="mType"><option value="income">Receita</option><option value="expense">Despesa</option></select>
    <label>Descrição</label><input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: venda de pudim">
    <label>Categoria/negócio</label><input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Sanja Pudding...">
    <label>Valor</label><input id="mValue" class="input" type="number" step="0.01" value="${esc(o?.value||'')}" placeholder="0,00">
    <label>Data</label><input id="mDate" class="input" type="date" value="${esc(o?.date||today())}">
    <label class="checkline" style="text-transform:none;font-size:13px;margin:12px 0 6px"><input type="checkbox" id="mRecurring" ${o?.recurring?'checked':''}> Despesa/Receita fixa mensal (recorrente)</label>
    <label>Observações</label><textarea id="mNotes" placeholder="Detalhes">${esc(o?.notes||'')}</textarea>`;
}
function formHabit(o = {}) {
  return `
    <label>Hábito</label><input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: prospectar clientes">
    <label>Área</label><input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Pessoal, negócios...">
    <label>Sequência atual</label><input id="mStreak" class="input" type="number" value="${Number(o?.streak||0)}">`;
}
function formGoal(o = {}) {
  return `
    <label>Título da meta</label><input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: reserva de emergência">
    <label>Valor alvo</label><input id="mTarget" class="input" type="number" step="0.01" value="${esc(o?.target||'')}" placeholder="5000,00">
    <label>Valor atual</label><input id="mCurrent" class="input" type="number" step="0.01" value="${esc(o?.current||'')}" placeholder="0,00">`;
}

function upsert(arr, data, id) { const i = arr.findIndex(x => x.id === id); if (i >= 0) arr[i] = data; else arr.unshift(data); }

async function saveModal(type, id) {
  if (type === 'task') {
    const tags = ($('#mTags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    const subLines = ($('#mSubtasks')?.value || '').split('\n').map(t => t.trim()).filter(Boolean);
    const existing = (findObj(type, id)?.subtasks || []);
    const subtasks = subLines.map(t => existing.find(s => s.title === t) || { id: uid(), title: t, done: false });
    upsert(state.tasks, { id: id||uid(), title: $('#mTitle').value.trim()||'Sem título', area: $('#mArea').value.trim(), priority: $('#mPriority').value, due: $('#mDue').value, notes: $('#mNotes').value, done: findObj(type,id)?.done||false, tags, subtasks }, id);
  }
  if (type === 'finance') {
    upsert(state.finances, { id: id||uid(), type: $('#mType').value, title: $('#mTitle').value.trim()||'Sem descrição', area: $('#mArea').value.trim(), value: Number($('#mValue').value||0), date: $('#mDate').value||today(), notes: $('#mNotes').value, recurring: $('#mRecurring')?.checked||false }, id);
  }
  if (type === 'habit') {
    const existing = findObj(type, id);
    upsert(state.habits, { id: id||uid(), title: $('#mTitle').value.trim()||'Sem título', area: $('#mArea').value.trim(), streak: Number($('#mStreak').value||0), checked: existing?.checked||false, lastCheckedDate: existing?.lastCheckedDate||'', history: existing?.history||[] }, id);
  }
  if (type === 'goal') {
    upsert(state.goals, { id: id||uid(), title: $('#mTitle').value.trim()||'Meta', target: Number($('#mTarget').value||0), current: Number($('#mCurrent').value||0) }, id);
  }
  await saveCloud(); renderAll(); toast('Salvo com sucesso.');
}

async function removeItem(type, id) {
  if (!confirm('Excluir este item? Esta ação não pode ser desfeita.')) return;
  const arr = findArr(type); const i = arr.findIndex(x => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  await saveCloud(); renderAll(); toast('Item excluído.');
}

// ─── Event binding ────────────────────────────────────────
function bind() {
  $('#loginBtn')?.addEventListener('click', login);
  $('#registerBtn')?.addEventListener('click', register);
  $('#googleBtn')?.addEventListener('click', googleLogin);
  $('#demoBtn')?.addEventListener('click', async () => { demoMode = true; currentUser = null; await enterApp(); toast('Modo demonstração ativo.'); });
  $('#logoutBtn')?.addEventListener('click', async () => { try { if (auth) await signOut(auth); } catch {} exitApp(); });
  $('#obNext')?.addEventListener('click', obNext);
  $('#obSkip')?.addEventListener('click', finishOnboarding);
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#sendAiBtn')?.addEventListener('click', () => handleAiMessage($('#aiInput')?.value || ''));
  $('#aiInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiMessage($('#aiInput')?.value || ''); } });
  $('#voiceBtn')?.addEventListener('click', startVoice);
  $('#clearChatBtn')?.addEventListener('click', async () => { if (!confirm('Limpar histórico do chat?')) return; state.chat = []; await saveCloud(); renderChat(); });
  $('#refreshInsightsBtn')?.addEventListener('click', () => { renderInsights(); toast('Insights atualizados.'); });
  $('#exportBtn')?.addEventListener('click', exportBackup);
  $('#exportCsvBtn')?.addEventListener('click', exportCSV);
  $('#importInput')?.addEventListener('change', e => e.target.files?.[0] && importBackup(e.target.files[0]));
  $('#syncBtn')?.addEventListener('click', async () => { await saveCloud(); toast(firebaseReady && currentUser && !demoMode ? '☁ Sincronizado!' : '💾 Dados salvos localmente.'); });
  $('#resetBtn')?.addEventListener('click', async () => { if (confirm('Apagar todos os dados? Sem retorno.')) { state = defaultData(); await saveCloud(); renderAll(); updateSettingsInputs(); toast('Dados apagados.'); } });
  $('#saveApiKeyBtn')?.addEventListener('click', saveApiKey);
  $('#saveEndpointBtn')?.addEventListener('click', saveEndpoint);
  $('#themeBtn')?.addEventListener('click', toggleTheme);
  $('#notifPermBtn')?.addEventListener('click', requestNotifPermission);

  document.addEventListener('click', async e => {
    const b = e.target.closest('button,[data-open]'); if (!b) return;
    if (b.dataset.screen) showScreen(b.dataset.screen);
    if (b.dataset.open) showScreen(b.dataset.open);
    if (b.dataset.home !== undefined) showScreen('home');
    if (b.dataset.modal) openModal(b.dataset.modal);
    if (b.dataset.edit) openModal(b.dataset.edit, b.dataset.id);
    if (b.dataset.del) await removeItem(b.dataset.del, b.dataset.id);
    if (b.dataset.taskFilter) {
      activeTaskFilter = b.dataset.taskFilter;
      $$('.filters button[data-task-filter]').forEach(x => x.classList.toggle('active', x === b));
      renderTasks(activeTaskFilter);
    }
    if (b.dataset.financeFilter) {
      activeFinanceFilter = b.dataset.financeFilter;
      $$('.filters button[data-finance-filter]').forEach(x => x.classList.toggle('active', x === b));
      renderFinance(activeFinanceFilter);
    }
    if (b.dataset.prompt) { const i = $('#aiInput'); if (i) i.value = b.dataset.prompt; await handleAiMessage(b.dataset.prompt); }
    if (b.id === 'notifyBtn') requestNotifPermission();
    // Finance goal modal
    if (b.id === 'addGoalBtn') openModal('goal');
  });

  document.addEventListener('change', async e => {
    if (e.target.dataset.toggleTask) {
      const t = state.tasks.find(x => x.id === e.target.dataset.toggleTask);
      if (t) t.done = e.target.checked;
      await saveCloud(); renderAll();
    }
    if (e.target.dataset.toggleHabit) {
      const h = state.habits.find(x => x.id === e.target.dataset.toggleHabit);
      if (h) {
        const t = today();
        h.checked = e.target.checked;
        h.lastCheckedDate = e.target.checked ? t : (h.lastCheckedDate || '');
        h.streak = Math.max(0, Number(h.streak || 0) + (e.target.checked ? 1 : -1));
        if (e.target.checked && !h.history.includes(t)) h.history = [...(h.history || []).slice(-60), t];
      }
      await saveCloud(); renderAll();
    }
    if (e.target.dataset.toggleSubtask) {
      const taskId = e.target.dataset.toggleSubtask;
      const subId = e.target.dataset.subId;
      const task = state.tasks.find(x => x.id === taskId);
      if (task) { const sub = task.subtasks.find(s => s.id === subId); if (sub) sub.done = e.target.checked; }
      await saveCloud(); renderTasks(activeTaskFilter);
    }
  });
}

// ─── Init ─────────────────────────────────────────────────
bind();
setupVoice();
initFirebase();
renderAll();
