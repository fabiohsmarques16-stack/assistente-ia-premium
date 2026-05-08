import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const uid = () => crypto?.randomUUID?.() || String(Date.now() + Math.random());
const money = (n) => (Number(n) || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});

const defaultData = () => ({
  tasks: [
    {id:uid(), title:'Revisar pedidos da Neon Sanja', area:'Neon Sanja', priority:'high', done:false, due:'', notes:''},
    {id:uid(), title:'Conferir estoque de pudins', area:'Sanja Pudding', priority:'medium', done:false, due:'', notes:''}
  ],
  finances: [
    {id:uid(), type:'income', title:'Venda exemplo', area:'Sanja Pudding', value:120, date:new Date().toISOString().slice(0,10), notes:''},
    {id:uid(), type:'expense', title:'Insumos exemplo', area:'Sanja Pudding', value:45, date:new Date().toISOString().slice(0,10), notes:''}
  ],
  habits: [
    {id:uid(), title:'Planejar o dia', area:'Pessoal', streak:0, checked:false},
    {id:uid(), title:'Prospectar clientes', area:'Negócios', streak:0, checked:false}
  ],
  notes: []
});

let state = defaultData();
let currentUser = null;
let demoMode = false;
let auth = null;
let db = null;
let firebaseReady = false;

function toast(msg){
  const old = $('.toast'); if(old) old.remove();
  const el = document.createElement('div'); el.className='toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(()=>el.remove(), 4500);
}

function storageKey(){ return currentUser ? `assistente-v351-${currentUser.uid}` : 'assistente-v351-demo'; }
function saveLocal(){ localStorage.setItem(storageKey(), JSON.stringify(state)); }
function loadLocal(){
  try { const raw = localStorage.getItem(storageKey()); if(raw) state = JSON.parse(raw); }
  catch { state = defaultData(); }
}
async function saveCloud(){
  saveLocal();
  if(firebaseReady && currentUser && !demoMode) await setDoc(doc(db,'users',currentUser.uid), {data: state, updatedAt: new Date().toISOString()});
}
async function loadCloud(){
  loadLocal();
  if(firebaseReady && currentUser && !demoMode){
    const snap = await getDoc(doc(db,'users',currentUser.uid));
    if(snap.exists() && snap.data().data) state = snap.data().data;
    else await saveCloud();
  }
}

async function initFirebase(){
  try{
    if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) throw new Error('Firebase sem configuração');
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app); db = getFirestore(app); firebaseReady = true;
    onAuthStateChanged(auth, async (user)=>{
      if(user){ currentUser = user; demoMode=false; await enterApp(); }
    });
  }catch(e){
    firebaseReady = false;
    toast('Firebase não carregou. O modo demonstração continua funcionando localmente.');
  }
}

async function enterApp(){
  await loadCloud();
  $('#loginScreen')?.classList.add('hidden');
  $('#app')?.classList.remove('hidden');
  $('#bottomNav')?.classList.remove('hidden');
  renderAll();
}
function exitApp(){
  currentUser=null; demoMode=false;
  $('#loginScreen')?.classList.remove('hidden');
  $('#app')?.classList.add('hidden');
  $('#bottomNav')?.classList.add('hidden');
}

function validateLogin(){
  const email = $('#email')?.value.trim() || '';
  const pass = $('#password')?.value || '';
  if(!email.includes('@')) throw new Error('Digite um e-mail válido.');
  if(pass.length < 6) throw new Error('A senha precisa ter no mínimo 6 caracteres.');
  return {email, pass};
}
async function login(){
  try{
    const {email, pass} = validateLogin();
    if(!firebaseReady) throw new Error('Firebase não inicializado.');
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){ toast(firebaseMsg(e)); }
}
async function register(){
  try{
    const {email, pass} = validateLogin();
    if(!firebaseReady) throw new Error('Firebase não inicializado.');
    await createUserWithEmailAndPassword(auth, email, pass);
  }catch(e){ toast(firebaseMsg(e)); }
}
function firebaseMsg(e){
  const code = e?.code || '';
  if(code.includes('email-already-in-use')) return 'Este e-mail já tem conta. Use o botão Entrar, não Criar conta.';
  if(code.includes('operation-not-allowed')) return 'Ative o login por E-mail/senha no Firebase Authentication.';
  if(code.includes('invalid-credential') || code.includes('wrong-password')) return 'E-mail ou senha incorretos.';
  if(code.includes('user-not-found')) return 'Conta não encontrada. Use Criar conta primeiro.';
  if(code.includes('invalid-email')) return 'E-mail inválido.';
  return e?.message || 'Erro inesperado.';
}

function renderAll(){ renderHome(); renderTasks(); renderFinance(); renderHabits(); }
function renderHome(){
  const open = state.tasks.filter(t=>!t.done).length;
  const done = state.tasks.filter(t=>t.done).length;
  const saldo = state.finances.reduce((s,f)=>s+(f.type==='income'?1:-1)*(Number(f.value)||0),0);
  setText('#kpiOpen', open); setText('#kpiDone', done); setText('#kpiBalance', money(saldo));
  const suggestions = $('#smartSuggestions'); if(suggestions){
    const top = [];
    if(open) top.push(`Você tem ${open} tarefa(s) aberta(s). Priorize as de alta prioridade.`);
    if(saldo < 0) top.push('Seu saldo está negativo. Revise despesas e custos dos negócios.');
    if(!top.length) top.push('Tudo organizado. Cadastre novas tarefas, receitas, despesas ou hábitos.');
    suggestions.innerHTML = top.map(x=>`<div class="item"><strong>Insight</strong><p>${x}</p></div>`).join('');
  }
}
function setText(q,v){ const el=$(q); if(el) el.textContent=v; }

function itemActions(type,id){ return `<div class="actions"><button data-edit="${type}" data-id="${id}">Editar</button><button class="danger" data-del="${type}" data-id="${id}">Excluir</button></div>`; }
function renderTasks(filter='all'){
  const list=$('#taskList'); if(!list) return;
  let arr=[...state.tasks];
  if(filter==='open') arr=arr.filter(t=>!t.done); if(filter==='done') arr=arr.filter(t=>t.done); if(filter==='high') arr=arr.filter(t=>t.priority==='high');
  list.innerHTML = arr.length ? arr.map(t=>`<div class="item"><label><input type="checkbox" data-toggle-task="${t.id}" ${t.done?'checked':''}> <strong>${t.title}</strong></label><p>${t.area||''} • ${t.priority||'medium'} ${t.due?'• '+t.due:''}</p>${itemActions('task',t.id)}</div>`).join('') : '<div class="item"><p>Nenhuma tarefa cadastrada.</p></div>';
}
function renderFinance(filter='all'){
  const list=$('#financeList'); if(!list) return;
  const income = state.finances.filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.value||0),0);
  const expense = state.finances.filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.value||0),0);
  setText('#financeTotal', money(income-expense)); setText('#incomeTotal', `Receitas: ${money(income)}`); setText('#expenseTotal', `Despesas: ${money(expense)}`);
  let arr=[...state.finances]; if(filter!=='all') arr=arr.filter(f=>f.type===filter);
  list.innerHTML = arr.length ? arr.map(f=>`<div class="item"><strong>${f.type==='income'?'Receita':'Despesa'}: ${f.title}</strong><p>${f.area||''} • ${money(f.value)} • ${f.date||''}</p>${itemActions('finance',f.id)}</div>`).join('') : '<div class="item"><p>Nenhum lançamento financeiro.</p></div>';
}
function renderHabits(){
  const list=$('#habitList'); if(!list) return;
  list.innerHTML = state.habits.length ? state.habits.map(h=>`<div class="item"><label><input type="checkbox" data-toggle-habit="${h.id}" ${h.checked?'checked':''}> <strong>${h.title}</strong></label><p>${h.area||''} • sequência: ${h.streak||0}</p>${itemActions('habit',h.id)}</div>`).join('') : '<div class="item"><p>Nenhum hábito cadastrado.</p></div>';
}

function openModal(type,id=null){
  const modal=$('#modal'), title=$('#modalTitle'), body=$('#modalBody');
  let obj = id ? findObj(type,id) : null;
  title.textContent = (id?'Editar ':'Adicionar ') + ({task:'tarefa', finance:'lançamento', habit:'hábito'}[type]||'item');
  if(type==='task') body.innerHTML = formTask(obj);
  if(type==='finance') body.innerHTML = formFinance(obj);
  if(type==='habit') body.innerHTML = formHabit(obj);
  body.innerHTML += `<div class="modalActions"><button id="modalSave">Salvar</button><button id="modalCancel" class="secondary">Cancelar</button></div>`;
  $('#modalSave').onclick = async ()=>{ await saveModal(type,id); closeModal(); };
  $('#modalCancel').onclick = closeModal;
  modal.classList.remove('hidden');
}
function closeModal(){ $('#modal')?.classList.add('hidden'); }
function findObj(type,id){ return (type==='task'?state.tasks:type==='finance'?state.finances:state.habits).find(x=>x.id===id); }
function formTask(o={}){ return `<input id="mTitle" placeholder="Título" value="${esc(o?.title||'')}"><input id="mArea" placeholder="Área/Negócio" value="${esc(o?.area||'')}"><select id="mPriority"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select><input id="mDue" type="date" value="${o?.due||''}"><textarea id="mNotes" placeholder="Observações">${esc(o?.notes||'')}</textarea>`; }
function formFinance(o={}){ return `<select id="mType"><option value="income">Receita</option><option value="expense">Despesa</option></select><input id="mTitle" placeholder="Descrição" value="${esc(o?.title||'')}"><input id="mArea" placeholder="Negócio" value="${esc(o?.area||'')}"><input id="mValue" type="number" step="0.01" placeholder="Valor" value="${o?.value||''}"><input id="mDate" type="date" value="${o?.date||new Date().toISOString().slice(0,10)}"><textarea id="mNotes" placeholder="Observações">${esc(o?.notes||'')}</textarea>`; }
function formHabit(o={}){ return `<input id="mTitle" placeholder="Hábito" value="${esc(o?.title||'')}"><input id="mArea" placeholder="Área" value="${esc(o?.area||'')}"><input id="mStreak" type="number" placeholder="Sequência" value="${o?.streak||0}">`; }
function esc(s){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
async function saveModal(type,id){
  if(type==='task'){
    const data={id:id||uid(), title:$('#mTitle').value||'Sem título', area:$('#mArea').value, priority:$('#mPriority').value, due:$('#mDue').value, notes:$('#mNotes').value, done:findObj(type,id)?.done||false}; upsert(state.tasks,data,id);
  }
  if(type==='finance'){
    const data={id:id||uid(), type:$('#mType').value, title:$('#mTitle').value||'Sem descrição', area:$('#mArea').value, value:Number($('#mValue').value||0), date:$('#mDate').value, notes:$('#mNotes').value}; upsert(state.finances,data,id);
  }
  if(type==='habit'){
    const data={id:id||uid(), title:$('#mTitle').value||'Sem título', area:$('#mArea').value, streak:Number($('#mStreak').value||0), checked:findObj(type,id)?.checked||false}; upsert(state.habits,data,id);
  }
  await saveCloud(); renderAll(); toast('Salvo com sucesso.');
}
function upsert(arr,data,id){ const i=arr.findIndex(x=>x.id===id); if(i>=0) arr[i]=data; else arr.unshift(data); }
async function removeItem(type,id){
  if(!confirm('Excluir este item?')) return;
  const arr = type==='task'?state.tasks:type==='finance'?state.finances:state.habits;
  const i=arr.findIndex(x=>x.id===id); if(i>=0) arr.splice(i,1);
  await saveCloud(); renderAll(); toast('Item excluído.');
}

function bind(){
  $('#loginBtn')?.addEventListener('click', login);
  $('#registerBtn')?.addEventListener('click', register);
  $('#demoBtn')?.addEventListener('click', async ()=>{ demoMode=true; currentUser=null; loadLocal(); await enterApp(); toast('Modo demonstração ativado. Dados salvos neste aparelho.'); });
  $('#logoutBtn')?.addEventListener('click', async()=>{ try{ if(auth) await signOut(auth); }catch{} exitApp(); });
  $('#modalClose')?.addEventListener('click', closeModal);
  document.addEventListener('click', async (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.screen){ $$('.screen').forEach(s=>s.classList.remove('active')); $('#'+b.dataset.screen)?.classList.add('active'); $$('#bottomNav button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }
    if(b.dataset.modal) openModal(b.dataset.modal);
    if(b.dataset.edit) openModal(b.dataset.edit,b.dataset.id);
    if(b.dataset.del) await removeItem(b.dataset.del,b.dataset.id);
    if(b.dataset.taskFilter){ $$('.filters button[data-task-filter]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderTasks(b.dataset.taskFilter); }
    if(b.dataset.financeFilter){ $$('.filters button[data-finance-filter]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderFinance(b.dataset.financeFilter); }
  });
  document.addEventListener('change', async(e)=>{
    if(e.target.dataset.toggleTask){ const t=state.tasks.find(x=>x.id===e.target.dataset.toggleTask); if(t) t.done=e.target.checked; await saveCloud(); renderAll(); }
    if(e.target.dataset.toggleHabit){ const h=state.habits.find(x=>x.id===e.target.dataset.toggleHabit); if(h){ h.checked=e.target.checked; h.streak=Math.max(0,(Number(h.streak)||0)+(e.target.checked?1:-1)); } await saveCloud(); renderAll(); }
  });
  $('#aiSend')?.addEventListener('click', ()=>{
    const inp=$('#aiInput'); const v=inp?.value.trim(); if(!v) return;
    const box=$('#chatBox'); box.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(v)}</div><div class="bubble bot">${smartAnswer(v)}</div>`); inp.value='';
  });
}
function smartAnswer(v){
  if(window.AI_ENDPOINT) return 'Endpoint configurado. A integração real pode responder por backend seguro.';
  const saldo = state.finances.reduce((s,f)=>s+(f.type==='income'?1:-1)*(Number(f.value)||0),0);
  return `Análise local: você tem ${state.tasks.filter(t=>!t.done).length} tarefa(s) aberta(s), ${state.habits.length} hábito(s) e saldo registrado de ${money(saldo)}. Para IA real, configure window.AI_ENDPOINT no firebase-config.js apontando para um backend seguro.`;
}

bind();
initFirebase();
renderAll();
