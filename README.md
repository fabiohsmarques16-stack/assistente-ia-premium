# Assistente IA Premium - PWA V1

Este projeto é a primeira versão visual instalável como PWA.

## Como testar no computador
Abra o arquivo `index.html` no navegador.

## Como instalar no Android
Para aparecer a opção de instalar corretamente, o app precisa rodar em servidor HTTPS ou local server.

Opção simples:
1. Coloque esta pasta em uma hospedagem, Netlify, Vercel ou GitHub Pages.
2. Abra o link no Chrome Android.
3. Toque em "Instalar app" ou nos 3 pontos > "Adicionar à tela inicial".

## Arquivos
- `index.html`: visual principal
- `app.js`: navegação, instalação e controle offline
- `manifest.json`: configuração PWA
- `service-worker.js`: cache offline
- `icons/`: ícones do app

## Próximo passo
Converter para APK com Capacitor.
