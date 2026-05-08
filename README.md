# Assistente IA Premium V3.6 Voz

Melhorias aplicadas:

- Correção do login/entrada no aplicativo: `appScreen` agora é chamado corretamente.
- Correção do botão de enviar mensagem para a IA.
- Botão de voltar para a tela inicial em Tarefas, Financeiro, Hábitos, Modo Foco, IA e Configurações.
- Botão de voz na IA usando reconhecimento de fala do navegador.
- Comandos locais por voz/texto para criar tarefas, registrar despesas e registrar receitas.
- Resposta por áudio com síntese de voz quando o comando é falado.
- Correção dos cards do dashboard e dos insights automáticos.
- Exclusão/edição de tarefas, receitas, despesas e hábitos funcionando.
- Exportação/importação de backup JSON.
- Aviso quando os dados estiverem apenas locais.
- Service Worker atualizado para V3.6, evitando cache antigo.

Exemplos de comandos por voz:

- "Crie uma tarefa comprar etiquetas amanhã"
- "Registre despesa de 35 reais com acrílico"
- "Registre receita de 120 reais venda de pudim"
- "Analise meu dia"

Observação importante:

O reconhecimento de voz funciona melhor no Chrome Android e normalmente precisa de HTTPS ou localhost. Se abrir direto por arquivo local, o microfone pode não funcionar por regra do navegador.
