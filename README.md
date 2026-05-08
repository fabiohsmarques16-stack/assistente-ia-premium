# Assistente IA Premium V3.7 Voz Corrigido

Correções principais:
- remove importação estática do Firebase para evitar tela em branco quando a rede/CDN falha;
- navegação de retorno para Home em Tarefas, Financeiro, Hábitos, Foco e IA;
- comando de voz para criar tarefas, despesas e receitas;
- resposta por áudio usando SpeechSynthesis;
- service worker com novo cache v3.7 e estratégia network-first para GitHub Pages;
- proteção contra tela sem seção ativa.

## Importante para atualizar no GitHub Pages
Suba os arquivos de dentro desta pasta na RAIZ do repositório, não a pasta inteira.
Depois de publicar, abra no Chrome Android e acesse:
Configurações do site > Dados armazenados > Limpar dados.
Ou teste com `?v=37` no fim da URL.
