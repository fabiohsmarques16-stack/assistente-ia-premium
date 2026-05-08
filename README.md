# Assistente IA Premium V3.7

## Melhorias desta versão (V3.7)

### Correções de bugs
- **Reset diário de hábitos**: hábitos agora são automaticamente desmarcados à meia-noite. O campo `lastCheckedDate` rastreia quando cada hábito foi concluído, garantindo que o streak só cresça quando marcado num novo dia.
- **Aviso de microfone**: quando o reconhecimento de voz não está disponível, o botão exibe tooltip e toast explicativo ao clicar, em vez de apenas ficar desabilitado sem explicação.
- **Pasta de ícones**: ícones corretamente em `icons/icon-192.png` e `icons/icon-512.png`.

### Novas funcionalidades
- **Endpoint da IA configurável na interface**: Configurações > IA externa, sem precisar editar código.
- **Fechar modal com Escape** e clicando no fundo escuro.
- **Confirmação para limpar chat**: evita limpeza acidental.
- **Label de data nos hábitos**: cabeçalho mostra o dia atual.
- **Resposta local mais informativa**: IA explica todos os comandos disponíveis.

### Design
- Tipografia: Syne (títulos) + DM Sans (corpo) via Google Fonts
- Animações de entrada aprimoradas (modais, chat, telas)
- Hover states nos cards e módulos
- Toast com animação de slide

## Estrutura de arquivos
```
/
├── index.html
├── app.js
├── style.css
├── firebase-config.js
├── service-worker.js
├── manifest.json
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

> Os ícones DEVEM estar na pasta `icons/`. Se estiverem na raiz, mova-os.

## Exemplos de comandos
- "Crie uma tarefa comprar etiquetas amanhã"
- "Registre despesa de 35 reais com acrílico"
- "Registre receita de 120 reais venda de pudim"
- "Analise meu dia"

## Notas
- Reconhecimento de voz: Chrome Android em HTTPS ou localhost.
- Para IA avançada: configure o Endpoint em Configurações > IA externa.
- Regras do Firestore devem restringir acesso por uid.
