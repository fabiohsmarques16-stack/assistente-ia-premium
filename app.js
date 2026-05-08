import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const uid = () => crypto?.randomUUID?.() || String(Date.now() + Math.random());
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const defaultData = () => ({
  tasks: [
    { id: uid(), title: 'Revisar pedidos da Neon Sanja', area: 'Neon Sanja', priority: 'high', done: false, due: '', notes: '' },
    { id: uid(), title: 'Conferir estoque de pudins', area: 'Sanja Pudding', priority: 'medium', done: false, due: '', notes: '' }
  ],
  finances: [
    { id: uid(), type: 'income', title: 'Venda exemplo', area: 'Sanja Pudding', value: 120, date: today(), notes: '' },
    { id: uid(), type: 'expense', title: 'Insumos exemplo', area: 'Sanja Pudding', value: 45, date: today(), notes: '' }
  ],
  habits: [
    { id: uid(), title: 'Planejar o dia', area: 'Pessoal', streak: 0, checked: false },
    { id: uid(), title: 'Prospectar clientes', area: 'Negócios', streak: 0, checked: false }
  ],
  chat: [],
  settings: { backupReminder: true, lastBackupNotice: '' }
});

let state = defaultData();
let currentUser = null;
let demoMode = false;
let auth = null;
let db = null;
let firebaseReady = false;
let activeTaskFilter = 'all';
let activeFinanceFilter = 'all';
let recognition = null;
let listening = false;

function toast(msg) {
  const el = $('#toast') || document.createElement('div');
  el.id = 'toast';
  el.className = 'toast show';
  el.textContent = msg;
  if (!el.parentElement) document.body.appendChild(el);
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function storageKey() { return currentUser && !demoMode ? `assistente-v36-${currentUser.uid}` : 'assistente-v36-demo'; }
function normalizeData(data) { state = { ...defaultData(), ...(data || {}) }; state.tasks ||= []; state.finances ||= []; state.habits ||= []; state.chat ||= []; state.settings ||= {}; }
function saveLocal() { localStorage.setItem(storageKey(), JSON.stringify(state)); }
function loadLocal() { try { normalizeData(JSON.parse(localStorage.getItem(storageKey()))); } catch { normalizeData(defaultData()); } }
async function saveCloud() {
  saveLocal();
  if (firebaseReady && currentUser && !demoMode) {
    await setDoc(doc(db, 'users', currentUser.uid), { data: state, updatedAt: new Date().toISOString() }, { merge: true });
  }
}
async function loadCloud() {
  loadLocal();
  if (firebaseReady && currentUser && !demoMode) {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists() && snap.data().data) normalizeData(snap.data().data);
    else await saveCloud();
  }
}

async function initFirebase() {
  try {
    if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey || window.FIREBASE_CONFIG.apiKey.includes('SUA_')) throw new Error('Firebase sem configuração');
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseReady = true;
    onAuthStateChanged(auth, async (user) => { if (user) { currentUser = user; demoMode = false; await enterApp(); } });
  } catch {
    firebaseReady = false;
    setText('#syncStatus', 'Modo local disponível');
  }
}

async function enterApp() {
  await loadCloud();
  $('#loginScreen')?.classList.add('hidden');
  $('#appScreen')?.classList.remove('hidden');
  $('#bottomNav')?.classList.remove('hidden');
  showScreen('home');
  renderAll();
  maybeBackupNotice();
}
function exitApp() {
  currentUser = null; demoMode = false;
  $('#loginScreen')?.classList.remove('hidden');
  $('#appScreen')?.classList.add('hidden');
  $('#bottomNav')?.classList.add('hidden');
}
function validateLogin() {
  const email = $('#email')?.value.trim() || '';
  const pass = $('#password')?.value || '';
  if (!email.includes('@')) throw new Error('Digite um e-mail válido.');
  if (pass.length < 6) throw new Error('A senha precisa ter no mínimo 6 caracteres.');
  return { email, pass };
}
async function login() { try { const { email, pass } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não inicializado. Configure o Firebase ou use o modo demonstração.'); await signInWithEmailAndPassword(auth, email, pass); } catch (e) { toast(firebaseMsg(e)); } }
async function register() { try { const { email, pass } = validateLogin(); if (!firebaseReady) throw new Error('Firebase não inicializado. Configure o Firebase ou use o modo demonstração.'); await createUserWithEmailAndPassword(auth, email, pass); } catch (e) { toast(firebaseMsg(e)); } }
function firebaseMsg(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'Este e-mail já tem conta. Use Entrar.';
  if (code.includes('operation-not-allowed')) return 'Ative o login por e-mail/senha no Firebase Authentication.';
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'E-mail ou senha incorretos.';
  if (code.includes('user-not-found')) return 'Conta não encontrada. Use Criar conta primeiro.';
  if (code.includes('invalid-email')) return 'E-mail inválido.';
  return e?.message || 'Erro inesperado.';
}

function setText(q, v) { const el = $(q); if (el) el.textContent = v; }
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id)?.classList.add('active');
  $$('#bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderAll() { renderHome(); renderTasks(activeTaskFilter); renderFinance(activeFinanceFilter); renderHabits(); renderFocus(); renderChat(); }
function monthFinances() { const ym = today().slice(0, 7); return state.finances.filter(f => String(f.date || '').startsWith(ym)); }
function financeSummary(arr = state.finances) {
  const income = arr.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.value || 0), 0);
  const expense = arr.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.value || 0), 0);
  return { income, expense, balance: income - expense };
}
function renderHome() {
  const open = state.tasks.filter(t => !t.done).length;
  const doneHabits = state.habits.filter(h => h.checked).length;
  const habitsPct = state.habits.length ? Math.round(doneHabits / state.habits.length * 100) : 0;
  const m = financeSummary(monthFinances());
  setText('#syncStatus', firebaseReady && currentUser && !demoMode ? 'Sincronizado com Firebase' : 'Modo local / demonstração');
  setText('#statTasks', state.tasks.length); setText('#statTasksSub', `${open} pendentes`);
  setText('#statHabits', `${habitsPct}%`); setText('#statMoney', money(m.balance));
  setText('#missionText', buildMission());
  renderInsights();
}
function buildMission() {
  const high = state.tasks.filter(t => !t.done && t.priority === 'high').length;
  const balance = financeSummary(monthFinances()).balance;
  if (high) return `Você tem ${high} tarefa(s) de alta prioridade. Comece por uma delas antes de abrir novas frentes.`;
  if (balance < 0) return `Seu mês está negativo em ${money(Math.abs(balance))}. Registre receitas/despesas e corte o que não for essencial.`;
  return 'Seu painel está estável. Escolha uma prioridade, registre os gastos do dia e mantenha os hábitos em dia.';
}
function renderInsights() {
  const box = $('#insightList'); if (!box) return;
  const m = financeSummary(monthFinances());
  const open = state.tasks.filter(t => !t.done).length;
  const list = [];
  if (open) list.push({ c: 'warn', t: `Existem ${open} tarefa(s) abertas. Use o Modo Foco para atacar as 3 principais.` });
  if (m.expense > m.income && m.expense > 0) list.push({ c: 'warn', t: `Despesas do mês estão maiores que receitas: ${money(m.balance)}.` });
  if (state.habits.length && state.habits.every(h => h.checked)) list.push({ c: 'good', t: 'Todos os hábitos do dia foram concluídos. Excelente consistência.' });
  if (!list.length) list.push({ c: 'good', t: 'Sem alertas críticos agora. Continue registrando tarefas e finanças diariamente.' });
  box.innerHTML = list.map(i => `<div class="insight ${i.c}">${esc(i.t)}</div>`).join('');
}
function itemActions(type, id) { return `<div class="actions"><button class="mini" data-edit="${type}" data-id="${id}" title="Editar">✎</button><button class="mini danger" data-del="${type}" data-id="${id}" title="Excluir">🗑</button></div>`; }
function priorityName(p) { return ({ high: 'Alta', medium: 'Média', low: 'Baixa' }[p] || 'Média'); }
function renderTasks(filter = 'all') {
  const list = $('#taskList'); if (!list) return;
  let arr = [...state.tasks];
  if (filter === 'open') arr = arr.filter(t => !t.done);
  if (filter === 'done') arr = arr.filter(t => t.done);
  if (filter === 'high') arr = arr.filter(t => t.priority === 'high');
  list.innerHTML = arr.length ? arr.map(t => `<div class="item"><div class="itemIcon">☑</div><div class="itemMain"><label class="checkline"><input type="checkbox" data-toggle-task="${t.id}" ${t.done ? 'checked' : ''}> <strong>${esc(t.title)}</strong></label><p>${esc(t.area || 'Sem área')} • prioridade ${priorityName(t.priority)} ${t.due ? '• prazo ' + esc(t.due) : ''}</p></div>${itemActions('task', t.id)}</div>`).join('') : '<div class="item"><p>Nenhuma tarefa cadastrada.</p></div>';
}
function renderFinance(filter = 'all') {
  const list = $('#financeList'); if (!list) return;
  const m = financeSummary(monthFinances());
  setText('#financeTotal', money(m.balance)); setText('#incomeTotal', `Receitas do mês: ${money(m.income)}`); setText('#expenseTotal', `Despesas do mês: ${money(m.expense)}`);
  let arr = [...state.finances].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (filter !== 'all') arr = arr.filter(f => f.type === filter);
  list.innerHTML = arr.length ? arr.map(f => `<div class="item"><div class="itemIcon">${f.type === 'income' ? '＋' : '−'}</div><div class="itemMain"><h4>${f.type === 'income' ? 'Receita' : 'Despesa'}: ${esc(f.title)}</h4><p>${esc(f.area || 'Sem área')} • ${money(f.value)} • ${esc(f.date || '')}</p></div>${itemActions('finance', f.id)}</div>`).join('') : '<div class="item"><p>Nenhum lançamento financeiro.</p></div>';
}
function renderHabits() {
  const list = $('#habitList'); if (!list) return;
  list.innerHTML = state.habits.length ? state.habits.map(h => `<div class="item"><div class="itemIcon">◎</div><div class="itemMain"><label class="checkline"><input type="checkbox" data-toggle-habit="${h.id}" ${h.checked ? 'checked' : ''}> <strong>${esc(h.title)}</strong></label><p>${esc(h.area || 'Sem área')} • sequência: ${Number(h.streak || 0)}</p></div>${itemActions('habit', h.id)}</div>`).join('') : '<div class="item"><p>Nenhum hábito cadastrado.</p></div>';
}
function renderFocus() {
  const list = $('#focusList'); if (!list) return;
  const prio = { high: 3, medium: 2, low: 1 };
  const arr = state.tasks.filter(t => !t.done).sort((a, b) => (prio[b.priority] || 2) - (prio[a.priority] || 2)).slice(0, 3);
  setText('#focusAdvice', arr.length ? 'Resolva estas prioridades antes de cadastrar novas tarefas.' : 'Nenhuma tarefa aberta. Ótimo momento para planejar a próxima ação.');
  list.innerHTML = arr.length ? arr.map((t, i) => `<div class="item"><div class="itemIcon">${i + 1}</div><div class="itemMain"><h4>${esc(t.title)}</h4><p>${esc(t.area || '')} • prioridade ${priorityName(t.priority)}</p></div></div>`).join('') : '<div class="item"><p>Nenhuma prioridade pendente.</p></div>';
}

function findArr(type) { return type === 'task' ? state.tasks : type === 'finance' ? state.finances : state.habits; }
function findObj(type, id) { return findArr(type).find(x => x.id === id); }
function openModal(type, id = null) {
  const modal = $('#modal'), title = $('#modalTitle'), body = $('#modalBody');
  const obj = id ? findObj(type, id) : null;
  title.textContent = (id ? 'Editar ' : 'Adicionar ') + ({ task: 'tarefa', finance: 'lançamento', habit: 'hábito' }[type] || 'item');
  if (type === 'task') body.innerHTML = formTask(obj);
  if (type === 'finance') body.innerHTML = formFinance(obj);
  if (type === 'habit') body.innerHTML = formHabit(obj);
  body.innerHTML += `<div class="modalActions"><button id="modalSave" class="btn primary">Salvar</button><button id="modalCancel" class="btn secondary">Cancelar</button></div>`;
  if (obj?.priority) $('#mPriority').value = obj.priority;
  if (obj?.type) $('#mType').value = obj.type;
  $('#modalSave').onclick = async () => { await saveModal(type, id); closeModal(); };
  $('#modalCancel').onclick = closeModal;
  modal.classList.remove('hidden');
}
function closeModal() { $('#modal')?.classList.add('hidden'); }
function formTask(o = {}) { return `<label>Título</label><input id="mTitle" class="input" value="${esc(o?.title || '')}" placeholder="Ex: comprar etiquetas"><label>Área/negócio</label><input id="mArea" class="input" value="${esc(o?.area || '')}" placeholder="Neon Sanja, Sanja Pudding..."><label>Prioridade</label><select id="mPriority"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Alta</option></select><label>Prazo</label><input id="mDue" class="input" type="date" value="${esc(o?.due || '')}"><label>Observações</label><textarea id="mNotes" placeholder="Detalhes da tarefa">${esc(o?.notes || '')}</textarea>`; }
function formFinance(o = {}) { return `<label>Tipo</label><select id="mType"><option value="income">Receita</option><option value="expense">Despesa</option></select><label>Descrição</label><input id="mTitle" class="input" value="${esc(o?.title || '')}" placeholder="Ex: compra de insumos"><label>Negócio/categoria</label><input id="mArea" class="input" value="${esc(o?.area || '')}" placeholder="Sanja Pudding, Neon Sanja..."><label>Valor</label><input id="mValue" class="input" type="number" step="0.01" value="${esc(o?.value || '')}" placeholder="0,00"><label>Data</label><input id="mDate" class="input" type="date" value="${esc(o?.date || today())}"><label>Observações</label><textarea id="mNotes" placeholder="Detalhes do lançamento">${esc(o?.notes || '')}</textarea>`; }
function formHabit(o = {}) { return `<label>Hábito</label><input id="mTitle" class="input" value="${esc(o?.title || '')}" placeholder="Ex: prospectar clientes"><label>Área</label><input id="mArea" class="input" value="${esc(o?.area || '')}" placeholder="Pessoal, negócios..."><label>Sequência atual</label><input id="mStreak" class="input" type="number" value="${Number(o?.streak || 0)}">`; }
async function saveModal(type, id) {
  if (type === 'task') upsert(state.tasks, { id: id || uid(), title: $('#mTitle').value.trim() || 'Sem título', area: $('#mArea').value.trim(), priority: $('#mPriority').value, due: $('#mDue').value, notes: $('#mNotes').value, done: findObj(type, id)?.done || false }, id);
  if (type === 'finance') upsert(state.finances, { id: id || uid(), type: $('#mType').value, title: $('#mTitle').value.trim() || 'Sem descrição', area: $('#mArea').value.trim(), value: Number($('#mValue').value || 0), date: $('#mDate').value || today(), notes: $('#mNotes').value }, id);
  if (type === 'habit') upsert(state.habits, { id: id || uid(), title: $('#mTitle').value.trim() || 'Sem título', area: $('#mArea').value.trim(), streak: Number($('#mStreak').value || 0), checked: findObj(type, id)?.checked || false }, id);
  await saveCloud(); renderAll(); toast('Salvo com sucesso.');
}
function upsert(arr, data, id) { const i = arr.findIndex(x => x.id === id); if (i >= 0) arr[i] = data; else arr.unshift(data); }
async function removeItem(type, id) { if (!confirm('Excluir este item?')) return; const arr = findArr(type); const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); await saveCloud(); renderAll(); toast('Item excluído.'); }

function addChat(role, text) { state.chat.push({ role, text, at: new Date().toISOString() }); state.chat = state.chat.slice(-80); saveLocal(); renderChat(); }
function renderChat() { const box = $('#chatBox'); if (!box) return; box.innerHTML = state.chat.length ? state.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`).join('') : `<div class="msg ai">Olá! Você pode digitar ou falar comigo. Exemplos:\n• crie uma tarefa ligar para cliente amanhã\n• registre despesa de 35 reais com etiquetas\n• registre receita de 120 reais venda de pudim\n• analise meu dia</div>`; box.scrollTop = box.scrollHeight; }
async function handleAiMessage(text, spoken = false) {
  const clean = text.trim(); if (!clean) return;
  addChat('user', clean);
  const result = await runAssistantCommand(clean);
  addChat('ai', result);
  if (spoken) speak(result);
  renderAll();
}
async function runAssistantCommand(text) {
  const lower = text.toLowerCase();
  const value = extractValue(lower);
  if (/\b(tarefa|lembrete|atividade)\b/.test(lower) && /\b(cri|adicion|coloc|cadast|inclu)/.test(lower)) {
    const title = cleanupTitle(text, ['criar', 'crie', 'adicione', 'adicionar', 'coloque', 'cadastrar', 'cadastre', 'uma tarefa', 'tarefa', 'lembrete']);
    state.tasks.unshift({ id: uid(), title: title || 'Nova tarefa por voz', area: inferArea(lower), priority: lower.includes('urgente') || lower.includes('alta') ? 'high' : 'medium', done: false, due: inferDate(lower), notes: 'Criada pela IA por comando de voz/texto.' });
    await saveCloud(); return `Tarefa criada: ${title || 'Nova tarefa por voz'}.`;
  }
  if (/\b(despesa|gasto|paguei|compra|comprei)\b/.test(lower) && (value !== null || /\b(registr|lanç|coloc|adicion)/.test(lower))) {
    const title = cleanupTitle(text, ['registrar', 'registre', 'lançar', 'lance', 'coloque', 'adicionar', 'adicione', 'despesa', 'gasto', 'paguei', 'compra', 'comprei', String(value || '')]);
    state.finances.unshift({ id: uid(), type: 'expense', title: title || 'Despesa por voz', area: inferArea(lower), value: value ?? 0, date: today(), notes: 'Criada pela IA por comando de voz/texto.' });
    await saveCloud(); return `Despesa registrada: ${money(value ?? 0)} — ${title || 'Despesa por voz'}.`;
  }
  if (/\b(receita|venda|recebi|entrada|faturamento)\b/.test(lower) && (value !== null || /\b(registr|lanç|coloc|adicion)/.test(lower))) {
    const title = cleanupTitle(text, ['registrar', 'registre', 'lançar', 'lance', 'coloque', 'adicionar', 'adicione', 'receita', 'venda', 'recebi', 'entrada', String(value || '')]);
    state.finances.unshift({ id: uid(), type: 'income', title: title || 'Receita por voz', area: inferArea(lower), value: value ?? 0, date: today(), notes: 'Criada pela IA por comando de voz/texto.' });
    await saveCloud(); return `Receita registrada: ${money(value ?? 0)} — ${title || 'Receita por voz'}.`;
  }
  if (/\b(analise|analisar|resumo|prioridade|dia|finanças|financeiro)\b/.test(lower)) return smartAnswer();
  if (window.AI_ENDPOINT) return callRemoteAi(text);
  return `Entendi. No modo local eu consigo criar tarefas, registrar receitas/despesas e analisar seu dia. Tente falar: “crie uma tarefa comprar etiquetas” ou “registre despesa de 35 reais com acrílico”.`;
}
function extractValue(text) { const m = text.replace(',', '.').match(/(?:r\$\s*)?(\d+(?:\.\d{1,2})?)\s*(?:reais|real)?/); return m ? Number(m[1]) : null; }
function cleanupTitle(text, words) { let s = text; words.forEach(w => { if (w) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '); }); return s.replace(/\b(de|do|da|com|para|por|reais|real|r\$)\b/ig, ' ').replace(/\s+/g, ' ').trim(); }
function inferArea(t) { if (t.includes('pudim') || t.includes('sanja pudding')) return 'Sanja Pudding'; if (t.includes('neon') || t.includes('letreiro') || t.includes('acrílico')) return 'Neon Sanja'; return 'Geral'; }
function inferDate(t) { const d = new Date(); if (t.includes('amanhã')) d.setDate(d.getDate() + 1); else if (t.includes('semana que vem')) d.setDate(d.getDate() + 7); else return ''; return d.toISOString().slice(0, 10); }
function smartAnswer() { const m = financeSummary(monthFinances()); const open = state.tasks.filter(t => !t.done); const high = open.filter(t => t.priority === 'high'); return `Resumo inteligente:\n• Tarefas abertas: ${open.length}, sendo ${high.length} de alta prioridade.\n• Saldo do mês: ${money(m.balance)}. Receitas: ${money(m.income)}. Despesas: ${money(m.expense)}.\n• Hábitos concluídos hoje: ${state.habits.filter(h => h.checked).length}/${state.habits.length}.\nSugestão: resolva primeiro uma tarefa de alta prioridade e registre todos os gastos do dia para manter o painel confiável.`; }
async function callRemoteAi(text) { try { const r = await fetch(window.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, data: state }) }); const data = await r.json(); return data.reply || 'Backend respondeu, mas sem texto.'; } catch { return 'Não consegui acessar o backend da IA agora. Continue usando os comandos locais.'; } }

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#voiceBtn');
  if (!SR || !mic) { mic?.classList.add('disabled'); return; }
  recognition = new SR(); recognition.lang = 'pt-BR'; recognition.continuous = false; recognition.interimResults = false;
  recognition.onstart = () => { listening = true; mic.classList.add('recording'); toast('Estou ouvindo. Fale o comando.'); };
  recognition.onend = () => { listening = false; mic.classList.remove('recording'); };
  recognition.onerror = () => toast('Não consegui ouvir. Verifique a permissão do microfone.');
  recognition.onresult = (ev) => { const text = ev.results?.[0]?.[0]?.transcript || ''; $('#aiInput').value = text; handleAiMessage(text, true); };
}
function startVoice() { if (!recognition) return toast('Reconhecimento de voz não disponível neste navegador. Use Chrome no Android.'); listening ? recognition.stop() : recognition.start(); }
function speak(text) { try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\n/g, '. ')); u.lang = 'pt-BR'; speechSynthesis.speak(u); } catch {} }

function exportBackup() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup-assistente-ia-${today()}.json`; a.click(); URL.revokeObjectURL(a.href); state.settings.lastBackupNotice = today(); saveLocal(); }
function importBackup(file) { const reader = new FileReader(); reader.onload = async () => { try { normalizeData(JSON.parse(reader.result)); await saveCloud(); renderAll(); toast('Backup importado com sucesso.'); } catch { toast('Arquivo de backup inválido.'); } }; reader.readAsText(file); }
function maybeBackupNotice() { if (!state.settings.backupReminder) return; const last = state.settings.lastBackupNotice || ''; if (last !== today() && (!firebaseReady || demoMode)) toast('Atenção: seus dados estão locais neste aparelho. Exporte backup periodicamente em Configurações.'); }

function bind() {
  $('#loginBtn')?.addEventListener('click', login);
  $('#registerBtn')?.addEventListener('click', register);
  $('#demoBtn')?.addEventListener('click', async () => { demoMode = true; currentUser = null; await enterApp(); toast('Modo demonstração ativado. Dados salvos neste aparelho.'); });
  $('#logoutBtn')?.addEventListener('click', async () => { try { if (auth) await signOut(auth); } catch {} exitApp(); });
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#sendAiBtn')?.addEventListener('click', () => handleAiMessage($('#aiInput')?.value || ''));
  $('#aiInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleAiMessage($('#aiInput')?.value || ''); });
  $('#voiceBtn')?.addEventListener('click', startVoice);
  $('#clearChatBtn')?.addEventListener('click', async () => { state.chat = []; await saveCloud(); renderChat(); });
  $('#refreshInsightsBtn')?.addEventListener('click', () => { renderInsights(); toast('Insights atualizados.'); });
  $('#exportBtn')?.addEventListener('click', exportBackup);
  $('#importInput')?.addEventListener('change', e => e.target.files?.[0] && importBackup(e.target.files[0]));
  $('#syncBtn')?.addEventListener('click', async () => { await saveCloud(); toast(firebaseReady && currentUser && !demoMode ? 'Sincronizado com a nuvem.' : 'Dados salvos localmente.'); });
  $('#resetBtn')?.addEventListener('click', async () => { if (confirm('Apagar todos os dados deste aparelho?')) { state = defaultData(); await saveCloud(); renderAll(); toast('Dados reiniciados.'); } });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button,[data-open]'); if (!b) return;
    if (b.dataset.screen) showScreen(b.dataset.screen);
    if (b.dataset.open) showScreen(b.dataset.open);
    if (b.dataset.home !== undefined) showScreen('home');
    if (b.dataset.modal) openModal(b.dataset.modal);
    if (b.dataset.edit) openModal(b.dataset.edit, b.dataset.id);
    if (b.dataset.del) await removeItem(b.dataset.del, b.dataset.id);
    if (b.dataset.taskFilter) { activeTaskFilter = b.dataset.taskFilter; $$('.filters button[data-task-filter]').forEach(x => x.classList.toggle('active', x === b)); renderTasks(activeTaskFilter); }
    if (b.dataset.financeFilter) { activeFinanceFilter = b.dataset.financeFilter; $$('.filters button[data-finance-filter]').forEach(x => x.classList.toggle('active', x === b)); renderFinance(activeFinanceFilter); }
    if (b.dataset.prompt) { $('#aiInput').value = b.dataset.prompt; await handleAiMessage(b.dataset.prompt); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.dataset.toggleTask) { const t = state.tasks.find(x => x.id === e.target.dataset.toggleTask); if (t) t.done = e.target.checked; await saveCloud(); renderAll(); }
    if (e.target.dataset.toggleHabit) { const h = state.habits.find(x => x.id === e.target.dataset.toggleHabit); if (h) { h.checked = e.target.checked; h.streak = Math.max(0, Number(h.streak || 0) + (e.target.checked ? 1 : -1)); } await saveCloud(); renderAll(); }
  });
}

bind();
setupVoice();
initFirebase();
renderAll();
