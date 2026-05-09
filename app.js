// ── Firebase imports ──────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── Utils ─────────────────────────────────────────
const $ = q => document.querySelector(q);
const $$ = q => Array.from(document.querySelectorAll(q));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2);
const today = () => new Date().toISOString().slice(0, 10);
const fmt = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = n => { const v = Number(n) || 0; if (Math.abs(v) >= 1000) return 'R$' + (v / 1000).toFixed(1) + 'k'; return 'R$' + v.toFixed(0); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const monthYM = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7); };
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return new Date(+y, +m - 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); };

// ── State ─────────────────────────────────────────
const makeDefault = () => ({
  tasks: [
    { id: uid(), title: 'Revisar pedidos Neon Sanja', area: 'Neon Sanja', priority: 'high', done: false, due: '', notes: '', tags: ['neon'], subtasks: [] },
    { id: uid(), title: 'Conferir estoque de pudins', area: 'Sanja Pudding', priority: 'medium', done: false, due: '', notes: '', tags: [], subtasks: [{ id: uid(), title: 'Contar bandejas', done: false }, { id: uid(), title: 'Anotar validades', done: false }] }
  ],
  finances: [
    { id: uid(), type: 'income', title: 'Venda exemplo', area: 'Sanja Pudding', value: 350, date: today(), notes: '', recurring: false },
    { id: uid(), type: 'expense', title: 'Insumos exemplo', area: 'Sanja Pudding', value: 120, date: today(), notes: '', recurring: false }
  ],
  habits: [
    { id: uid(), title: 'Planejar o dia', area: 'Pessoal', streak: 3, checked: false, lastCheckedDate: '', history: [] },
    { id: uid(), title: 'Prospectar clientes', area: 'Negócios', streak: 1, checked: false, lastCheckedDate: '', history: [] }
  ],
  goals: [],
  chat: [],
  settings: { aiEndpoint: '', apiKey: '', lastHabitReset: '', onboardingDone: false, theme: 'dark', notifPermission: 'default', lastBackupNotice: '' }
});

let state = makeDefault();
let currentUser = null, demoMode = false;
let auth = null, db = null, firebaseReady = false;
let taskFilter = 'all', finFilter = 'all';
let SR = null, listening = false, voiceOk = false;
let chartHome = null, chartFin = null;
let obIdx = 0;

// ── Toast ─────────────────────────────────────────
function toast(msg, ms = 4000) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast show';
  clearTimeout(window._tt); window._tt = setTimeout(() => el.classList.remove('show'), ms);
}

// ── Theme ─────────────────────────────────────────
function applyTheme(t = 'dark') {
  document.body.classList.toggle('light', t === 'light');
  const meta = $('#themeColorMeta'); if (meta) meta.content = t === 'light' ? '#eef3f8' : '#07101a';
  const lbl = $('#themeLabel'), ico = $('#themeIcon');
  if (lbl) lbl.textContent = t === 'light' ? 'Claro' : 'Escuro';
  if (ico) ico.textContent = t === 'light' ? '☀️' : '🌙';
}

// ── Storage ───────────────────────────────────────
const storageKey = () => currentUser && !demoMode ? `ia41-${currentUser.uid}` : 'ia41-demo';
function normalize(raw) {
  const def = makeDefault();
  state = { ...def, ...(raw || {}) };
  state.tasks = (state.tasks || []).map(t => ({ tags: [], subtasks: [], ...t }));
  state.finances = (state.finances || []).map(f => ({ recurring: false, recurringParent: null, ...f }));
  state.habits = (state.habits || []).map(h => ({ lastCheckedDate: '', history: [], ...h }));
  state.goals = state.goals || [];
  state.chat = state.chat || [];
  state.settings = { ...def.settings, ...(state.settings || {}) };
}
const saveLocal = () => { try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch {} };
function loadLocal() { try { normalize(JSON.parse(localStorage.getItem(storageKey()))); } catch { normalize(null); } }
async function saveCloud() {
  saveLocal();
  if (firebaseReady && currentUser && !demoMode) {
    try { await setDoc(doc(db, 'users', currentUser.uid), { data: state, ts: Date.now() }, { merge: true }); } catch {}
  }
}
async function loadCloud() {
  loadLocal();
  if (firebaseReady && currentUser && !demoMode) {
    try { const s = await getDoc(doc(db, 'users', currentUser.uid)); if (s.exists() && s.data().data) normalize(s.data().data); else await saveCloud(); } catch {}
  }
}

// ── Service Worker ────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => { console.log('[SW] registered', reg.scope); })
      .catch(err => console.warn('[SW] failed', err));
  }
}

// ── Daily reset ───────────────────────────────────
function dailyReset() {
  const t = today();
  if (state.settings.lastHabitReset === t) return false;
  let reset = false;
  state.habits = state.habits.map(h => {
    if (h.checked && h.lastCheckedDate && h.lastCheckedDate !== t) { reset = true; return { ...h, checked: false }; }
    return h;
  });
  state.settings.lastHabitReset = t;
  applyRecurring();
  return reset;
}

function applyRecurring() {
  const ym = monthYM();
  state.finances.filter(f => f.recurring).forEach(f => {
    const exists = state.finances.some(x => x.recurringParent === f.id && String(x.date || '').startsWith(ym));
    if (!exists && f.date && !String(f.date).startsWith(ym)) {
      const day = String(f.date).slice(8) || '01';
      state.finances.push({ ...f, id: uid(), date: `${ym}-${day}`, recurringParent: f.id, recurring: false });
    }
  });
}

// ── Firebase / Auth ───────────────────────────────
async function initFirebase() {
  try {
    if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.includes('SUA_')) throw new Error('no config');
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app); db = getFirestore(app); firebaseReady = true;
    onAuthStateChanged(auth, async u => { if (u) { currentUser = u; demoMode = false; await enterApp(); } });
  } catch { setText('#syncStatus', '💾 Modo local'); }
}

const validateLogin = () => {
  const e = ($('#email')?.value || '').trim(), p = $('#password')?.value || '';
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  if (p.length < 6) throw new Error('Senha: mínimo 6 caracteres.');
  return { e, p };
};
async function doLogin() { try { const { e, p } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não configurado. Use modo demonstração.'); await signInWithEmailAndPassword(auth, e, p); } catch (err) { toast(fbMsg(err)); } }
async function doRegister() { try { const { e, p } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não configurado.'); await createUserWithEmailAndPassword(auth, e, p); } catch (err) { toast(fbMsg(err)); } }
async function doGoogle() { if (!firebaseReady) { toast('Firebase não configurado.'); return; } try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (err) { toast(fbMsg(err)); } }
const fbMsg = e => { const c = e?.code || ''; if (c.includes('email-already')) return 'E-mail já cadastrado. Use Entrar.'; if (c.includes('wrong-password') || c.includes('invalid-credential')) return 'E-mail ou senha incorretos.'; if (c.includes('user-not-found')) return 'Conta não encontrada.'; if (c.includes('popup-closed')) return 'Login cancelado.'; return e?.message || 'Erro inesperado.'; };

// ── Onboarding ────────────────────────────────────
function showOnboarding() { $('#loginScreen')?.classList.add('hidden'); $('#onboardingScreen')?.classList.remove('hidden'); slide(0); }
function slide(i) { obIdx = i; $$('.ob-slide').forEach((s, idx) => s.classList.toggle('active', idx === i)); $$('.ob-dot').forEach((d, idx) => d.classList.toggle('active', idx === i)); if ($('#obNext')) $('#obNext').textContent = i === 3 ? 'Começar ✦' : 'Próximo'; }
function obNext() { obIdx < 3 ? slide(obIdx + 1) : finishOb(); }
function finishOb() { state.settings.onboardingDone = true; saveLocal(); launchApp(); }

// ── Enter / Exit App ──────────────────────────────
async function enterApp() {
  await loadCloud();
  const wasReset = dailyReset();
  if (wasReset) { await saveCloud(); toast('🌅 Novo dia! Hábitos resetados.'); }
  applyTheme(state.settings.theme);
  updateSettingsUI();
  if (!state.settings.onboardingDone) { showOnboarding(); return; }
  launchApp();
}
function launchApp() {
  $('#loginScreen')?.classList.add('hidden');
  $('#onboardingScreen')?.classList.add('hidden');
  $('#appScreen')?.classList.remove('hidden');
  $('#bottomNav')?.classList.remove('hidden');
  showScreen('home'); renderAll();
  scheduleProactiveNotif();
}
async function exitApp() {
  try { if (auth) await signOut(auth); } catch {}
  currentUser = null; demoMode = false;
  $('#loginScreen')?.classList.remove('hidden');
  $('#appScreen')?.classList.add('hidden');
  $('#bottomNav')?.classList.add('hidden');
}

// ── Navigation ────────────────────────────────────
const setText = (q, v) => { const el = $(q); if (el) el.textContent = v; };
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id)?.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  if (id !== 'ai') window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'home') requestAnimationFrame(renderChartHome);
  if (id === 'finance') requestAnimationFrame(renderChartFin);
}

// ── Finance utils ─────────────────────────────────
const monthFin = (ym = monthYM()) => state.finances.filter(f => String(f.date || '').startsWith(ym));
function summary(arr) {
  const inc = arr.filter(f => f.type === 'income').reduce((s, f) => s + +f.value, 0);
  const exp = arr.filter(f => f.type === 'expense').reduce((s, f) => s + +f.value, 0);
  return { inc, exp, bal: inc - exp };
}

// ── Render All ────────────────────────────────────
function renderAll() { renderHome(); renderTasks(); renderFinance(); renderHabits(); renderFocus(); renderChat(); }

function renderHome() {
  const open = state.tasks.filter(t => !t.done).length;
  const doneH = state.habits.filter(h => h.checked).length;
  const pct = state.habits.length ? Math.round(doneH / state.habits.length * 100) : 0;
  const m = summary(monthFin());

  // Greeting
  const h = new Date().getHours();
  const g = h < 12 ? 'Bom dia ☀️' : h < 18 ? 'Boa tarde 🌤' : 'Boa noite 🌙';
  setText('#greeting', g);
  setText('#syncStatus', firebaseReady && currentUser && !demoMode ? '☁ Firebase sincronizado' : '💾 Modo local');

  setText('#statTasks', open);
  setText('#statTasksSub', `${state.tasks.length - open} feitas`);
  setText('#statHabits', `${pct}%`);
  setText('#statMoney', fmtShort(m.bal));
  setText('#missionText', buildMission(m, open));

  // Avatar
  const av = $('#profileBtn');
  if (av) av.textContent = currentUser?.email ? currentUser.email.slice(0, 2).toUpperCase() : 'IA';

  renderInsights(m, open);
}

function buildMission(m, open) {
  const high = state.tasks.filter(t => !t.done && t.priority === 'high').length;
  const daysNoFin = daysSinceLastFinance();
  if (high > 0) return `Você tem ${high} tarefa${high > 1 ? 's' : ''} urgente${high > 1 ? 's' : ''} em aberto. Resolva pelo menos uma antes de iniciar atividades secundárias.`;
  if (daysNoFin > 2) return `Sem lançamentos financeiros há ${daysNoFin} dias. Registre as entradas e saídas de hoje para manter o controle.`;
  if (m.bal < 0) return `Mês negativo em ${fmt(Math.abs(m.bal))}. Corte uma despesa não essencial e busque uma nova receita.`;
  if (open === 0) return 'Todas as tarefas concluídas! Ótimo momento para planejar os próximos passos.';
  return `${open} tarefa${open > 1 ? 's' : ''} pendente${open > 1 ? 's' : ''}. Abra o Modo Foco para atacar as mais importantes.`;
}

function daysSinceLastFinance() {
  const dates = state.finances.map(f => f.date).filter(Boolean).sort().reverse();
  if (!dates.length) return 999;
  return Math.floor((Date.now() - new Date(dates[0]).getTime()) / 86400000);
}

function renderInsights(m, open) {
  const box = $('#insightList'); if (!box) return;
  const high = state.tasks.filter(t => !t.done && t.priority === 'high').length;
  const items = [];
  if (high) items.push({ c: 'warn', t: `🔴 ${high} tarefa${high > 1 ? 's urgentes' : ' urgente'} — abra o Modo Foco.` });
  if (m.exp > m.inc && m.exp > 0) items.push({ c: 'warn', t: `⚠️ Despesas maiores que receitas este mês: ${fmt(m.bal)}.` });
  if (daysSinceLastFinance() > 2) items.push({ c: 'warn', t: `📅 Sem lançamentos há ${daysSinceLastFinance()} dias.` });
  const allDone = state.habits.length && state.habits.every(h => h.checked);
  if (allDone) items.push({ c: 'good', t: '🎉 Todos os hábitos de hoje concluídos!' });
  if (!items.length) items.push({ c: 'good', t: '✓ Painel estável. Continue registrando tarefas e finanças.' });
  box.innerHTML = items.map(i => `<div class="insight ${i.c}">${esc(i.t)}</div>`).join('');
}

// ── CHARTS ────────────────────────────────────────
const CHART_COLORS = ['#2dd4f5','#3af098','#ff5472','#ffb347','#f0c060','#7ee8ff','#a78bfa'];

function renderChartHome() {
  const canvas = $('#homeChart'); if (!canvas || !window.Chart) return;
  const months = [-5,-4,-3,-2,-1,0].map(i => monthYM(i));
  const labels = months.map(ym => monthLabel(ym));

  const activeTab = $('[data-spark].active')?.dataset.spark || 'balance';
  const data = months.map(ym => {
    const s = summary(monthFin(ym));
    return activeTab === 'balance' ? s.bal : activeTab === 'income' ? s.inc : s.exp;
  });
  const color = activeTab === 'balance' ? '#2dd4f5' : activeTab === 'income' ? '#3af098' : '#ff5472';

  if (chartHome) { chartHome.data.labels = labels; chartHome.data.datasets[0].data = data; chartHome.data.datasets[0].borderColor = color; chartHome.data.datasets[0].backgroundColor = color + '14'; chartHome.update('none'); return; }

  chartHome = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '14', tension: .45, fill: true, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.y) } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#5d8898', font: { size: 10, family: 'DM Sans' } } },
        y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#5d8898', font: { size: 10 }, callback: v => fmtShort(v) } }
      }
    }
  });
}

function renderChartFin() {
  const canvas = $('#financeChart'); if (!canvas || !window.Chart) return;
  const arr = monthFin();
  const byArea = {};
  arr.filter(f => f.type === 'expense').forEach(f => { byArea[f.area || 'Outros'] = (byArea[f.area || 'Outros'] || 0) + +f.value; });
  const labels = Object.keys(byArea), data = Object.values(byArea);

  const legend = $('#financeChartLegend');
  if (!labels.length) {
    canvas.parentElement.style.display = 'none';
    if (legend) legend.innerHTML = '<span style="font-size:11px;color:var(--sub)">Sem despesas este mês</span>';
    return;
  }
  canvas.parentElement.style.display = '';

  if (chartFin) { chartFin.data.labels = labels; chartFin.data.datasets[0].data = data; chartFin.update('none'); }
  else {
    chartFin = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } } } }
    });
  }
  if (legend) legend.innerHTML = labels.map((l, i) => `<div class="donut-item"><span class="donut-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span><span>${esc(l)}</span></div>`).join('');
}

// ── TASKS ─────────────────────────────────────────
function renderTasks(filter = taskFilter) {
  taskFilter = filter;
  const list = $('#taskList'); if (!list) return;
  let arr = [...state.tasks];
  if (filter === 'open') arr = arr.filter(t => !t.done);
  if (filter === 'high') arr = arr.filter(t => t.priority === 'high' && !t.done);
  if (filter === 'today') arr = arr.filter(t => t.due === today() && !t.done);
  if (filter === 'done') arr = arr.filter(t => t.done);
  const open = state.tasks.filter(t => !t.done).length;
  setText('#taskCountLabel', `${open} pendente${open !== 1 ? 's' : ''}`);
  if (!arr.length) { list.innerHTML = '<div class="item-card"><div class="item-main"><p style="color:var(--sub);font-size:13px">Nenhuma tarefa aqui.</p></div></div>'; return; }
  list.innerHTML = arr.map(t => taskHTML(t)).join('');
}

function prioClass(p) { return { high: 'high', medium: 'med', low: 'low' }[p] || 'low'; }
function prioLabel(p) { return { high: 'Alta', medium: 'Média', low: 'Baixa' }[p] || '—'; }

function taskHTML(t) {
  const tags = (t.tags || []).filter(Boolean).map(g => `<span class="tag">#${esc(g)}</span>`).join('');
  const subTotal = (t.subtasks || []).length, subDone = (t.subtasks || []).filter(s => s.done).length;
  const subInfo = subTotal ? ` · ${subDone}/${subTotal} sub` : '';
  const subtasksHTML = subTotal ? `<div class="subtask-list">${(t.subtasks || []).map(s => `
    <div class="subtask-row">
      <input type="checkbox" data-sub-task="${t.id}" data-sub-id="${s.id}" ${s.done ? 'checked' : ''}>
      <span style="${s.done ? 'text-decoration:line-through;opacity:.45' : ''}">${esc(s.title)}</span>
    </div>`).join('')}</div>` : '';
  return `<div class="item-card${t.done ? ' item-done' : ''}">
    <div class="item-main">
      <div class="item-ico ${t.done ? 'green' : ''}">☑</div>
      <div class="item-body">
        <label class="checkline"><input type="checkbox" data-toggle-task="${t.id}" ${t.done ? 'checked' : ''}><h4>${esc(t.title)}</h4></label>
        <p>${esc(t.area || 'Sem área')}${t.due ? ' · 📅' + esc(t.due) : ''}${subInfo}</p>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
      <span class="prio ${prioClass(t.priority)}">${prioLabel(t.priority)}</span>
      <div class="item-actions">
        <button class="act-btn" data-edit="task" data-id="${t.id}" title="Editar">✎</button>
        <button class="act-btn del" data-del="task" data-id="${t.id}" title="Excluir">🗑</button>
      </div>
    </div>${subtasksHTML}</div>`;
}

// ── FINANCE ───────────────────────────────────────
function renderFinance(filter = finFilter) {
  finFilter = filter;
  const list = $('#financeList'); if (!list) return;
  const m = summary(monthFin());
  setText('#financeTotal', fmt(m.bal));
  setText('#incomeTotal', `↑ ${fmt(m.inc)}`);
  setText('#expenseTotal', `↓ ${fmt(m.exp)}`);
  const now = new Date(); setText('#finMonthLabel', now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  renderGoals(m);
  let arr = [...state.finances].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (filter === 'income') arr = arr.filter(f => f.type === 'income');
  if (filter === 'expense') arr = arr.filter(f => f.type === 'expense');
  if (filter === 'recurring') arr = arr.filter(f => f.recurring);
  list.innerHTML = arr.length ? arr.map(f => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-ico ${f.type === 'income' ? 'green' : 'red'}">${f.type === 'income' ? '＋' : '−'}</div>
        <div class="item-body">
          <h4>${esc(f.title)}${f.recurring ? ' <span style="font-size:10px;opacity:.6">🔁</span>' : ''}</h4>
          <p>${esc(f.area || '—')} · ${fmt(f.value)} · ${esc(f.date || '')}</p>
        </div>
        <div class="item-actions">
          <button class="act-btn" data-edit="finance" data-id="${f.id}">✎</button>
          <button class="act-btn del" data-del="finance" data-id="${f.id}">🗑</button>
        </div>
      </div>
    </div>`).join('') : '<div class="item-card"><div class="item-main"><p style="color:var(--sub);font-size:13px">Nenhum lançamento.</p></div></div>';
}

function renderGoals(m) {
  const box = $('#goalsList'); if (!box) return;
  if (!state.goals.length) { box.innerHTML = ''; return; }
  // Auto-update goals from monthly income
  box.innerHTML = state.goals.map(g => {
    const pct = Math.min(100, Math.round((+(g.current || 0) / +(g.target || 1)) * 100));
    return `<div class="goal-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h5>🎯 ${esc(g.title)}</h5>
        <button class="act-btn del" data-del="goal" data-id="${g.id}">🗑</button>
      </div>
      <small>${fmt(g.current || 0)} de ${fmt(g.target)} — ${pct}%</small>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ── HABITS ────────────────────────────────────────
function renderHabits() {
  const list = $('#habitList'); if (!list) return;
  const lbl = $('#habitDateLabel');
  if (lbl) lbl.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  // Overall progress bar
  const doneCount = state.habits.filter(h => h.checked).length, total = state.habits.length;
  const pct = total ? Math.round(doneCount / total * 100) : 0;
  const pw = $('#habitProgressBar');
  if (pw) pw.innerHTML = total ? `<div class="habit-prog-label">${doneCount} de ${total} hábitos — ${pct}%</div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>` : '';

  list.innerHTML = state.habits.length ? state.habits.map(h => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-ico ${h.checked ? 'green' : ''}">◎</div>
        <div class="item-body">
          <label class="checkline"><input type="checkbox" data-toggle-habit="${h.id}" ${h.checked ? 'checked' : ''}><h4>${esc(h.title)}</h4></label>
          <p>${esc(h.area || '')} · 🔥 ${h.streak || 0} dia${h.streak !== 1 ? 's' : ''}</p>
          <div class="habit-cal">${buildCalendar(h)}</div>
        </div>
        <div class="item-actions">
          <button class="act-btn" data-edit="habit" data-id="${h.id}">✎</button>
          <button class="act-btn del" data-del="habit" data-id="${h.id}">🗑</button>
        </div>
      </div>
    </div>`).join('') : '<div class="item-card"><div class="item-main"><p style="color:var(--sub);font-size:13px">Nenhum hábito. Toque em + para criar.</p></div></div>';
}

function buildCalendar(h) {
  const hist = new Set(h.history || []);
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (20 - i));
    return `<div class="hcal-day ${hist.has(d.toISOString().slice(0, 10)) ? 'done' : ''}" title="${d.toISOString().slice(0,10)}"></div>`;
  }).join('');
}

// ── FOCUS ─────────────────────────────────────────
function renderFocus() {
  const list = $('#focusList'); if (!list) return;
  const p = { high: 3, medium: 2, low: 1 };
  const arr = state.tasks.filter(t => !t.done).sort((a, b) => (p[b.priority] || 2) - (p[a.priority] || 2)).slice(0, 3);
  setText('#focusAdvice', arr.length ? 'Resolva na ordem abaixo antes de abrir novas frentes.' : 'Nenhuma tarefa pendente. 🎉');
  list.innerHTML = arr.length ? arr.map((t, i) => `
    <div class="item-card">
      <div class="item-main">
        <div class="focus-num">${i + 1}</div>
        <div class="item-body">
          <h4>${esc(t.title)}</h4>
          <p>${esc(t.area || '')} · ${prioLabel(t.priority)}${t.due ? ' · 📅' + esc(t.due) : ''}</p>
        </div>
        <span class="prio ${prioClass(t.priority)}">${prioLabel(t.priority)}</span>
      </div>
    </div>`).join('') : '<div class="item-card"><div class="item-main"><p style="color:var(--sub);font-size:13px">Tudo em dia! 🎉</p></div></div>';
}

// ── CHAT / AI ─────────────────────────────────────
function addMsg(role, text) { state.chat.push({ role, text, at: new Date().toISOString() }); state.chat = state.chat.slice(-100); saveLocal(); renderChat(); }

function renderChat() {
  const box = $('#chatBox'); if (!box) return;
  const hasKey = !!state.settings.apiKey;
  setText('#aiModelLabel', hasKey ? '✦ Claude Sonnet — ativo' : 'Configure a API key em Configurações');
  if (!state.chat.length) {
    box.innerHTML = `<div class="msg ai">Olá! 👋 Seu assistente pessoal está pronto.\n\n${hasKey ? 'API key configurada — posso responder qualquer pergunta com contexto completo dos seus dados.' : '⚠️ Sem API key — operando em modo local. Configure em Configurações para usar o Claude real.'}\n\nComandos rápidos:\n• "crie uma tarefa X amanhã"\n• "despesa de 35 reais com Y"\n• "receita de 120 reais Z"\n• "analise meu dia"\n• "plano de foco para hoje"</div>`;
    return;
  }
  box.innerHTML = state.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMsg(text, spoken = false) {
  const clean = text.trim(); if (!clean) return;
  const inp = $('#aiInput'); if (inp) inp.value = '';
  addMsg('user', clean);
  const box = $('#chatBox');
  const dot = Object.assign(document.createElement('div'), { className: 'msg ai typing', textContent: '●  ●  ●' });
  box?.appendChild(dot); if (box) box.scrollTop = box.scrollHeight;
  const reply = await runAI(clean);
  dot.remove();
  addMsg('ai', reply);
  if (spoken) speak(reply);
  renderAll();
}

async function runAI(text) {
  const low = text.toLowerCase();
  const val = extractVal(low);

  // ── Local commands ───────────────────────────
  if (/\b(tarefa|lembrete|atividade)\b/.test(low) && /\b(cri|adicion|coloc|cadast)\b/.test(low)) {
    const title = cleanTitle(text, ['criar','crie','adicione','adicionar','uma tarefa','tarefa','lembrete']);
    state.tasks.unshift({ id: uid(), title: title || 'Nova tarefa', area: inferArea(low), priority: low.includes('urgente') || low.includes('alta') ? 'high' : 'medium', done: false, due: inferDate(low), notes: 'Criada por IA.', tags: [], subtasks: [] });
    await saveCloud(); return `✅ Tarefa criada: "${title || 'Nova tarefa'}"${inferDate(low) ? '\n📅 Prazo: ' + inferDate(low) : ''}`;
  }
  if (/\b(despesa|gasto|paguei|compra|comprei)\b/.test(low)) {
    const title = cleanTitle(text, ['registrar','registre','lançar','lance','adicionar','adicione','despesa','gasto','paguei','compra','comprei']);
    state.finances.unshift({ id: uid(), type: 'expense', title: title || 'Despesa', area: inferArea(low), value: val ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💸 Despesa registrada: ${fmt(val ?? 0)} — "${title || 'Despesa'}"`;
  }
  if (/\b(receita|venda|recebi|entrada|faturei)\b/.test(low)) {
    const title = cleanTitle(text, ['registrar','registre','lançar','lance','adicionar','adicione','receita','venda','recebi','entrada']);
    state.finances.unshift({ id: uid(), type: 'income', title: title || 'Receita', area: inferArea(low), value: val ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💰 Receita registrada: ${fmt(val ?? 0)} — "${title || 'Receita'}"`;
  }
  if (/\b(meta|objetivo|poupar|economizar)\b/.test(low) && val) {
    const title = cleanTitle(text, ['criar','crie','meta','objetivo','poupar','economizar','de','reais']);
    state.goals.push({ id: uid(), title: title || 'Nova meta', target: val, current: 0 });
    await saveCloud(); return `🎯 Meta criada: "${title || 'Nova meta'}" — ${fmt(val)}`;
  }

  // ── Claude API ───────────────────────────────
  if (state.settings.apiKey) return callClaude(text, state.settings.apiKey);
  if (state.settings.aiEndpoint) return callEndpoint(text, state.settings.aiEndpoint);

  // ── Smart local answer ───────────────────────
  return smartAnswer();
}

function buildCtx() {
  const m = summary(monthFin());
  const open = state.tasks.filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  return `Data: ${today()}. Tarefas abertas: ${open.length} (${high.length} urgentes: ${high.slice(0,3).map(t=>t.title).join(', ')}). Finanças do mês: receitas ${fmt(m.inc)}, despesas ${fmt(m.exp)}, saldo ${fmt(m.bal)}. Hábitos hoje: ${state.habits.filter(h=>h.checked).length}/${state.habits.length} feitos. Último lançamento: ${daysSinceLastFinance()} dias atrás.`;
}

async function callClaude(text, key) {
  try {
    const history = state.chat.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    // Ensure it ends with user
    while (history.length && history[history.length - 1].role === 'user') history.pop();
    const messages = [...history, { role: 'user', content: text }];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        system: `Você é um assistente pessoal inteligente integrado ao app do usuário. Responda sempre em português brasileiro de forma direta, prática e útil. Contexto atual: ${buildCtx()}`,
        messages })
    });
    const data = await res.json();
    if (data.error) return `Erro da API Claude: ${data.error.message}\n\nVerifique a API key em Configurações.`;
    return data.content?.[0]?.text || 'Sem resposta.';
  } catch (e) { return `Erro de conexão com Claude: ${e.message}`; }
}

async function callEndpoint(text, endpoint) {
  try { const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, context: buildCtx() }) }); const d = await r.json(); return d.reply || 'Sem resposta do backend.'; }
  catch { return 'Não foi possível acessar o endpoint configurado.'; }
}

function smartAnswer() {
  const m = summary(monthFin());
  const open = state.tasks.filter(t => !t.done);
  const high = open.filter(t => t.priority === 'high');
  const dH = state.habits.filter(h => h.checked).length;
  return `📊 Resumo inteligente:\n\n• Tarefas: ${open.length} abertas, ${high.length} urgentes${high.length ? ':\n  – ' + high.slice(0,3).map(t=>t.title).join('\n  – ') : ''}.\n• Finanças do mês: ↑${fmt(m.inc)} / ↓${fmt(m.exp)} → Saldo ${fmt(m.bal)}.\n• Hábitos: ${dH}/${state.habits.length} concluídos hoje.\n\n💡 ${high.length ? 'Abra o Modo Foco para atacar as tarefas urgentes.' : daysSinceLastFinance() > 1 ? 'Registre os gastos do dia agora.' : 'Tudo em dia! Planeje a próxima ação.'}`;
}

// ── NLP ───────────────────────────────────────────
function extractVal(t) { const m = t.replace(',', '.').match(/(?:r\$\s*)?(\d+(?:\.\d{1,2})?)/); return m ? +m[1] : null; }
function cleanTitle(text, words) {
  let s = text;
  words.forEach(w => { if (w) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '); });
  return s.replace(/\b(de|do|da|com|para|por|reais|real|r\$|\d+[,.]?\d*)\b/ig, ' ').replace(/\s+/g, ' ').trim();
}
function inferArea(t) {
  if (/pudim|pudding|sanja pudding/i.test(t)) return 'Sanja Pudding';
  if (/neon|letreiro|acr[íi]lico/i.test(t)) return 'Neon Sanja';
  return 'Geral';
}
function inferDate(t) {
  const d = new Date();
  if (/amanhã/i.test(t)) { d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); }
  if (/semana que vem|próxima semana/i.test(t)) { d.setDate(d.getDate() + 7); return d.toISOString().slice(0,10); }
  if (/segunda/i.test(t)) return nextWD(1); if (/terça/i.test(t)) return nextWD(2);
  if (/quarta/i.test(t)) return nextWD(3); if (/quinta/i.test(t)) return nextWD(4);
  if (/sexta/i.test(t)) return nextWD(5); if (/sábado/i.test(t)) return nextWD(6);
  if (/final do mês|fim do mês/i.test(t)) return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0,10);
  const dm = t.match(/dia\s+(\d{1,2})/i); if (dm) { const n = new Date(); n.setDate(+dm[1]); return n.toISOString().slice(0,10); }
  return '';
}
const nextWD = wd => { const d = new Date(), diff = (wd + 7 - d.getDay()) % 7 || 7; d.setDate(d.getDate() + diff); return d.toISOString().slice(0,10); };

// ── Voice ─────────────────────────────────────────
function setupVoice() {
  const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#voiceBtn');
  if (!SRClass) { voiceOk = false; if (btn) { btn.classList.add('mic-disabled'); btn.title = 'Voz indisponível — use Chrome Android em HTTPS'; } return; }
  voiceOk = true;
  SR = new SRClass(); SR.lang = 'pt-BR'; SR.continuous = false; SR.interimResults = false;
  SR.onstart = () => { listening = true; btn?.classList.add('recording'); toast('🎙 Ouvindo...'); };
  SR.onend = () => { listening = false; btn?.classList.remove('recording'); };
  SR.onerror = e => { listening = false; btn?.classList.remove('recording'); toast(e.error === 'not-allowed' ? 'Microfone bloqueado. Permita o acesso.' : 'Erro de voz. Tente novamente.'); };
  SR.onresult = ev => { const t = ev.results?.[0]?.[0]?.transcript || ''; const i = $('#aiInput'); if (i) i.value = t; sendMsg(t, true); };
}
function startVoice() { if (!voiceOk) { toast('Voz indisponível. Use Chrome Android em HTTPS.'); return; } listening ? SR.stop() : SR.start(); }
function speak(text) { try { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\n/g, '. ')); u.lang = 'pt-BR'; u.rate = 1.05; speechSynthesis.speak(u); } catch {} }

// ── Notifications ─────────────────────────────────
async function reqNotif() {
  if (!('Notification' in window)) { toast('Notificações não suportadas.'); return; }
  const p = await Notification.requestPermission();
  state.settings.notifPermission = p; await saveCloud(); updateNotifStatus();
  toast(p === 'granted' ? '🔔 Notificações ativadas!' : 'Permissão não concedida.');
}
function updateNotifStatus() { const el = $('#notifStatus'); if (!el) return; const p = Notification?.permission; el.textContent = p === 'granted' ? 'Ativadas ✓' : p === 'denied' ? 'Bloqueadas pelo usuário' : 'Toque para ativar'; }
function scheduleProactiveNotif() {
  if (Notification?.permission !== 'granted') return;
  setTimeout(() => {
    const high = state.tasks.filter(t => !t.done && t.priority === 'high');
    if (high.length) new Notification('Assistente IA — Urgente', { body: `${high.length} tarefa(s) urgente(s) pendente(s).`, icon: 'icons/icon-192.png' });
    else if (daysSinceLastFinance() > 2) new Notification('Assistente IA — Finanças', { body: `Você não registra finanças há ${daysSinceLastFinance()} dias.`, icon: 'icons/icon-192.png' });
  }, 4000);
}

// ── Exports ───────────────────────────────────────
function exportJSON() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = `backup-ia41-${today()}.json`; a.click(); state.settings.lastBackupNotice = today(); saveLocal(); toast('JSON exportado.');
}
function exportCSV() {
  const rows = [['Tipo','Título','Área','Valor','Data','Fixo']];
  state.finances.forEach(f => rows.push([f.type === 'income' ? 'Receita' : 'Despesa', f.title, f.area || '', f.value, f.date, f.recurring ? 'Sim' : 'Não']));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `financas-${today()}.csv`; a.click(); toast('CSV exportado.');
}

// ── Search ────────────────────────────────────────
function runSearch(q) {
  const box = $('#searchResults'); if (!box) return;
  const query = q.trim().toLowerCase(); if (!query) { box.classList.add('hidden'); return; }
  const results = [];
  state.tasks.filter(t => t.title.toLowerCase().includes(query) || (t.area || '').toLowerCase().includes(query)).forEach(t => results.push({ type: 'Tarefa', title: t.title, sub: t.area || '', screen: 'tasks' }));
  state.finances.filter(f => f.title.toLowerCase().includes(query) || (f.area || '').toLowerCase().includes(query)).forEach(f => results.push({ type: f.type === 'income' ? 'Receita' : 'Despesa', title: f.title, sub: fmt(f.value) + ' · ' + f.date, screen: 'finance' }));
  state.habits.filter(h => h.title.toLowerCase().includes(query)).forEach(h => results.push({ type: 'Hábito', title: h.title, sub: h.area || '', screen: 'habits' }));
  box.classList.toggle('hidden', !results.length);
  box.innerHTML = results.slice(0, 8).map(r => `<div class="search-result-item" data-open="${r.screen}"><div class="sr-type">${esc(r.type)}</div><strong>${esc(r.title)}</strong> <span style="color:var(--sub);font-size:11px">— ${esc(r.sub)}</span></div>`).join('');
}

// ── Settings ──────────────────────────────────────
function updateSettingsUI() {
  const ak = $('#apiKeyInput'); if (ak) ak.value = state.settings.apiKey || '';
  const ep = $('#aiEndpointInput'); if (ep) ep.value = state.settings.aiEndpoint || '';
  applyTheme(state.settings.theme); updateNotifStatus();
}
async function saveApiKey() { state.settings.apiKey = ($('#apiKeyInput')?.value || '').trim(); await saveCloud(); toast(state.settings.apiKey ? '🧠 API key salva! Claude ativo.' : 'API key removida.'); renderChat(); }
async function saveEndpoint() { state.settings.aiEndpoint = ($('#aiEndpointInput')?.value || '').trim(); await saveCloud(); toast('Endpoint salvo.'); }

// ── Modal ─────────────────────────────────────────
const arrOf = type => type === 'task' ? state.tasks : type === 'finance' ? state.finances : type === 'habit' ? state.habits : state.goals;
const findObj = (type, id) => arrOf(type).find(x => x.id === id);

function openModal(type, id = null) {
  const obj = id ? findObj(type, id) : null;
  const titles = { task: 'tarefa', finance: 'lançamento', habit: 'hábito', goal: 'meta' };
  $('#modalTitle').textContent = (id ? 'Editar ' : 'Adicionar ') + (titles[type] || 'item');
  $('#modalBody').innerHTML = { task: formTask, finance: formFinance, habit: formHabit, goal: formGoal }[type]?.(obj) || '';
  $('#modalBody').innerHTML += `<div class="modal-actions"><button id="modalSave" class="btn primary">Salvar</button><button id="modalCancel" class="btn outline">Cancelar</button></div>`;
  if (obj?.priority) { const el = $('#mPriority'); if (el) el.value = obj.priority; }
  if (obj?.type) { const el = $('#mType'); if (el) el.value = obj.type; }
  $('#modalSave').onclick = async () => { await saveModal(type, id); closeModal(); };
  $('#modalCancel').onclick = closeModal;
  $('#modal').classList.remove('hidden');
}
const closeModal = () => $('#modal')?.classList.add('hidden');

const L = (label, id, html, extra = '') => `<label class="form-label" for="${id}">${label}</label>${extra}${html}`;
function formTask(o = {}) { return `
  ${L('Título','mTitle', `<input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: ligar para cliente">`)}
  ${L('Área/negócio','mArea', `<input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Neon Sanja, Sanja Pudding...">`)}
  ${L('Prioridade','mPriority', `<select id="mPriority"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Alta</option></select>`)}
  ${L('Prazo','mDue', `<input id="mDue" class="input" type="date" value="${esc(o?.due||'')}">`)}
  ${L('Tags (vírgula)','mTags', `<input id="mTags" class="input" value="${esc((o?.tags||[]).join(', '))}" placeholder="marketing, urgente">`)}
  ${L('Subtarefas (1 por linha)','mSubs', `<textarea id="mSubs" placeholder="Etapa 1&#10;Etapa 2">${(o?.subtasks||[]).map(s=>s.title).join('\n')}</textarea>`)}
  ${L('Observações','mNotes', `<textarea id="mNotes" placeholder="Detalhes">${esc(o?.notes||'')}</textarea>`)}
`; }
function formFinance(o = {}) { return `
  ${L('Tipo','mType', `<select id="mType"><option value="income">Receita</option><option value="expense">Despesa</option></select>`)}
  ${L('Descrição','mTitle', `<input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: venda de pudim">`)}
  ${L('Categoria','mArea', `<input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Sanja Pudding...">`)}
  ${L('Valor','mValue', `<input id="mValue" class="input" type="number" step="0.01" value="${esc(o?.value||'')}" placeholder="0,00">`)}
  ${L('Data','mDate', `<input id="mDate" class="input" type="date" value="${esc(o?.date||today())}">`)}
  <label class="form-label" style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;margin:12px 0 6px;letter-spacing:0"><input type="checkbox" id="mRecurring" ${o?.recurring?'checked':''}> Fixo mensal (recorrente)</label>
  ${L('Observações','mNotes', `<textarea id="mNotes" placeholder="Detalhes">${esc(o?.notes||'')}</textarea>`)}
`; }
function formHabit(o = {}) { return `
  ${L('Hábito','mTitle', `<input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: prospectar clientes">`)}
  ${L('Área','mArea', `<input id="mArea" class="input" value="${esc(o?.area||'')}" placeholder="Pessoal, negócios...">`)}
  ${L('Sequência atual','mStreak', `<input id="mStreak" class="input" type="number" value="${+(o?.streak||0)}">`)}
`; }
function formGoal(o = {}) { return `
  ${L('Título da meta','mTitle', `<input id="mTitle" class="input" value="${esc(o?.title||'')}" placeholder="Ex: reserva de emergência">`)}
  ${L('Valor alvo (R$)','mTarget', `<input id="mTarget" class="input" type="number" step="0.01" value="${esc(o?.target||'')}" placeholder="5000,00">`)}
  ${L('Valor atual (R$)','mCurrent', `<input id="mCurrent" class="input" type="number" step="0.01" value="${esc(o?.current||'')}" placeholder="0,00">`)}
`; }

function upsert(arr, item, id) { const i = arr.findIndex(x => x.id === id); i >= 0 ? (arr[i] = item) : arr.unshift(item); }

async function saveModal(type, id) {
  if (type === 'task') {
    const tags = ($('#mTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
    const subLines = ($('#mSubs')?.value||'').split('\n').map(t=>t.trim()).filter(Boolean);
    const existing = findObj(type,id)?.subtasks||[];
    const subtasks = subLines.map(t => existing.find(s=>s.title===t) || { id: uid(), title: t, done: false });
    upsert(state.tasks, { id:id||uid(), title:$('#mTitle').value.trim()||'Sem título', area:$('#mArea').value.trim(), priority:$('#mPriority').value, due:$('#mDue').value, notes:$('#mNotes').value, done:findObj(type,id)?.done||false, tags, subtasks }, id);
  }
  if (type === 'finance') upsert(state.finances, { id:id||uid(), type:$('#mType').value, title:$('#mTitle').value.trim()||'Sem descrição', area:$('#mArea').value.trim(), value:+($('#mValue').value||0), date:$('#mDate').value||today(), notes:$('#mNotes').value, recurring:$('#mRecurring')?.checked||false, recurringParent:null }, id);
  if (type === 'habit') { const ex = findObj(type,id); upsert(state.habits, { id:id||uid(), title:$('#mTitle').value.trim()||'Sem título', area:$('#mArea').value.trim(), streak:+($('#mStreak').value||0), checked:ex?.checked||false, lastCheckedDate:ex?.lastCheckedDate||'', history:ex?.history||[] }, id); }
  if (type === 'goal') upsert(state.goals, { id:id||uid(), title:$('#mTitle').value.trim()||'Meta', target:+($('#mTarget').value||0), current:+($('#mCurrent').value||0) }, id);
  await saveCloud(); renderAll(); toast('Salvo!');
}

async function remove(type, id) {
  if (!confirm('Excluir este item?')) return;
  const arr = arrOf(type), i = arr.findIndex(x => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  await saveCloud(); renderAll(); toast('Excluído.');
}

// ── Event binding ─────────────────────────────────
function bind() {
  // Auth
  $('#loginBtn')?.addEventListener('click', doLogin);
  $('#registerBtn')?.addEventListener('click', doRegister);
  $('#googleBtn')?.addEventListener('click', doGoogle);
  $('#demoBtn')?.addEventListener('click', async () => { demoMode = true; currentUser = null; await enterApp(); toast('Modo demonstração ativo.'); });
  $('#logoutBtn')?.addEventListener('click', exitApp);

  // Onboarding
  $('#obNext')?.addEventListener('click', obNext);
  $('#obSkip')?.addEventListener('click', finishOb);

  // Modal
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // AI
  $('#sendAiBtn')?.addEventListener('click', () => sendMsg($('#aiInput')?.value || ''));
  $('#aiInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg($('#aiInput')?.value || ''); } });
  $('#voiceBtn')?.addEventListener('click', startVoice);
  $('#clearChatBtn')?.addEventListener('click', async () => { if (!confirm('Limpar chat?')) return; state.chat = []; await saveCloud(); renderChat(); });

  // Search
  $('#searchToggleBtn')?.addEventListener('click', () => { const bar = $('#searchBar'), res = $('#searchResults'); bar.classList.toggle('hidden'); if (!bar.classList.contains('hidden')) { $('#searchInput')?.focus(); } else { res?.classList.add('hidden'); } });
  $('#searchClose')?.addEventListener('click', () => { $('#searchBar')?.classList.add('hidden'); $('#searchResults')?.classList.add('hidden'); });
  $('#searchInput')?.addEventListener('input', e => runSearch(e.target.value));

  // Settings
  $('#saveApiKeyBtn')?.addEventListener('click', saveApiKey);
  $('#saveEndpointBtn')?.addEventListener('click', saveEndpoint);
  $('#themeBtn')?.addEventListener('click', () => { state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light'; applyTheme(state.settings.theme); saveCloud(); });
  $('#notifPermBtn')?.addEventListener('click', reqNotif);
  $('#syncBtn')?.addEventListener('click', async () => { await saveCloud(); toast(firebaseReady && currentUser && !demoMode ? '☁ Sincronizado!' : '💾 Salvo localmente.'); });
  $('#exportBtn')?.addEventListener('click', exportJSON);
  $('#exportCsvBtn')?.addEventListener('click', exportCSV);
  $('#importInput')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { try { normalize(JSON.parse(r.result)); await saveCloud(); renderAll(); updateSettingsUI(); toast('Backup importado!'); } catch { toast('Arquivo inválido.'); } }; r.readAsText(f); });
  $('#resetBtn')?.addEventListener('click', async () => { if (!confirm('Apagar todos os dados? Sem retorno!')) return; state = makeDefault(); await saveCloud(); renderAll(); updateSettingsUI(); toast('Dados apagados.'); });
  $('#refreshInsightsBtn')?.addEventListener('click', () => { renderInsights(summary(monthFin()), state.tasks.filter(t=>!t.done).length); toast('Insights atualizados.'); });
  $('#notifyBtn')?.addEventListener('click', reqNotif);

  // Spark tabs
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-spark]');
    if (el) { $$('[data-spark]').forEach(b => b.classList.toggle('active', b === el)); renderChartHome(); return; }

    const b = e.target.closest('[data-screen],[data-open],[data-home],[data-modal],[data-edit],[data-del],[data-task-filter],[data-finance-filter],[data-prompt]');
    if (!b) return;

    if (b.dataset.screen) showScreen(b.dataset.screen);
    if (b.dataset.open) showScreen(b.dataset.open);
    if (b.dataset.home !== undefined) showScreen('home');
    if (b.dataset.modal) openModal(b.dataset.modal);
    if (b.dataset.edit) openModal(b.dataset.edit, b.dataset.id);
    if (b.dataset.del) await remove(b.dataset.del, b.dataset.id);
    if (b.dataset.taskFilter) { taskFilter = b.dataset.taskFilter; $$('.pf[data-task-filter]').forEach(x => x.classList.toggle('active', x === b)); renderTasks(); }
    if (b.dataset.financeFilter) { finFilter = b.dataset.financeFilter; $$('.pf[data-finance-filter]').forEach(x => x.classList.toggle('active', x === b)); renderFinance(); }
    if (b.dataset.prompt) { const i = $('#aiInput'); if (i) i.value = b.dataset.prompt; sendMsg(b.dataset.prompt); showScreen('ai'); }
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
        const t = today(); h.checked = e.target.checked;
        h.lastCheckedDate = e.target.checked ? t : (h.lastCheckedDate || '');
        h.streak = Math.max(0, +(h.streak||0) + (e.target.checked ? 1 : -1));
        if (e.target.checked && !(h.history||[]).includes(t)) h.history = [...(h.history||[]).slice(-90), t];
      }
      await saveCloud(); renderAll();
    }
    if (e.target.dataset.subTask) {
      const task = state.tasks.find(x => x.id === e.target.dataset.subTask);
      const sub = task?.subtasks?.find(s => s.id === e.target.dataset.subId);
      if (sub) sub.done = e.target.checked;
      await saveCloud(); renderTasks();
    }
  });
}

// ── Init ──────────────────────────────────────────
registerSW();
bind();
setupVoice();
initFirebase();
