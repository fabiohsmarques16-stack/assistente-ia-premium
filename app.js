import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const toast = (msg) => { const el = $("toast"); el.textContent = msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), 2800); };

let firebaseReady = false, auth = null, db = null, currentUser = null;

function hasFirebaseConfig() {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && c.authDomain && c.projectId && c.appId;
}

try {
  if (hasFirebaseConfig()) {
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseReady = true;
  }
} catch (e) {
  console.warn(e);
}

let STATE = JSON.parse(localStorage.getItem("assistenteIAState") || "null") || {
  tasks: [{ title: "Publicar PWA no GitHub Pages", done: true }, { title: "Configurar banco de dados", done: false }],
  habits: [{ title: "Planejamento diário", streak: 3, doneToday: false }],
  finances: [{ desc: "Receita exemplo", value: 1200 }, { desc: "Despesa exemplo", value: -320 }],
  chat: []
};

function saveLocal() {
  localStorage.setItem("assistenteIAState", JSON.stringify(STATE));
  render();
}

async function syncCloud() {
  if (!firebaseReady || !currentUser) {
    $("syncStatus").textContent = "Banco local ativo";
    $("cloudText").textContent = "Modo local ativo. Configure o Firebase para sincronização real em nuvem.";
    return;
  }
  await setDoc(doc(db, "users", currentUser.uid), { state: STATE, updatedAt: serverTimestamp() }, { merge: true });
  $("syncStatus").textContent = "Sincronizado com Firebase";
  $("cloudText").textContent = "Sincronização em nuvem ativa com Firestore.";
}

async function loadCloud() {
  if (!firebaseReady || !currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists() && snap.data().state) {
    STATE = snap.data().state;
    saveLocal();
  } else {
    await syncCloud();
  }
}

function showApp() {
  $("loginScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
  $("nav").classList.remove("hidden");
  render();
}

function showLogin() {
  $("loginScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
  $("nav").classList.add("hidden");
}

function openScreen(target) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === target));
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.screen === target));
  localStorage.setItem("lastScreenV2", target);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-screen]").forEach(b => b.addEventListener("click", () => openScreen(b.dataset.screen)));
document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openScreen(b.dataset.open)));

$("demoBtn").onclick = () => { currentUser = { uid: "demo", email: "demo@local" }; showApp(); toast("Modo demonstração ativado."); };

$("registerBtn").onclick = async () => {
  if (!firebaseReady) return toast("Configure o Firebase para criar conta real. Use modo demonstração por enquanto.");
  try {
    await createUserWithEmailAndPassword(auth, $("email").value, $("password").value);
    toast("Conta criada.");
  } catch (e) { toast("Erro: " + e.message); }
};

$("loginBtn").onclick = async () => {
  if (!firebaseReady) return toast("Firebase ainda não configurado. Use modo demonstração.");
  try {
    await signInWithEmailAndPassword(auth, $("email").value, $("password").value);
  } catch (e) { toast("Erro: " + e.message); }
};

$("logoutBtn").onclick = async () => {
  if (firebaseReady && auth.currentUser) await signOut(auth);
  currentUser = null;
  showLogin();
};

if (firebaseReady) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) { await loadCloud(); showApp(); } else showLogin();
  });
} else {
  showLogin();
}

$("addTaskBtn").onclick = async () => {
  const val = $("taskInput").value.trim();
  if (!val) return;
  STATE.tasks.unshift({ title: val, done: false });
  $("taskInput").value = "";
  saveLocal();
  await syncCloud();
};

$("addHabitBtn").onclick = async () => {
  const val = $("habitInput").value.trim();
  if (!val) return;
  STATE.habits.unshift({ title: val, streak: 0, doneToday: false });
  $("habitInput").value = "";
  saveLocal();
  await syncCloud();
};

$("addIncomeBtn").onclick = () => addFinance(1);
$("addExpenseBtn").onclick = () => addFinance(-1);
async function addFinance(sign) {
  const desc = $("financeDesc").value.trim() || "Lançamento";
  const value = Math.abs(Number($("financeValue").value || 0)) * sign;
  if (!value) return toast("Informe um valor.");
  STATE.finances.unshift({ desc, value });
  $("financeDesc").value = "";
  $("financeValue").value = "";
  saveLocal();
  await syncCloud();
}

$("sendAiBtn").onclick = async () => {
  const text = $("aiInput").value.trim();
  if (!text) return;
  $("aiInput").value = "";
  STATE.chat.push({ role: "user", text });
  renderChat();

  if (!window.AI_ENDPOINT) {
    const reply = "Integração visual pronta. Para IA real, configure window.AI_ENDPOINT em firebase-config.js apontando para um backend seguro.";
    STATE.chat.push({ role: "ai", text: reply });
    saveLocal();
    return;
  }

  try {
    const res = await fetch(window.AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, state: STATE })
    });
    const data = await res.json();
    STATE.chat.push({ role: "ai", text: data.reply || "Sem resposta." });
  } catch {
    STATE.chat.push({ role: "ai", text: "Não consegui acessar o endpoint da IA." });
  }
  saveLocal();
};

$("notifyBtn").onclick = async () => {
  if (!("Notification" in window)) return toast("Este navegador não suporta notificações.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("Assistente IA", { body: "Notificações ativadas com sucesso.", icon: "icons/icon-192.png" });
  } else {
    toast("Permissão de notificação negada.");
  }
};

$("syncBtn").onclick = async () => { await syncCloud(); toast("Sincronização processada."); };

function render() {
  $("taskCount").textContent = STATE.tasks.length;
  const doneHabits = STATE.habits.filter(h => h.doneToday).length;
  $("habitRate").textContent = STATE.habits.length ? Math.round(doneHabits / STATE.habits.length * 100) + "%" : "0%";
  const total = STATE.finances.reduce((s, f) => s + Number(f.value), 0);
  $("monthBalance").textContent = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  $("financeTotal").textContent = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  $("taskList").innerHTML = STATE.tasks.map((t,i)=>`
    <article class="module" data-task="${i}">
      <div class="mi">${t.done ? "✓" : "○"}</div><div><h4>${t.title}</h4><p>${t.done ? "Concluída" : "Pendente"}</p></div><span class="badge">${t.done ? "OK" : "Aberta"}</span>
    </article>`).join("");
  document.querySelectorAll("[data-task]").forEach(el=>el.onclick=async()=>{ const i=+el.dataset.task; STATE.tasks[i].done=!STATE.tasks[i].done; saveLocal(); await syncCloud(); });

  $("habitList").innerHTML = STATE.habits.map((h,i)=>`
    <article class="module" data-habit="${i}">
      <div class="mi">${h.doneToday ? "🔥" : "◎"}</div><div><h4>${h.title}</h4><p>Sequência: ${h.streak} dias</p></div><span class="badge">${h.doneToday ? "Hoje OK" : "Hoje?"}</span>
    </article>`).join("");
  document.querySelectorAll("[data-habit]").forEach(el=>el.onclick=async()=>{ const i=+el.dataset.habit; STATE.habits[i].doneToday=!STATE.habits[i].doneToday; if(STATE.habits[i].doneToday) STATE.habits[i].streak++; saveLocal(); await syncCloud(); });

  $("financeList").innerHTML = STATE.finances.map(f=>`
    <article class="module"><div class="mi">${f.value>=0 ? "↗" : "↘"}</div><div><h4>${f.desc}</h4><p>${Number(f.value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p></div><span class="badge">${f.value>=0 ? "Receita" : "Despesa"}</span></article>`).join("");

  renderChat();
}

function renderChat() {
  $("chatBox").innerHTML = `<div class="msg ai">Olá, Fabio. Posso analisar tarefas, finanças, hábitos e projetos.</div>` +
    STATE.chat.map(m => `<div class="msg ${m.role === "user" ? "user" : "ai"}">${m.text}</div>`).join("");
  $("chatBox").scrollTop = $("chatBox").scrollHeight;
}

const last = localStorage.getItem("lastScreenV2");
if (last && document.getElementById(last)) openScreen(last);
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(console.error));
}
