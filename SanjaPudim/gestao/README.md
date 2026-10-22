# SANJA Gestão

Sistema de gestão da Sanja Pudim: estoque, receitas, compras, pedidos, produção, vendas e relatórios.
App instalável (PWA) para celular e computador, com dados no Supabase (PostgreSQL).
O bot do Telegram com IA é a próxima etapa e usará as mesmas funções do banco.

```
gestao/
├── supabase/
│   ├── migrations/   esquema, regras de negócio, relatórios, segurança e dados iniciais
│   └── tests/        84 testes das regras (estoque, reservas, produção, pedidos, financeiro, segurança)
├── web/              aplicativo PWA (React + Vite)
└── ops/              backup diário e restauração
```

## Como o sistema funciona

- **Toda regra de negócio fica no banco**, em funções validadas (`registrar_compra`, `criar_pedido`,
  `registrar_producao`, `lista_compras`…). App e bot usam as mesmas funções, então os números são iguais nos dois.
- **Estoque é um livro de movimentos**: compras, consumo na produção, perdas e ajustes (com justificativa).
  Compras e movimentos nunca são apagados.
- **Pedido confirmado reserva ingredientes**, mas não desconta. A baixa física acontece ao registrar a produção.
  A reserva é calculada a partir dos pedidos que ainda faltam produzir, então não existe baixa dupla.
- **Pudins prontos têm estoque próprio**: pedido cancelado depois de produzido devolve os pudins como
  estoque pronto, que é usado automaticamente no próximo pedido confirmado do mesmo sabor.
- **Receitas têm versões**: cada alteração cria uma versão nova; produções antigas mantêm o custo da época.
- **Custo pela média ponderada móvel** das compras; preços normalizados por kg, litro ou unidade.
- **Auditoria**: toda alteração fica registrada com data, usuário e canal (app ou bot).

## Regras comerciais (editáveis em Configurações)

| Regra | Valor inicial |
|---|---|
| Preço varejo (venda direta) | R$ 15,00 por copo |
| Preço revenda | R$ 9,50 por copo |
| Pedido mínimo varejo | 8 unidades |
| Pedido mínimo revenda | 24 unidades (1 caixa, sabores podem ser mesclados) |
| Quantidade por sabor | múltiplos de 8 (cada receita rende 8 copos) |
| Pedido "sem logo" | não usa o adesivo de logo |
| Pagamento | Pix, sem taxa de entrega, sem desconto |

Exceções às regras são aceitas quando o motivo é informado, e ficam registradas no pedido.

---

## 1. Criar o banco no Supabase

1. Crie uma conta em <https://supabase.com> e um projeto novo (região **South America (São Paulo)**).
   Guarde a senha do banco.
2. Aplique as migrações, **em ordem**, por um destes caminhos:
   - **Pelo painel**: *SQL Editor* → *New query* → cole o conteúdo de cada arquivo de
     `supabase/migrations/` (do `…001` ao `…005`) e clique em *Run*.
   - **Pela linha de comando**: instale a [Supabase CLI](https://supabase.com/docs/guides/cli), depois
     ```bash
     cd SanjaPudim/gestao
     supabase link --project-ref SEU-PROJETO
     supabase db push
     ```
3. Crie o seu login: *Authentication* → *Users* → *Add user* (e-mail e senha, marque *Auto confirm*).
4. Autorize esse login no sistema. Copie o *User UID* do usuário criado e rode no *SQL Editor*:
   ```sql
   insert into usuarios (nome, auth_user_id) values ('Seu nome', 'COLE-O-USER-UID-AQUI');
   ```
5. Desative cadastro público: *Authentication* → *Sign In / Providers* → desligue *Allow new users to sign up*.

## 2. Publicar o aplicativo (Cloudflare Pages, gratuito)

1. Crie uma conta em <https://pages.cloudflare.com> e conecte o repositório do GitHub.
2. Configure o build:
   - *Root directory*: `SanjaPudim/gestao/web`
   - *Build command*: `npm ci && npm run build`
   - *Build output directory*: `dist`
3. Em *Environment variables*, adicione (valores em Supabase → *Project Settings* → *API*):
   - `VITE_SUPABASE_URL` = URL do projeto
   - `VITE_SUPABASE_ANON_KEY` = chave **anon / publishable** (nunca a `service_role`)
4. Publique. O endereço fica parecido com `https://sanja-gestao.pages.dev`.

> A chave *anon* é pública por natureza; quem protege os dados são as regras do banco
> (login obrigatório + lista de usuários autorizados + permissões por tabela).

Para rodar no próprio computador: `cd web && cp .env.example .env.local` (preencha), `npm install`, `npm run dev`.

## 3. Instalar no celular e no computador

**Android (Chrome)**: abra o endereço do app → menu ⋮ → **Instalar app** (ou *Adicionar à tela inicial*).
O ícone da Sanja aparece junto dos outros apps e abre em tela cheia.

**iPhone (Safari)**: botão Compartilhar → **Adicionar à Tela de Início**.

**Computador (Chrome ou Edge)**: abra o endereço → ícone de instalar na barra de endereço (⊕) → **Instalar**.
O app ganha atalho no menu Iniciar / Dock.

Os dados não ficam presos no aparelho: tudo é lido e gravado no Supabase, então celular, computador
e (em breve) o bot veem as mesmas informações em tempo real. É preciso internet para usar.

## 4. Primeiros passos no app

1. **Estoque → Editar** cada item para definir o **estoque mínimo** e o tamanho de embalagem que faltar
   (ovos, leite, leite em pó, copos, tampas e adesivos estão sem tamanho de embalagem).
2. **Compras → Registrar compra** para lançar o estoque atual como compras (com preço, para o custo ficar certo).
   Se algo já está em casa e você não sabe o preço, use **Estoque → Perda / ajuste** com tipo *Ajuste*.
3. **Receitas**: cadastre a **Calda** (ingredientes e quantos copos um lote atende) e as receitas de
   **Brigadeiro** e **Chocolate**. Enquanto não houver receita, esses sabores aparecem com aviso e não entram
   na lista de compras.
4. **Pedidos → + Novo pedido**: cliente, sabores em múltiplos de 8, marque "sem logo" quando pedido.

## 5. Backup e recuperação

O Supabase gratuito **não faz backup automático**. Duas opções:

**A. Backup diário gratuito pelo GitHub (recomendado para começar)**
1. Copie `ops/backup-diario.yml` para `.github/workflows/backup-diario.yml` na raiz do repositório.
2. No GitHub: *Settings* → *Secrets and variables* → *Actions* → crie:
   - `SUPABASE_DB_URL`: Supabase → *Connect* → *Session pooler* → URI (com a senha do banco)
   - `BACKUP_SENHA`: uma senha forte, guardada em lugar seguro (sem ela o backup não abre)
3. Todo dia às 03:17 é gerado um arquivo criptografado, guardado por 90 dias em
   *Actions* → *Backup diário* → execução → *Artifacts*. Dá para rodar na hora em *Run workflow*.

**B. Supabase Pro (US$ 25/mês)**: backups diários automáticos com restauração pelo painel.
Vale a pena quando o faturamento justificar.

**Restaurar** (testado: dados, auditoria e regras de segurança voltam completos):
1. Crie um projeto Supabase novo e vazio (não aplique as migrações).
2. Baixe o arquivo `.dump.gpg` do backup desejado.
3. Num computador com `psql`/`pg_restore` 17 e `gpg`:
   ```bash
   ops/restaurar.sh sanja-2026-10-22.dump.gpg "postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
   ```
   (vai pedir a `BACKUP_SENHA`).
4. Recrie o login (passo 1.3) e a autorização (1.4) — os usuários de login não fazem parte do backup —,
   e troque `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` no Cloudflare para o projeto novo.

Além disso, Relatórios e Lista de compras exportam CSV e PDF a qualquer momento.

## 6. Testes

As regras de negócio têm 84 testes automáticos rodando contra um PostgreSQL de verdade:

```bash
SanjaPudim/gestao/supabase/tests/run.sh      # precisa de PostgreSQL 16+ instalado (initdb, pg_ctl, psql)
```

Cobrem: unidades e conversões; compras, custo médio e estatísticas de preço; perdas e ajustes;
receitas, versões e custo por copo; regras de pedido (múltiplos, mínimos, exceções, preço congelado);
reservas sem baixa dupla; lista de compras com embalagens inteiras e estoque mínimo; produção e baixa;
pedido sem logo; pagamentos e saldo; entrega; cancelamento com volta ao estoque pronto; relatórios
(faturamento, lucro bruto, lucro líquido só com despesas); permissões e auditoria.

## Custos mensais estimados

| Item | Custo |
|---|---|
| Supabase Free + backup pelo GitHub | US$ 0 |
| Cloudflare Pages | US$ 0 |
| Telegram | US$ 0 |
| IA (Claude) para o bot — próxima etapa | ≈ US$ 15–30 com o modelo mais capaz; ≈ US$ 1 com o mais econômico |
| Opcional: Supabase Pro / domínio próprio | US$ 25 / ≈ R$ 50 por ano |

No plano Free, um projeto sem nenhum acesso por 7 dias é pausado (os dados não se perdem; basta reativar
no painel). Com uso diário isso não acontece.
