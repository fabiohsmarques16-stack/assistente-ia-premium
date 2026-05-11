import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── Utilities ─────────────────────────────────────
const $ = q => document.querySelector(q);
const $$ = q => Array.from(document.querySelectorAll(q));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const fmt = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtK = n => { const v = Number(n) || 0; return Math.abs(v) >= 1000 ? 'R$' + (v / 1000).toFixed(1) + 'k' : fmt(v); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymOf = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7); };
const monthLabel = ym => { const [y, m] = ym.split('-'); return new Date(+y, +m-1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); };

// ── Default state ─────────────────────────────────
const makeState = () => ({
  tasks: [
    { id: uid(), title: 'Revisar pedidos Neon Sanja', area: 'Neon Sanja', priority: 'high', done: false, due: '', notes: '', tags: ['neon'], subtasks: [] },
    { id: uid(), title: 'Conferir estoque de pudins', area: 'Sanja Pudding', priority: 'medium', done: false, due: '', notes: '', tags: [], subtasks: [{ id: uid(), title: 'Contar bandejas', done: false }, { id: uid(), title: 'Verificar validades', done: false }] }
  ],
  finances: [
    { id: uid(), type: 'income', title: 'Venda Sanja Pudding', area: 'Sanja Pudding', value: 350, date: today(), notes: '', recurring: false },
    { id: uid(), type: 'expense', title: 'Insumos e embalagens', area: 'Sanja Pudding', value: 120, date: today(), notes: '', recurring: false },
    { id: uid(), type: 'income', title: 'Instalação Neon', area: 'Neon Sanja', value: 480, date: today(), notes: '', recurring: false }
  ],
  habits: [
    { id: uid(), title: 'Planejar o dia', area: 'Pessoal', streak: 5, checked: false, lastCheckedDate: '', history: [] },
    { id: uid(), title: 'Prospectar clientes', area: 'Negócios', streak: 2, checked: false, lastCheckedDate: '', history: [] }
  ],
  goals: [],
  chat: [],
  settings: { apiKey: '', aiEndpoint: '', lastHabitReset: '', onboardingDone: false, theme: 'dark', notifPermission: 'default', lastBackupNotice: '' }
});

let S = makeState(); // global state
let currentUser = null, demoMode = false;
let auth = null, db = null, fbReady = false;
let taskFilter = 'all', finFilter = 'all';
let SR = null, listening = false, voiceOk = false;
let chartHome = null, chartFin = null;
let obIdx = 0;

// ── Toast ──────────────────────────────────────────
const toast = (msg, ms = 4000) => { const el = $('#toast'); el.textContent = msg; el.className = 'toast show'; clearTimeout(window._tt); window._tt = setTimeout(() => el.classList.remove('show'), ms); };

// ── Loader ─────────────────────────────────────────
const hideLoader = () => { const el = $('#pageLoader'); if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 500); } };

// ── Theme ──────────────────────────────────────────
function applyTheme(t = 'dark') {
  document.body.classList.toggle('light', t === 'light');
  const lbl = $('#themeLabel'), ico = $('#themeIcon');
  if (lbl) lbl.textContent = t === 'light' ? 'Claro' : 'Escuro';
  if (ico) ico.textContent = t === 'light' ? '☀️' : '🌙';
}

// ── Storage ────────────────────────────────────────
const sKey = () => currentUser && !demoMode ? `nexus-v50-${currentUser.uid}` : 'nexus-v50-demo';
function normalize(raw) {
  const def = makeState();
  S = { ...def, ...(raw || {}) };
  S.tasks = (S.tasks || []).map(t => ({ tags: [], subtasks: [], ...t }));
  S.finances = (S.finances || []).map(f => ({ recurring: false, recurringParent: null, ...f }));
  S.habits = (S.habits || []).map(h => ({ lastCheckedDate: '', history: [], ...h }));
  S.goals = S.goals || [];
  S.chat = S.chat || [];
  S.settings = { ...def.settings, ...(S.settings || {}) };
}
const saveLocal = () => { try { localStorage.setItem(sKey(), JSON.stringify(S)); } catch {} };
const loadLocal = () => { try { normalize(JSON.parse(localStorage.getItem(sKey()))); } catch { normalize(null); } };
async function saveCloud() {
  saveLocal();
  if (fbReady && currentUser && !demoMode) try { await setDoc(doc(db, 'users', currentUser.uid), { data: S, ts: Date.now() }, { merge: true }); } catch {}
}
async function loadCloud() {
  loadLocal();
  if (fbReady && currentUser && !demoMode) try { const s = await getDoc(doc(db, 'users', currentUser.uid)); if (s.exists() && s.data()?.data) normalize(s.data().data); else await saveCloud(); } catch {}
}

// ── Service Worker ─────────────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

// ── Daily Reset ────────────────────────────────────
function dailyReset() {
  const t = today();
  if (S.settings.lastHabitReset === t) return false;
  let r = false;
  S.habits = S.habits.map(h => { if (h.checked && h.lastCheckedDate && h.lastCheckedDate !== t) { r = true; return { ...h, checked: false }; } return h; });
  S.settings.lastHabitReset = t;
  // Recurring finances
  const ym = ymOf();
  S.finances.filter(f => f.recurring).forEach(f => {
    if (!S.finances.some(x => x.recurringParent === f.id && String(x.date || '').startsWith(ym)) && !String(f.date || '').startsWith(ym))
      S.finances.push({ ...f, id: uid(), date: `${ym}-${String(f.date || today()).slice(8) || '01'}`, recurringParent: f.id, recurring: false });
  });
  return r;
}

// ── Firebase ───────────────────────────────────────
async function initFb() {
  try {
    if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.includes('SUA_')) throw new Error('no config');
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app); db = getFirestore(app); fbReady = true;
    onAuthStateChanged(auth, async u => { if (u) { currentUser = u; demoMode = false; await enterApp(); } else hideLoader(); });
  } catch { fbReady = false; hideLoader(); showLogin(); }
}

const validateAuth = () => { const e = ($('#email')?.value || '').trim(), p = $('#password')?.value || ''; if (!e.includes('@')) throw new Error('E-mail inválido.'); if (p.length < 6) throw new Error('Senha: mínimo 6 caracteres.'); return { e, p }; };
async function doLogin() { try { const { e, p } = validateAuth(); if (!fbReady) throw new Error('Firebase não configurado. Use modo demonstração.'); await signInWithEmailAndPassword(auth, e, p); } catch (err) { toast(fbMsg(err)); } }
async function doRegister() { try { const { e, p } = validateAuth(); if (!fbReady) throw new Error('Firebase não configurado.'); await createUserWithEmailAndPassword(auth, e, p); } catch (err) { toast(fbMsg(err)); } }
async function doGoogle() { if (!fbReady) { toast('Firebase não configurado.'); return; } try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (err) { toast(fbMsg(err)); } }
const fbMsg = e => { const c = e?.code || ''; return c.includes('email-already') ? 'E-mail já cadastrado.' : c.includes('wrong-password') || c.includes('invalid-credential') ? 'E-mail ou senha incorretos.' : c.includes('user-not-found') ? 'Conta não encontrada.' : c.includes('popup-closed') ? 'Login cancelado.' : e?.message || 'Erro inesperado.'; };

// ── Screens ────────────────────────────────────────
const showLogin = () => { $('#loginScreen')?.classList.remove('hidden'); };
function showOnboarding() { $('#loginScreen')?.classList.add('hidden'); $('#onboardingScreen')?.classList.remove('hidden'); goSlide(0); }
const goSlide = i => { obIdx = i; $$('.ob-slide').forEach((s, j) => s.classList.toggle('active', j === i)); $$('.ob-dot').forEach((d, j) => d.classList.toggle('active', j === i)); if ($('#obNext')) $('#obNext').textContent = i === 3 ? 'Começar ✦' : 'Próximo'; };
const obNext = () => obIdx < 3 ? goSlide(obIdx + 1) : finishOb();
function finishOb() { S.settings.onboardingDone = true; saveLocal(); launchApp(); }

async function enterApp() {
  await loadCloud();
  const r = dailyReset(); if (r) { await saveCloud(); toast('🌅 Novo dia! Hábitos resetados.'); }
  applyTheme(S.settings.theme);
  updateSettingsUI();
  if (!S.settings.onboardingDone) { showOnboarding(); hideLoader(); return; }
  launchApp();
}
function launchApp() {
  $('#loginScreen')?.classList.add('hidden'); $('#onboardingScreen')?.classList.add('hidden');
  $('#appScreen')?.classList.remove('hidden'); $('#bottomNav')?.classList.remove('hidden');
  hideLoader(); showScreen('home'); renderAll(); scheduleNotif();
}
async function doLogout() { try { if (auth) await signOut(auth); } catch {} currentUser = null; demoMode = false; $('#appScreen')?.classList.add('hidden'); $('#bottomNav')?.classList.add('hidden'); showLogin(); }

// ── Navigation ─────────────────────────────────────
const setText = (q, v) => { const el = $(q); if (el) el.textContent = v; };
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const sc = $('#' + id); if (sc) sc.classList.add('active');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  if (id !== 'ai') window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'home') requestAnimationFrame(renderChartHome);
  if (id === 'finance') requestAnimationFrame(renderChartFin);
}

// ── Finance helpers ────────────────────────────────
const mFin = (ym = ymOf()) => S.finances.filter(f => String(f.date || '').startsWith(ym));
const summary = arr => { const i = arr.filter(f => f.type === 'income').reduce((s, f) => s + +f.value, 0); const e = arr.filter(f => f.type === 'expense').reduce((s, f) => s + +f.value, 0); return { inc: i, exp: e, bal: i - e }; };
const daysSinceLastFin = () => { const d = S.finances.map(f => f.date).filter(Boolean).sort().pop(); return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 999; };

// ── RENDER ─────────────────────────────────────────
function renderAll() { renderHome(); renderTasks(); renderFinance(); renderHabits(); renderFocus(); renderChat(); }

function renderHome() {
  const m = summary(mFin());
  const open = S.tasks.filter(t => !t.done).length;
  const urgent = S.tasks.filter(t => !t.done && t.priority === 'high').length;
  const doneH = S.habits.filter(h => h.checked).length;
  const pct = S.habits.length ? Math.round(doneH / S.habits.length * 100) : 0;

  // Header
  const h = new Date().getHours();
  setText('#greeting', h < 12 ? 'Bom dia ☀️' : h < 18 ? 'Boa tarde 🌤' : 'Boa noite 🌙');
  setText('#syncStatus', fbReady && currentUser && !demoMode ? '☁ Sincronizado' : '💾 Modo local');
  const av = $('#profileBtn'); if (av) av.textContent = currentUser?.email?.slice(0, 2).toUpperCase() || 'N';

  // Balance hero
  setText('#balAmount', fmt(m.bal));
  setText('#balIncome', fmt(m.inc));
  setText('#balExpense', fmt(m.exp));

  // Quick stats
  setText('#qsTasks', open);
  setText('#qsHabits', `${pct}%`);
  setText('#qsFocus', urgent);

  // Mission
  setText('#missionText', buildMission(m, open, urgent));

  // Recent tx
  const rtx = $('#recentTx');
  if (rtx) {
    const recent = [...S.finances].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    rtx.innerHTML = recent.length ? recent.map(f => `
      <div class="tx-item">
        <div class="tx-ico ${f.type === 'income' ? 'in' : 'out'}">${f.type === 'income' ? '＋' : '−'}</div>
        <div class="tx-body"><p class="tx-title">${esc(f.title)}</p><p class="tx-sub">${esc(f.area || '—')} · ${esc(f.date || '')}</p></div>
        <span class="tx-val ${f.type === 'income' ? 'pos' : 'neg'}">${f.type === 'income' ? '+' : '-'}${fmt(f.value)}</span>
      </div>`).join('') : '<p style="font-size:13px;color:var(--text3);padding:12px 0">Nenhuma movimentação.</p>';
  }

  // Module sub labels
  setText('#mcTasks', `${open} pendente${open !== 1 ? 's' : ''}`);
  setText('#mcFinance', fmtK(m.bal));
  setText('#mcHabits', `${doneH}/${S.habits.length} hoje`);

  renderInsights(m, open, urgent);
}

function buildMission(m, open, urgent) {
  const dsf = daysSinceLastFin();
  if (urgent > 0) return `Você tem ${urgent} tarefa${urgent > 1 ? 's urgentes' : ' urgente'} em aberto. Abra o Modo Foco e resolva antes de tudo.`;
  if (dsf > 2) return `Sem lançamentos financeiros há ${dsf} dias. Registre as movimentações de hoje para manter o controle.`;
  if (m.bal < 0) return `Saldo negativo em ${fmt(Math.abs(m.bal))}. Corte despesas não essenciais e busque novas receitas.`;
  if (open === 0) return 'Todas as tarefas concluídas! Ótimo momento para planejar os próximos passos.';
  return `${open} tarefa${open > 1 ? 's' : ''} pendente${open > 1 ? 's' : ''}. Foque nas mais importantes e mantenha os hábitos em dia.`;
}

function renderInsights(m, open, urgent) {
  const box = $('#insightList'); if (!box) return;
  const dsf = daysSinceLastFin();
  const allH = S.habits.length && S.habits.every(h => h.checked);
  const items = [];
  if (urgent) items.push({ c: 'alert', t: `🔴 ${urgent} tarefa${urgent > 1 ? 's urgentes' : ' urgente'} — abra o Modo Foco.` });
  if (m.exp > m.inc && m.exp > 0) items.push({ c: 'warn', t: `⚠️ Despesas maiores que receitas: ${fmt(m.bal)}.` });
  if (dsf > 2) items.push({ c: 'warn', t: `📅 Sem lançamentos há ${dsf} dias.` });
  if (allH) items.push({ c: 'good', t: '🎉 Todos os hábitos de hoje concluídos!' });
  if (!items.length) items.push({ c: 'good', t: '✓ Nenhum alerta crítico. Painel estável.' });
  box.innerHTML = items.map(i => `<div class="insight-item ${i.c}">${esc(i.t)}</div>`).join('');
}

// ── CHARTS ─────────────────────────────────────────
const COLORS = ['#7c5cfc','#22d3a0','#f4526a','#f59e0b','#3b82f6','#a78bfa','#34d399'];

function renderChartHome() {
  const canvas = $('#homeChart'); if (!canvas || !window.Chart) return;
  const months = [-5,-4,-3,-2,-1,0].map(i => ymOf(i));
  const labels = months.map(ym => monthLabel(ym));
  const tab = $('[data-spark].active')?.dataset.spark || 'balance';
  const data = months.map(ym => { const s = summary(mFin(ym)); return tab === 'balance' ? s.bal : tab === 'income' ? s.inc : s.exp; });
  const color = tab === 'balance' ? '#7c5cfc' : tab === 'income' ? '#22d3a0' : '#f4526a';
  if (chartHome) { chartHome.data.labels = labels; chartHome.data.datasets[0].data = data; chartHome.data.datasets[0].borderColor = color; chartHome.data.datasets[0].backgroundColor = color + '18'; chartHome.update('none'); return; }
  chartHome = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '18', tension: .45, fill: true, pointRadius: 4, pointBackgroundColor: color, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.y) }, backgroundColor: '#1a1a28', titleColor: '#9090b0', bodyColor: '#f0f0ff', borderColor: 'rgba(124,92,252,.2)', borderWidth: 1 } }, scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#5a5a80', font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#5a5a80', font: { size: 10 }, callback: v => fmtK(v) } } } }
  });
}

function renderChartFin() {
  const canvas = $('#financeChart'); if (!canvas || !window.Chart) return;
  const byArea = {}; mFin().filter(f => f.type === 'expense').forEach(f => { byArea[f.area || 'Outros'] = (byArea[f.area || 'Outros'] || 0) + +f.value; });
  const labels = Object.keys(byArea), data = Object.values(byArea);
  const legend = $('#finLegend');
  if (!labels.length) { if (legend) legend.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,.3)">Sem despesas</span>'; return; }
  if (chartFin) { chartFin.data.labels = labels; chartFin.data.datasets[0].data = data; chartFin.update('none'); }
  else chartFin = new Chart(canvas, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: COLORS, borderWidth: 0, hoverOffset: 5 }] }, options: { responsive: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` }, backgroundColor: '#1a1a28', bodyColor: '#f0f0ff', borderColor: 'rgba(124,92,252,.2)', borderWidth: 1 } } } });
  if (legend) legend.innerHTML = labels.map((l, i) => `<div class="donut-item"><span class="donut-dot" style="background:${COLORS[i % COLORS.length]}"></span><span>${esc(l)}</span></div>`).join('');
}

// ── TASKS ──────────────────────────────────────────
const prioClass = p => ({ high: 'high', medium: 'med', low: 'low' }[p] || 'low');
const prioLabel = p => ({ high: 'Urgente', medium: 'Média', low: 'Baixa' }[p] || '—');

function renderTasks(f = taskFilter) {
  taskFilter = f;
  const list = $('#taskList'); if (!list) return;
  let arr = [...S.tasks];
  if (f === 'open') arr = arr.filter(t => !t.done);
  if (f === 'high') arr = arr.filter(t => t.priority === 'high' && !t.done);
  if (f === 'today') arr = arr.filter(t => t.due === today() && !t.done);
  if (f === 'done') arr = arr.filter(t => t.done);
  const open = S.tasks.filter(t => !t.done).length;
  setText('#taskCount', `${open} pendente${open !== 1 ? 's' : ''}`);
  list.innerHTML = arr.length ? arr.map(t => {
    const sub = (t.subtasks || []), subD = sub.filter(s => s.done).length;
    const tags = (t.tags || []).filter(Boolean).map(g => `<span class="tag">#${esc(g)}</span>`).join('');
    return `
    <div class="item-card${t.done ? ' item-done' : ''}">
      <div class="item-main">
        <div class="item-ico tasks-icon">☑</div>
        <div class="item-body">
          <label class="checkline"><input type="checkbox" data-toggle-task="${t.id}" ${t.done ? 'checked' : ''}><h4>${esc(t.title)}</h4></label>
          <p>${esc(t.area || '—')}${t.due ? ' · 📅 ' + esc(t.due) : ''}${sub.length ? ` · ${subD}/${sub.length} sub` : ''}</p>
          ${tags ? `<div class="tags">${tags}</div>` : ''}
        </div>
        <span class="prio-badge ${prioClass(t.priority)}">${prioLabel(t.priority)}</span>
        <div class="item-actions">
          <button class="act-btn edit" data-edit="task" data-id="${t.id}" title="Editar">✎</button>
          <button class="act-btn del" data-del="task" data-id="${t.id}" title="Excluir">🗑</button>
        </div>
      </div>
      ${sub.length ? `<div class="subtask-list">${sub.map(s => `<div class="sub-row"><input type="checkbox" data-sub-task="${t.id}" data-sub-id="${s.id}" ${s.done ? 'checked' : ''}><span style="${s.done ? 'text-decoration:line-through;opacity:.4' : ''}">${esc(s.title)}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<p style="font-size:13px;color:var(--text3);padding:14px 0">Nenhuma tarefa aqui.</p>';
}

// ── FINANCE ────────────────────────────────────────
function renderFinance(f = finFilter) {
  finFilter = f;
  const list = $('#financeList'); if (!list) return;
  const m = summary(mFin());
  setText('#finTotal', fmt(m.bal));
  setText('#finIncome', fmt(m.inc));
  setText('#finExpense', fmt(m.exp));
  const now = new Date(); setText('#finMonth', now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  renderGoals(m);
  let arr = [...S.finances].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (f === 'income') arr = arr.filter(x => x.type === 'income');
  if (f === 'expense') arr = arr.filter(x => x.type === 'expense');
  if (f === 'recurring') arr = arr.filter(x => x.recurring);
  list.innerHTML = arr.length ? arr.map(x => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-ico ${x.type === 'income' ? 'habits-icon' : 'focus-icon'}">${x.type === 'income' ? '＋' : '−'}</div>
        <div class="item-body">
          <h4>${esc(x.title)}${x.recurring ? ' <span style="opacity:.5;font-size:11px">🔁</span>' : ''}</h4>
          <p>${esc(x.area || '—')} · ${fmt(x.value)} · ${esc(x.date || '')}</p>
        </div>
        <span class="tx-val ${x.type === 'income' ? 'pos' : 'neg'}" style="flex-shrink:0;font-size:13px">${fmt(x.value)}</span>
        <div class="item-actions">
          <button class="act-btn edit" data-edit="finance" data-id="${x.id}">✎</button>
          <button class="act-btn del" data-del="finance" data-id="${x.id}">🗑</button>
        </div>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:var(--text3);padding:14px 0">Nenhum lançamento.</p>';
}

function renderGoals() {
  const box = $('#goalsList'); if (!box) return;
  if (!S.goals.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div style="display:grid;gap:8px;margin-bottom:14px">' + S.goals.map(g => {
    const pct = Math.min(100, Math.round((+(g.current || 0) / +(g.target || 1)) * 100));
    return `<div class="goal-card">
      <div class="goal-card-head"><h5>🎯 ${esc(g.title)}<button class="act-btn del" data-del="goal" data-id="${g.id}" style="margin-left:8px">🗑</button></h5></div>
      <small>${fmt(g.current || 0)} de ${fmt(g.target)} — ${pct}%</small>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('') + '</div>';
}

// ── HABITS ─────────────────────────────────────────
function renderHabits() {
  const list = $('#habitList'); if (!list) return;
  const lbl = $('#habitDate'); if (lbl) lbl.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  const doneH = S.habits.filter(h => h.checked).length, total = S.habits.length;
  const pw = $('#habitProgress');
  if (pw) pw.innerHTML = total ? `<p class="hp-label">${doneH} de ${total} hábitos hoje — ${Math.round(doneH/total*100)}%</p><div class="prog-bar"><div class="prog-fill" style="width:${Math.round(doneH/total*100)}%"></div></div>` : '';
  list.innerHTML = S.habits.length ? S.habits.map(h => `
    <div class="item-card">
      <div class="item-main">
        <div class="item-ico ${h.checked ? 'habits-icon' : 'tasks-icon'}">◎</div>
        <div class="item-body">
          <label class="checkline"><input type="checkbox" data-toggle-habit="${h.id}" ${h.checked ? 'checked' : ''}><h4>${esc(h.title)}</h4></label>
          <p>${esc(h.area || '')} · 🔥 ${h.streak || 0} dia${h.streak !== 1 ? 's' : ''}</p>
          <div class="habit-cal">${buildCal(h)}</div>
        </div>
        <div class="item-actions">
          <button class="act-btn edit" data-edit="habit" data-id="${h.id}">✎</button>
          <button class="act-btn del" data-del="habit" data-id="${h.id}">🗑</button>
        </div>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:var(--text3);padding:14px 0">Nenhum hábito. Toque em + para criar.</p>';
}
const buildCal = h => { const hs = new Set(h.history || []); return Array.from({length:21},(_,i) => { const d = new Date(); d.setDate(d.getDate()-(20-i)); const k = d.toISOString().slice(0,10); return `<div class="hcal${hs.has(k)?' done':''}" title="${k}"></div>`; }).join(''); };

// ── FOCUS ──────────────────────────────────────────
function renderFocus() {
  const list = $('#focusList'); if (!list) return;
  const p = { high:3, medium:2, low:1 };
  const arr = S.tasks.filter(t => !t.done).sort((a, b) => (p[b.priority]||2)-(p[a.priority]||2)).slice(0,3);
  setText('#focusSub', arr.length ? 'Resolva estas tarefas antes de abrir novas frentes.' : 'Nenhuma tarefa pendente. 🎉');
  list.innerHTML = arr.length ? arr.map((t, i) => `
    <div class="item-card">
      <div class="item-main">
        <div class="focus-num">${i+1}</div>
        <div class="item-body">
          <h4>${esc(t.title)}</h4>
          <p>${esc(t.area || '')} · ${prioLabel(t.priority)}${t.due ? ' · 📅' + esc(t.due) : ''}</p>
        </div>
        <span class="prio-badge ${prioClass(t.priority)}">${prioLabel(t.priority)}</span>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:var(--text3);padding:14px 0">Nenhuma prioridade pendente. 🎉</p>';
}

// ── CHAT / AI ──────────────────────────────────────
const addMsg = (role, text) => { S.chat.push({ role, text, at: new Date().toISOString() }); S.chat = S.chat.slice(-100); saveLocal(); renderChat(); };

function renderChat() {
  const box = $('#chatBox'); if (!box) return;
  const hasKey = !!S.settings.apiKey;
  const statusEl = $('#aiStatus');
  if (statusEl) { statusEl.textContent = hasKey ? 'online' : 'offline'; statusEl.className = 'ai-status ' + (hasKey ? 'online' : 'offline'); }
  if (!S.chat.length) {
    box.innerHTML = `<div class="msg ai">Olá! 👋 Sou o Nexus IA, seu assistente pessoal.\n\n${hasKey ? '✅ Claude ativo — pode me fazer qualquer pergunta com contexto completo dos seus dados.' : '⚙️ Sem API key — operando no modo local. Configure em Configurações → API Key Claude.\n'}\nComandos rápidos:\n• "crie uma tarefa X amanhã"\n• "despesa de 50 reais com X"\n• "receita de 200 reais venda Y"\n• "analise meu dia"\n• "meta de 5000 reais para Z"</div>`;
    return;
  }
  box.innerHTML = S.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMsg(text, spoken = false) {
  const t = text.trim(); if (!t) return;
  const inp = $('#aiInput'); if (inp) inp.value = '';
  addMsg('user', t);
  const box = $('#chatBox');
  const dot = Object.assign(document.createElement('div'), { className: 'msg ai typing', textContent: '● ● ●' });
  box?.appendChild(dot); if (box) box.scrollTop = box.scrollHeight;
  const reply = await runAI(t);
  dot.remove(); addMsg('ai', reply);
  if (spoken) speak(reply);
  renderAll();
}

const extractVal = t => { const m = t.replace(',','.').match(/(?:r\$\s*)?(\d+(?:\.\d{1,2})?)/); return m ? +m[1] : null; };
const cleanTitle = (text, words) => { let s = text; words.forEach(w => w && (s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),' '))); return s.replace(/\b(de|do|da|com|para|por|reais|real|r\$|\d+[,.]?\d*)\b/ig,' ').replace(/\s+/g,' ').trim(); };
const inferArea = t => /pudim|pudding/i.test(t) ? 'Sanja Pudding' : /neon|letreiro/i.test(t) ? 'Neon Sanja' : 'Geral';
const nextWD = wd => { const d = new Date(), diff = (wd+7-d.getDay())%7||7; d.setDate(d.getDate()+diff); return d.toISOString().slice(0,10); };
function inferDate(t) {
  if (/amanhã/i.test(t)) { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
  if (/semana que vem|próxima semana/i.test(t)) { const d = new Date(); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10); }
  if (/segunda/i.test(t)) return nextWD(1); if (/terça/i.test(t)) return nextWD(2);
  if (/quarta/i.test(t)) return nextWD(3); if (/quinta/i.test(t)) return nextWD(4);
  if (/sexta/i.test(t)) return nextWD(5);
  if (/final do mês|fim do mês/i.test(t)) { const d = new Date(); return new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10); }
  const dm = t.match(/dia\s+(\d{1,2})/i); if (dm) { const d = new Date(); d.setDate(+dm[1]); return d.toISOString().slice(0,10); }
  return '';
}

async function runAI(text) {
  const low = text.toLowerCase(), val = extractVal(low);
  // Local commands
  if (/\b(tarefa|lembrete)\b/.test(low) && /\b(cri|adicion|coloc)\b/.test(low)) {
    const title = cleanTitle(text, ['criar','crie','adicione','adicionar','uma tarefa','tarefa','lembrete']);
    S.tasks.unshift({ id: uid(), title: title || 'Nova tarefa', area: inferArea(low), priority: /urgente|alta/.test(low) ? 'high' : 'medium', done: false, due: inferDate(low), notes: 'Criada por IA.', tags: [], subtasks: [] });
    await saveCloud(); return `✅ Tarefa criada: "${title || 'Nova tarefa'}"${inferDate(low) ? '\n📅 Prazo: ' + inferDate(low) : ''}`;
  }
  if (/\b(despesa|gasto|paguei|comprei)\b/.test(low)) {
    const title = cleanTitle(text, ['registrar','registre','adicione','despesa','gasto','paguei','comprei']);
    S.finances.unshift({ id: uid(), type: 'expense', title: title || 'Despesa', area: inferArea(low), value: val ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💸 Despesa de ${fmt(val ?? 0)} registrada: "${title || 'Despesa'}"`;
  }
  if (/\b(receita|venda|recebi|faturei)\b/.test(low)) {
    const title = cleanTitle(text, ['registrar','registre','adicione','receita','venda','recebi','faturei']);
    S.finances.unshift({ id: uid(), type: 'income', title: title || 'Receita', area: inferArea(low), value: val ?? 0, date: today(), notes: 'Criada por IA.', recurring: false });
    await saveCloud(); return `💰 Receita de ${fmt(val ?? 0)} registrada: "${title || 'Receita'}"`;
  }
  if (/\b(meta|poupar|economizar)\b/.test(low) && val) {
    const title = cleanTitle(text, ['criar','crie','meta','poupar','economizar']);
    S.goals.push({ id: uid(), title: title || 'Nova meta', target: val, current: 0 });
    await saveCloud(); return `🎯 Meta criada: "${title || 'Nova meta'}" — ${fmt(val)}`;
  }
  if (S.settings.apiKey) return callClaude(text, S.settings.apiKey);
  if (S.settings.aiEndpoint) return callEndpoint(text, S.settings.aiEndpoint);
  return smartAnswer();
}

const buildCtx = () => { const m = summary(mFin()); const open = S.tasks.filter(t=>!t.done); const high = open.filter(t=>t.priority==='high'); return `Hoje: ${today()}. Tarefas: ${open.length} abertas (${high.length} urgentes: ${high.slice(0,3).map(t=>t.title).join(', ')}). Finanças: receitas ${fmt(m.inc)}, despesas ${fmt(m.exp)}, saldo ${fmt(m.bal)}. Hábitos: ${S.habits.filter(h=>h.checked).length}/${S.habits.length} feitos. Último lançamento: ${daysSinceLastFin()} dias atrás.`; };

async function callClaude(text, key) {
  try {
    const hist = S.chat.slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    const messages = hist.filter((_, i, a) => i === a.length-1 || a[i].role !== a[i+1]?.role);
    if (messages[messages.length-1]?.role !== 'user') messages.push({ role: 'user', content: text });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: `Você é Nexus IA, assistente pessoal inteligente. Responda sempre em português brasileiro, de forma direta e prática. Contexto: ${buildCtx()}`, messages })
    });
    const data = await res.json();
    return data.error ? `Erro: ${data.error.message}` : data.content?.[0]?.text || 'Sem resposta.';
  } catch (e) { return `Erro de conexão: ${e.message}`; }
}

async function callEndpoint(text, ep) { try { const r = await fetch(ep, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: text, context: buildCtx() }) }); const d = await r.json(); return d.reply || 'Sem resposta.'; } catch { return 'Erro ao acessar endpoint.'; } }

function smartAnswer() {
  const m = summary(mFin()); const open = S.tasks.filter(t=>!t.done); const high = open.filter(t=>t.priority==='high'); const dH = S.habits.filter(h=>h.checked).length;
  return `📊 Resumo Nexus:\n\n• Tarefas: ${open.length} abertas, ${high.length} urgentes${high.length ? ':\n  – '+high.slice(0,3).map(t=>t.title).join('\n  – ') : ''}.\n• Finanças: ↑${fmt(m.inc)} / ↓${fmt(m.exp)} → ${fmt(m.bal)}\n• Hábitos: ${dH}/${S.habits.length} hoje.\n\n💡 ${high.length ? 'Prioridade: abra o Modo Foco.' : daysSinceLastFin() > 1 ? 'Registre os gastos do dia.' : 'Tudo em dia! Planeje o próximo passo.'}`;
}

// ── Voice ──────────────────────────────────────────
function setupVoice() {
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#voiceBtn');
  if (!SRC) { voiceOk = false; if (btn) { btn.classList.add('mic-off'); btn.title = 'Voz indisponível — use Chrome Android em HTTPS'; } return; }
  voiceOk = true; SR = new SRC(); SR.lang = 'pt-BR'; SR.continuous = false; SR.interimResults = false;
  SR.onstart = () => { listening = true; btn?.classList.add('recording'); toast('🎙 Ouvindo...'); };
  SR.onend = () => { listening = false; btn?.classList.remove('recording'); };
  SR.onerror = e => { listening = false; btn?.classList.remove('recording'); toast(e.error === 'not-allowed' ? 'Microfone bloqueado.' : 'Erro de voz.'); };
  SR.onresult = ev => { const t = ev.results?.[0]?.[0]?.transcript || ''; const i = $('#aiInput'); if (i) i.value = t; sendMsg(t, true); };
}
const startVoice = () => { if (!voiceOk) { toast('Voz indisponível. Use Chrome Android em HTTPS.'); return; } listening ? SR.stop() : SR.start(); };
const speak = t => { try { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/\n/g,'. ')); u.lang='pt-BR'; u.rate=1.05; speechSynthesis.speak(u); } catch {} };

// ── Notifications ──────────────────────────────────
async function reqNotif() { if (!('Notification' in window)) { toast('Notificações não suportadas.'); return; } const p = await Notification.requestPermission(); S.settings.notifPermission = p; await saveCloud(); updateNotifStatus(); toast(p === 'granted' ? '🔔 Notificações ativadas!' : 'Permissão não concedida.'); }
const updateNotifStatus = () => { const el = $('#notifStatus'); if (!el) return; const p = Notification?.permission; el.textContent = p === 'granted' ? 'Ativadas ✓' : p === 'denied' ? 'Bloqueadas pelo usuário' : 'Toque para ativar'; };
function scheduleNotif() { if (Notification?.permission !== 'granted') return; setTimeout(() => { const h = S.tasks.filter(t=>!t.done&&t.priority==='high'); if (h.length) new Notification('Nexus IA — Urgente',{body:`${h.length} tarefa(s) urgente(s) pendente(s).`,icon:'icons/icon-192.png'}); else if (daysSinceLastFin()>2) new Notification('Nexus IA — Finanças',{body:`Sem lançamentos há ${daysSinceLastFin()} dias.`,icon:'icons/icon-192.png'}); }, 5000); }

// ── Exports ────────────────────────────────────────
const exportJSON = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:'application/json'})); a.download=`nexus-backup-${today()}.json`; a.click(); S.settings.lastBackupNotice=today(); saveLocal(); toast('JSON exportado.'); };
const exportCSV = () => { const rows=[['Tipo','Título','Área','Valor','Data','Fixo']]; S.finances.forEach(f=>rows.push([f.type==='income'?'Receita':'Despesa',f.title,f.area||'',f.value,f.date,f.recurring?'Sim':'Não'])); const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})); a.download=`nexus-financas-${today()}.csv`; a.click(); toast('CSV exportado.'); };

// ── Search ─────────────────────────────────────────
function runSearch(q) {
  const box = $('#searchResults'); if (!box) return;
  const query = q.trim().toLowerCase(); if (!query) { box.classList.add('hidden'); return; }
  const res = [];
  S.tasks.filter(t=>t.title.toLowerCase().includes(query)||(t.area||'').toLowerCase().includes(query)).forEach(t=>res.push({type:'Tarefa',title:t.title,sub:t.area||'',screen:'tasks'}));
  S.finances.filter(f=>f.title.toLowerCase().includes(query)).forEach(f=>res.push({type:f.type==='income'?'Receita':'Despesa',title:f.title,sub:fmt(f.value)+' · '+f.date,screen:'finance'}));
  S.habits.filter(h=>h.title.toLowerCase().includes(query)).forEach(h=>res.push({type:'Hábito',title:h.title,sub:h.area||'',screen:'habits'}));
  box.classList.toggle('hidden',!res.length);
  box.innerHTML = res.slice(0,8).map(r=>`<div class="sr-item" data-open="${r.screen}"><p class="sr-type">${esc(r.type)}</p><p class="sr-title">${esc(r.title)}</p><p class="sr-sub">${esc(r.sub)}</p></div>`).join('');
}

// ── Settings UI ────────────────────────────────────
function updateSettingsUI() { const ak=$('#apiKeyInput'); if(ak) ak.value=S.settings.apiKey||''; const ep=$('#aiEndpointInput'); if(ep) ep.value=S.settings.aiEndpoint||''; applyTheme(S.settings.theme); updateNotifStatus(); }
const saveApiKey = async () => { S.settings.apiKey=($('#apiKeyInput')?.value||'').trim(); await saveCloud(); toast(S.settings.apiKey?'🧠 Claude ativo!':'API key removida.'); renderChat(); };
const saveEndpoint = async () => { S.settings.aiEndpoint=($('#aiEndpointInput')?.value||'').trim(); await saveCloud(); toast('Endpoint salvo.'); };

// ── Modal ──────────────────────────────────────────
const arrOf = type => type==='task'?S.tasks:type==='finance'?S.finances:type==='habit'?S.habits:S.goals;
const findObj = (type, id) => arrOf(type).find(x=>x.id===id);
function openModal(type, id=null) {
  const obj=id?findObj(type,id):null;
  const titles={task:'tarefa',finance:'lançamento',habit:'hábito',goal:'meta'};
  $('#modalTitle').textContent=(id?'Editar ':'Adicionar ')+(titles[type]||'item');
  const forms={task:formTask,finance:formFinance,habit:formHabit,goal:formGoal};
  $('#modalBody').innerHTML=(forms[type]?.(obj)||'')+`<div class="modal-actions"><button id="mSave" class="btn-primary">Salvar</button><button id="mCancel" class="btn-outline">Cancelar</button></div>`;
  if(obj?.priority){const el=$('#mPriority');if(el)el.value=obj.priority;}
  if(obj?.type){const el=$('#mType');if(el)el.value=obj.type;}
  $('#mSave').onclick=async()=>{await saveModal(type,id);closeModal();};
  $('#mCancel').onclick=closeModal;
  $('#modal').classList.remove('hidden');
}
const closeModal = () => $('#modal')?.classList.add('hidden');
const FL = (label, html) => `<label class="form-label">${label}</label>${html}`;
const formTask = (o={}) => `
  ${FL('Título',`<input id="mTitle" class="finput" value="${esc(o?.title||'')}" placeholder="Ex: ligar para cliente">`)}
  ${FL('Área',`<input id="mArea" class="finput" value="${esc(o?.area||'')}" placeholder="Neon Sanja, Sanja Pudding...">`)}
  ${FL('Prioridade',`<select id="mPriority" class="finput"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Urgente</option></select>`)}
  ${FL('Prazo',`<input id="mDue" class="finput" type="date" value="${esc(o?.due||'')}">`)}
  ${FL('Tags (vírgula)',`<input id="mTags" class="finput" value="${esc((o?.tags||[]).join(', '))}" placeholder="marketing, cliente">`)}
  ${FL('Subtarefas (1 por linha)',`<textarea id="mSubs" class="finput" style="height:80px;padding:12px">${(o?.subtasks||[]).map(s=>s.title).join('\n')}</textarea>`)}`;
const formFinance = (o={}) => `
  ${FL('Tipo',`<select id="mType" class="finput"><option value="income">Receita</option><option value="expense">Despesa</option></select>`)}
  ${FL('Descrição',`<input id="mTitle" class="finput" value="${esc(o?.title||'')}" placeholder="Ex: venda de pudim">`)}
  ${FL('Categoria',`<input id="mArea" class="finput" value="${esc(o?.area||'')}" placeholder="Sanja Pudding, Neon Sanja...">`)}
  <div class="form-row">${FL('Valor',`<input id="mValue" class="finput" type="number" step="0.01" value="${esc(o?.value||'')}">`)}${FL('Data',`<input id="mDate" class="finput" type="date" value="${esc(o?.date||today())}">`)}</div>
  <label class="form-check"><input type="checkbox" id="mRecurring" ${o?.recurring?'checked':''}> Fixo mensal (recorrente)</label>`;
const formHabit = (o={}) => `
  ${FL('Hábito',`<input id="mTitle" class="finput" value="${esc(o?.title||'')}" placeholder="Ex: prospectar clientes">`)}
  ${FL('Área',`<input id="mArea" class="finput" value="${esc(o?.area||'')}" placeholder="Pessoal, negócios...">`)}
  ${FL('Sequência atual',`<input id="mStreak" class="finput" type="number" value="${+(o?.streak||0)}">`)}`;
const formGoal = (o={}) => `
  ${FL('Meta',`<input id="mTitle" class="finput" value="${esc(o?.title||'')}" placeholder="Ex: reserva de emergência">`)}
  <div class="form-row">${FL('Valor alvo',`<input id="mTarget" class="finput" type="number" step="0.01" value="${esc(o?.target||'')}">`)+''+FL('Valor atual',`<input id="mCurrent" class="finput" type="number" step="0.01" value="${esc(o?.current||'')}">`)}</div>`;

const upsert = (arr, item, id) => { const i = arr.findIndex(x=>x.id===id); i>=0?(arr[i]=item):arr.unshift(item); };
async function saveModal(type, id) {
  if (type==='task') { const tags=($('#mTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean); const subs=($('#mSubs')?.value||'').split('\n').map(t=>t.trim()).filter(Boolean); const ex=findObj(type,id)?.subtasks||[]; upsert(S.tasks,{id:id||uid(),title:$('#mTitle').value.trim()||'Sem título',area:$('#mArea').value.trim(),priority:$('#mPriority').value,due:$('#mDue').value,notes:'',done:findObj(type,id)?.done||false,tags,subtasks:subs.map(t=>ex.find(s=>s.title===t)||{id:uid(),title:t,done:false})},id); }
  if (type==='finance') upsert(S.finances,{id:id||uid(),type:$('#mType').value,title:$('#mTitle').value.trim()||'Sem desc',area:$('#mArea').value.trim(),value:+($('#mValue').value||0),date:$('#mDate').value||today(),notes:'',recurring:$('#mRecurring')?.checked||false,recurringParent:null},id);
  if (type==='habit') { const ex=findObj(type,id); upsert(S.habits,{id:id||uid(),title:$('#mTitle').value.trim()||'Sem título',area:$('#mArea').value.trim(),streak:+($('#mStreak').value||0),checked:ex?.checked||false,lastCheckedDate:ex?.lastCheckedDate||'',history:ex?.history||[]},id); }
  if (type==='goal') upsert(S.goals,{id:id||uid(),title:$('#mTitle').value.trim()||'Meta',target:+($('#mTarget').value||0),current:+($('#mCurrent').value||0)},id);
  await saveCloud(); renderAll(); toast('Salvo!');
}
async function remove(type, id) { if (!confirm('Excluir este item?')) return; const arr=arrOf(type),i=arr.findIndex(x=>x.id===id); if(i>=0)arr.splice(i,1); await saveCloud(); renderAll(); toast('Excluído.'); }

// ── Bind events ────────────────────────────────────
function bind() {
  // Auth
  $('#loginBtn')?.addEventListener('click', doLogin);
  $('#registerBtn')?.addEventListener('click', doRegister);
  $('#googleBtn')?.addEventListener('click', doGoogle);
  $('#demoBtn')?.addEventListener('click', async () => { demoMode=true; currentUser=null; await enterApp(); toast('Modo demonstração ativo.'); });
  $('#logoutBtn')?.addEventListener('click', doLogout);
  // Password toggle
  $('#togglePass')?.addEventListener('click', () => { const i=$('#password'); if(i){i.type=i.type==='password'?'text':'password';} });
  // Onboarding
  $('#obNext')?.addEventListener('click', obNext);
  $('#obSkip')?.addEventListener('click', finishOb);
  // Modal
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', e => { if(e.target===$('#modal')) closeModal(); });
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });
  // AI
  $('#sendAiBtn')?.addEventListener('click', () => sendMsg($('#aiInput')?.value||''));
  $('#aiInput')?.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg($('#aiInput')?.value||'');} });
  $('#voiceBtn')?.addEventListener('click', startVoice);
  $('#clearChatBtn')?.addEventListener('click', async () => { if(!confirm('Limpar conversa?')) return; S.chat=[]; await saveCloud(); renderChat(); });
  // Search
  $('#searchToggleBtn')?.addEventListener('click', () => { const b=$('#searchBar'); b.classList.toggle('hidden'); if(!b.classList.contains('hidden')) $('#searchInput')?.focus(); else $('#searchResults')?.classList.add('hidden'); });
  $('#searchClose')?.addEventListener('click', () => { $('#searchBar')?.classList.add('hidden'); $('#searchResults')?.classList.add('hidden'); });
  $('#searchInput')?.addEventListener('input', e => runSearch(e.target.value));
  // Settings
  $('#saveApiKeyBtn')?.addEventListener('click', saveApiKey);
  $('#saveEndpointBtn')?.addEventListener('click', saveEndpoint);
  $('#themeBtn')?.addEventListener('click', () => { S.settings.theme=S.settings.theme==='light'?'dark':'light'; applyTheme(S.settings.theme); saveCloud(); });
  $('#notifPermBtn')?.addEventListener('click', reqNotif);
  $('#notifyBtn')?.addEventListener('click', reqNotif);
  $('#syncBtn')?.addEventListener('click', async () => { await saveCloud(); toast(fbReady&&currentUser&&!demoMode?'☁ Sincronizado!':'💾 Salvo localmente.'); });
  $('#exportBtn')?.addEventListener('click', exportJSON);
  $('#exportCsvBtn')?.addEventListener('click', exportCSV);
  $('#importInput')?.addEventListener('change', e => { const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=async()=>{try{normalize(JSON.parse(r.result));await saveCloud();renderAll();updateSettingsUI();toast('Backup importado!');}catch{toast('Arquivo inválido.');}}; r.readAsText(f); });
  $('#resetBtn')?.addEventListener('click', async () => { if(!confirm('Apagar todos os dados? Sem retorno!')) return; S=makeState(); await saveCloud(); renderAll(); updateSettingsUI(); toast('Dados apagados.'); });
  $('#refreshInsightsBtn')?.addEventListener('click', () => { const m=summary(mFin()); renderInsights(m, S.tasks.filter(t=>!t.done).length, S.tasks.filter(t=>!t.done&&t.priority==='high').length); toast('Insights atualizados.'); });

  document.addEventListener('click', async e => {
    // Chart tabs
    const ctab = e.target.closest('[data-spark]');
    if (ctab) { $$('[data-spark]').forEach(b=>b.classList.toggle('active',b===ctab)); renderChartHome(); return; }

    const b = e.target.closest('[data-screen],[data-open],[data-modal],[data-edit],[data-del],[data-task-filter],[data-finance-filter],[data-prompt]');
    if (!b) return;
    if (b.dataset.screen) showScreen(b.dataset.screen);
    if (b.dataset.open) { showScreen(b.dataset.open); }
    if (b.dataset.modal) openModal(b.dataset.modal);
    if (b.dataset.edit) openModal(b.dataset.edit, b.dataset.id);
    if (b.dataset.del) await remove(b.dataset.del, b.dataset.id);
    if (b.dataset.taskFilter) { taskFilter=b.dataset.taskFilter; $$('.pill[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b)); renderTasks(); }
    if (b.dataset.financeFilter) { finFilter=b.dataset.financeFilter; $$('.pill[data-finance-filter]').forEach(x=>x.classList.toggle('active',x===b)); renderFinance(); }
    if (b.dataset.prompt) { const i=$('#aiInput'); if(i) i.value=b.dataset.prompt; showScreen('ai'); sendMsg(b.dataset.prompt); }
  });

  document.addEventListener('change', async e => {
    if (e.target.dataset.toggleTask) { const t=S.tasks.find(x=>x.id===e.target.dataset.toggleTask); if(t) t.done=e.target.checked; await saveCloud(); renderAll(); }
    if (e.target.dataset.toggleHabit) {
      const h=S.habits.find(x=>x.id===e.target.dataset.toggleHabit);
      if (h) { const t=today(); h.checked=e.target.checked; h.lastCheckedDate=e.target.checked?t:(h.lastCheckedDate||''); h.streak=Math.max(0,+(h.streak||0)+(e.target.checked?1:-1)); if(e.target.checked&&!(h.history||[]).includes(t)) h.history=[...(h.history||[]).slice(-90),t]; }
      await saveCloud(); renderAll();
    }
    if (e.target.dataset.subTask) { const task=S.tasks.find(x=>x.id===e.target.dataset.subTask); const sub=task?.subtasks?.find(s=>s.id===e.target.dataset.subId); if(sub) sub.done=e.target.checked; await saveCloud(); renderTasks(); }
  });
}

// ── Init ───────────────────────────────────────────
bind();
setupVoice();
initFb();
