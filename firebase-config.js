// Configure aqui o Firebase quando quiser sincronização real em nuvem.
// 1) Crie um projeto em https://console.firebase.google.com
// 2) Ative Authentication por e-mail/senha
// 3) Ative Firestore Database
// 4) Cole abaixo as credenciais do app web

window.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// IA: nunca coloque sua chave da OpenAI direto no app.
// Use um backend seguro. Exemplo: Cloudflare Worker, Firebase Function ou servidor Node.
window.AI_ENDPOINT = "";
