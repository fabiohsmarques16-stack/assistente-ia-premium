# Assistente IA V4 Completo

Versão reconstruída a partir da V3.7 enviada. O projeto agora inclui layout mais profissional, ícone IA, PWA, tela inicial, voz, IA local, IA externa opcional, tarefas avançadas, financeiro com metas, hábitos com calendário, notificações, backup JSON, CSV/PDF e regras do Firestore.

## Recursos principais
- Login por e-mail/senha e Google via Firebase.
- Modo local/demonstração funcional.
- IA local por comandos: criar tarefa, despesa, receita e análise do dia.
- IA real opcional: OpenAI, Anthropic ou endpoint próprio.
- Comando de voz no Chrome Android em HTTPS/localhost.
- Tarefas com subtarefas, tags, recorrência, prazo e arrastar para reordenar.
- Financeiro com despesas/receitas, contas, recorrência, meta de economia, limite de gastos, gráficos, CSV e PDF.
- Hábitos com frequência, lembrete e calendário de consistência.
- Notificações reais quando autorizadas pelo navegador.
- Tema claro/escuro.
- Histórico para desfazer exclusões.
- Manifest com atalhos: Nova tarefa, Registrar despesa e IA.
- Service worker para instalar como PWA.

## Como instalar no celular
1. Publique a pasta em um endereço HTTPS, GitHub Pages ou Firebase Hosting.
2. Abra pelo Chrome Android.
3. Toque nos três pontos do navegador.
4. Use **Adicionar à tela inicial** ou **Instalar app**.

> Em arquivo local `file://`, o PWA e o microfone podem não funcionar corretamente. Use HTTPS ou localhost.

## Firebase
O arquivo `firebase-config.js` já veio do projeto enviado. No console Firebase:
1. Ative Authentication por e-mail/senha.
2. Ative Google Login se quiser usar o botão Google.
3. Ative Firestore.
4. Copie o conteúdo de `firestore.rules` para as regras do Firestore e publique.

## IA direta no app
Configurações > IA real:
- Local: não usa API.
- OpenAI direto: usa chave no navegador.
- Anthropic direto: usa chave no navegador.
- Endpoint próprio: URL de backend que receba `{ message, data }` e retorne `{ reply }`.

Atenção: chave API dentro do navegador fica exposta. Para uso comercial, use backend próprio.


## Atualização V4.1 — itens finais adicionados
- Detecção e tela de resolução de conflito entre dados locais e nuvem.
- Badge do app com quantidade de tarefas pendentes quando o navegador suporta `setAppBadge`.
- Backup criptografado com senha usando WebCrypto AES-GCM.
- Registro biométrico/WebAuthn quando o aparelho e navegador suportam.
- Botões de resolução de conflito em Configurações.

### Limites reais do navegador
- Push em segundo plano completo no Android exige Firebase Cloud Messaging/servidor de envio.
- OpenAI/Anthropic direto no navegador pode expor chave e sofrer bloqueio CORS; para produção, use backend.
- Biometria depende de HTTPS, Chrome/Android e suporte WebAuthn do aparelho.
