# Assistente IA Premium - PWA V2

Versão com estrutura para:
- Banco de dados local via localStorage
- Login com Firebase Authentication
- Sincronização em nuvem com Firebase Firestore
- IA integrada via endpoint seguro
- Notificações no Android/Chrome
- Dashboard profissional estilo Notion/ChatGPT/ClickUp

## Arquivos novos
- `firebase-config.js`: configure Firebase e endpoint da IA.
- `app.js`: lógica de login, banco, sincronização, IA e notificações.
- `service-worker.js`: cache offline.

## Importante sobre IA
Não coloque chave da OpenAI direto no aplicativo. Use backend seguro:
- Firebase Functions
- Cloudflare Worker
- Servidor Node.js

## Para publicar
Suba todos os arquivos no mesmo repositório GitHub Pages, substituindo a V1.

## Para usar sem Firebase
Use o botão "Entrar em modo demonstração". O app salva os dados localmente no celular.
