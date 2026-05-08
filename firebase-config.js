// Configure aqui o Firebase quando quiser sincronização real em nuvem.
// 1) Crie um projeto em https://console.firebase.google.com
// 2) Ative Authentication por e-mail/senha
// 3) Ative Firestore Database
// 4) Cole abaixo as credenciais do app web

<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyAPFCGphpAXmCDMvYfrnmT1aMyzV1UmcPk",
    authDomain: "assistente-pessoal-ia-6edc7.firebaseapp.com",
    projectId: "assistente-pessoal-ia-6edc7",
    storageBucket: "assistente-pessoal-ia-6edc7.firebasestorage.app",
    messagingSenderId: "64235509575",
    appId: "1:64235509575:web:0abdcb667f38acbead1e62"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
</script>

// IA: nunca coloque sua chave da OpenAI direto no app.
// Use um backend seguro. Exemplo: Cloudflare Worker, Firebase Function ou servidor Node.
window.AI_ENDPOINT = "";
