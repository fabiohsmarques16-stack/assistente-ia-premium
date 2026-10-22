# SANJA Gestão — Arquitetura proposta (v0, antes da implementação)

Documento de planejamento. Nada aqui foi implementado ainda; serve para validar as decisões e as regras comerciais antes de programar.

## 1. Visão geral

```
 Celular / Computador (PWA)            Telegram (bot privado)
        │  React + Vite                       │  mensagens do proprietário
        │                                     ▼
        │                         Edge Function "telegram-webhook"
        │                           ├─ verifica usuário autorizado
        │                           ├─ chama a IA (Claude) com ferramentas
        │                           └─ guarda confirmações pendentes
        ▼                                     │
 ┌──────────────────────── Supabase ───────────────────────────────┐
 │ Auth (login)  ·  PostgreSQL  ·  RLS  ·  Edge Functions (Deno)   │
 │                                                                  │
 │  Funções de negócio no banco (RPC, transacionais e validadas):   │
 │  registrar_compra · criar_pedido · confirmar_pedido ·            │
 │  confirmar_producao · registrar_pagamento · registrar_perda ·    │
 │  ajustar_estoque · lista_compras · relatorio_periodo ...         │
 │                                                                  │
 │  Tabela de auditoria preenchida por gatilhos (quem, quando, o quê)│
 └──────────────────────────────────────────────────────────────────┘
```

Princípio central: **toda regra de negócio fica em um único lugar — funções do PostgreSQL**. O app e o bot chamam as mesmas funções, então os cálculos são idênticos nos dois canais e os dados sincronizam sozinhos (é o mesmo banco). A IA nunca escreve SQL: ela só pode escolher entre ferramentas fixas, cada uma ligada a uma dessas funções, com parâmetros validados.

## 2. Tecnologias

| Camada | Escolha | Motivo |
|---|---|---|
| Interface | React + Vite + `vite-plugin-pwa`, TypeScript | PWA instalável, manutenção simples |
| Hospedagem do app | Cloudflare Pages (ou Vercel/Netlify) | Gratuito, HTTPS automático |
| Banco | Supabase PostgreSQL | SQL de verdade, Auth incluso, RLS |
| Backend | Funções SQL (RPC) + Supabase Edge Functions | Sem servidor para manter |
| Bot | Telegram Bot API via webhook | Gratuito |
| IA | API da Anthropic (Claude) com *tool use* | Interpreta a mensagem e escolhe a ferramenta |
| Segredos | Variáveis secretas das Edge Functions | Chaves nunca vão para o navegador |
| Testes | pgTAP (SQL) + Vitest (TypeScript) | Testam cálculos onde eles moram |

WhatsApp no futuro: o webhook do Telegram é só um "adaptador de canal". O núcleo (IA + ferramentas + confirmações) é independente do canal, então um adaptador do WhatsApp Cloud API entra depois sem mudar o resto.

## 3. Modelo de dados (resumo)

Unidades **base** no banco: `g`, `ml` e `un`. Tudo que entra em kg/litro é convertido (×1000) na gravação; preços ficam normalizados por unidade base (R$/g, R$/ml, R$/un), o que permite comparar compras de embalagens diferentes.

- `ingredientes` — nome, marca, unidade base, tamanho da embalagem padrão, estoque mínimo, tipo (ingrediente / embalagem / tampa / adesivo).
- `fornecedores`.
- `compras` — data, ingrediente, fornecedor, nº de embalagens, tamanho da embalagem, preço unitário e total, validade. Histórico permanente → menor, maior, média simples e média ponderada.
- `movimentos_estoque` — **livro-razão**: entrada (compra), consumo (produção), perda, ajuste. O estoque físico é a soma dos movimentos; nunca um número editado à mão. Ajustes e perdas exigem justificativa.
- `sabores` — Tradicional, Ninho, Doce de Leite, Brigadeiro, Chocolate e futuros.
- `receitas` + `receita_versoes` + `receita_itens` — cada alteração cria uma nova versão; pedidos e produções guardam a versão usada, então custos históricos não mudam.
- `clientes` — tipo (varejo / revenda).
- `pedidos` + `pedido_itens` + `pagamentos` — status, datas, preços, desconto, recebido, saldo.
- `producoes` — sabor, quantidade, versão da receita, pedido(s) atendido(s).
- `configuracoes` — preços, mínimos, múltiplo de produção (editáveis).
- `despesas_operacionais` — para lucro líquido (só aparece quando houver despesas cadastradas).
- `auditoria`, `usuarios_autorizados` (inclui `telegram_id`), `bot_confirmacoes_pendentes`.

### Reserva sem descontar duas vezes

A reserva **não é gravada como movimento**; é calculada: necessidade de ingredientes dos pedidos *confirmados ou em produção* que ainda não tiveram produção registrada. Ao confirmar a produção, grava-se o consumo físico e aquele pedido deixa de contar na reserva — automaticamente, sem risco de baixa dupla.

```
disponível_livre = estoque_físico − reservado
comprar = max(0, necessidade + estoque_mínimo − (estoque_físico − reservado_outros))
          → arredondado para embalagens inteiras
```

### Custo

Custo de cada produção calculado pela **média ponderada móvel** dos preços de compra no momento da produção (sugestão; ver pergunta 7) e congelado no registro da produção.

## 4. Bot do Telegram com IA

1. Mensagem chega → confere `telegram_id` na lista de autorizados (outros são ignorados).
2. A IA recebe a mensagem, o contexto curto da conversa e a lista de ferramentas (ex.: `registrar_compra`, `criar_pedido`, `consultar_faturamento`, `clientes_com_saldo`, `lista_compras`, `registrar_producao`).
3. Ferramentas de **consulta** executam direto e a IA responde com os números reais.
4. Ferramentas de **alteração** não gravam de imediato: geram um resumo ("Registrar compra: 10 × Leite condensado 395 g, R$ 5,40 cada, total R$ 54,00 — confirmar?") com botões ✅/❌. Só o clique grava.
5. Faltou dado (ex.: tamanho da embalagem, data de entrega ambígua) → a IA pergunta, nunca inventa.
6. Possível duplicidade (compra igual registrada há pouco) → alerta antes de confirmar.

## 5. Custos recorrentes estimados

Estimativa para uso de uma pequena empresa: ~30 mensagens/dia no bot (~900/mês), cada uma com 1–2 chamadas de ferramenta (~6 mil tokens de entrada e ~500 de saída por mensagem).

| Item | Opção econômica | Opção recomendada |
|---|---|---|
| Supabase | Free — US$ 0 (500 MB; projeto pausa após 7 dias sem uso; **sem backup automático**) | Pro — US$ 25/mês (backups diários) |
| Hospedagem do app | Cloudflare Pages — US$ 0 | US$ 0 |
| Telegram | US$ 0 | US$ 0 |
| IA — Claude Haiku 5.5 (US$ 0,10 / 0,50 por milhão de tokens) | ≈ US$ 1/mês | — |
| IA — Claude Sonnet 5.5 (US$ 2 / 10) | — | ≈ US$ 8–15/mês |
| IA — Claude Opus 5.5 (US$ 4 / 20) | — | ≈ US$ 15–30/mês |
| Domínio próprio (opcional) | — | ≈ R$ 40–60/ano |
| **Total** | **≈ US$ 1/mês** | **≈ US$ 35–55/mês** |

Notas: valores de IA são estimativas de ordem de grandeza (cache de prompt reduz bastante a entrada); preços do Supabase devem ser conferidos na página oficial no momento da contratação. No plano Free, o backup fica por nossa conta: um GitHub Action diário com `pg_dump` resolve sem custo.

## 6. Etapas de implementação

1. **Fundação** — projeto Supabase, migrações, Auth, RLS, auditoria, configurações; esqueleto do PWA com login e menus.
2. **Ingredientes e compras** — cadastro, histórico, normalização de unidades, estatísticas de preço, estoque mínimo.
3. **Receitas** — sabores, versões, custo por copo (ingredientes + calda + copo + tampa + adesivo).
4. **Pedidos, reservas e produção** — status, regras de varejo/revenda, múltiplos de 8, reserva calculada, baixa na produção, perdas e ajustes.
5. **Lista de compras** inteligente.
6. **Relatórios e painel** — indicadores, gráficos, comparação de períodos, CSV/PDF.
7. **Bot do Telegram + IA** — ferramentas, confirmações, autorização.
8. **Backup/restauração, documentação de implantação e instalação no Android/PC.**

Cada etapa vem com testes dos cálculos (estoque, reserva, custo, lista de compras, financeiro).
