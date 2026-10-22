-- SANJA Gestão — esquema principal
-- Unidades base no banco: g, ml, un. kg e litro são convertidos (x1000) na entrada.
-- Estoque físico = soma de movimentos_estoque (livro-razão). Nunca é editado diretamente.

create type unidade_base as enum ('g', 'ml', 'un');
create type tipo_item as enum ('ingrediente', 'embalagem');
create type tipo_cliente as enum ('varejo', 'revenda');
create type status_pedido as enum ('solicitado', 'confirmado', 'em_producao', 'pronto', 'entregue', 'cancelado');
create type tipo_movimento as enum ('compra', 'consumo', 'perda', 'ajuste');
create type tipo_movimento_pronto as enum ('producao', 'entrega', 'perda', 'ajuste');
create type tipo_receita as enum ('pudim', 'calda');

-- Configurações comerciais (linha única, id = 1)
create table configuracoes (
  id                  int primary key default 1 check (id = 1),
  preco_varejo        numeric(12,2) not null default 15.00 check (preco_varejo >= 0),
  preco_revenda       numeric(12,2) not null default 9.50  check (preco_revenda >= 0),
  minimo_varejo       int not null default 8  check (minimo_varejo >= 0),
  minimo_revenda      int not null default 24 check (minimo_revenda >= 0),
  multiplo_producao   int not null default 8  check (multiplo_producao > 0),
  capacidade_caixa    int not null default 24 check (capacidade_caixa > 0),
  forma_pagamento_padrao text not null default 'pix',
  atualizado_em       timestamptz not null default now()
);
insert into configuracoes (id) values (1);

-- Usuários autorizados (app e bot)
create table usuarios (
  id            bigint generated always as identity primary key,
  nome          text not null,
  auth_user_id  uuid unique,          -- usuário do Supabase Auth (login no app)
  telegram_id   bigint unique,        -- id numérico do Telegram (bot)
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table fornecedores (
  id        bigint generated always as identity primary key,
  nome      text not null unique,
  contato   text,
  criado_em timestamptz not null default now()
);

create table ingredientes (
  id              bigint generated always as identity primary key,
  nome            text not null,
  marca           text,
  tipo            tipo_item not null default 'ingrediente',
  unidade         unidade_base not null,
  embalagem_qtd   numeric(14,4) check (embalagem_qtd > 0),  -- tamanho da embalagem comercial, em unidade base
  estoque_minimo  numeric(14,4) not null default 0 check (estoque_minimo >= 0),
  custo_medio     numeric(14,6) not null default 0,         -- R$ por unidade base (média ponderada móvel)
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);
create unique index ingredientes_nome_marca_uq on ingredientes (lower(nome), lower(coalesce(marca, '')));

create table compras (
  id                 bigint generated always as identity primary key,
  ingrediente_id     bigint not null references ingredientes(id),
  fornecedor_id      bigint references fornecedores(id),
  marca              text,
  data_compra        date not null default current_date,
  qtd_embalagens     numeric(14,4) not null check (qtd_embalagens > 0),
  qtd_por_embalagem  numeric(14,4) not null check (qtd_por_embalagem > 0),  -- em unidade base
  preco_unitario     numeric(12,4) not null check (preco_unitario >= 0),    -- por embalagem
  preco_total        numeric(12,2) not null check (preco_total >= 0),
  quantidade_total   numeric(14,4) generated always as (qtd_embalagens * qtd_por_embalagem) stored,
  preco_por_unidade  numeric(14,6) generated always as (preco_total / (qtd_embalagens * qtd_por_embalagem)) stored,
  validade           date,
  observacao         text,
  criado_em          timestamptz not null default now()
);
create index compras_ingrediente_idx on compras (ingrediente_id, data_compra);

create table sabores (
  id        bigint generated always as identity primary key,
  nome      text not null unique,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table receitas (
  id        bigint generated always as identity primary key,
  nome      text not null unique,
  tipo      tipo_receita not null,
  sabor_id  bigint unique references sabores(id),   -- uma receita de pudim por sabor
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  check ((tipo = 'pudim') = (sabor_id is not null))
);

-- Cada alteração de receita cria uma nova versão; produções guardam a versão usada.
create table receita_versoes (
  id               bigint generated always as identity primary key,
  receita_id       bigint not null references receitas(id),
  versao           int not null,
  rendimento       numeric(14,4) not null check (rendimento > 0), -- copos por lote
  receita_calda_id bigint references receitas(id),                -- calda usada (lote separado)
  vigente          boolean not null default true,
  observacao       text,
  criado_em        timestamptz not null default now(),
  unique (receita_id, versao)
);
create unique index receita_versao_vigente_uq on receita_versoes (receita_id) where vigente;

create table receita_itens (
  id              bigint generated always as identity primary key,
  versao_id       bigint not null references receita_versoes(id),
  ingrediente_id  bigint not null references ingredientes(id),
  quantidade      numeric(14,4) not null check (quantidade > 0),  -- por lote, em unidade base
  opcional_codigo text,          -- ex.: 'logo' → item retirado quando o pedido pede "sem logo"
  unique (versao_id, ingrediente_id)
);

create table clientes (
  id         bigint generated always as identity primary key,
  nome       text not null,
  tipo       tipo_cliente not null default 'varejo',
  telefone   text,
  observacao text,
  criado_em  timestamptz not null default now()
);
create index clientes_nome_idx on clientes (lower(nome));

create table pedidos (
  id              bigint generated always as identity primary key,
  cliente_id      bigint not null references clientes(id),
  tipo            tipo_cliente not null,
  data_pedido     date not null default current_date,
  data_entrega    date,
  status          status_pedido not null default 'solicitado',
  desconto        numeric(12,2) not null default 0 check (desconto >= 0),
  excecao_motivo  text,          -- preenchido quando uma regra comercial foi dispensada
  observacao      text,
  entregue_em     timestamptz,
  criado_em       timestamptz not null default now()
);
create index pedidos_status_idx on pedidos (status, data_entrega);

create table pedido_itens (
  id             bigint generated always as identity primary key,
  pedido_id      bigint not null references pedidos(id) on delete cascade,
  sabor_id       bigint not null references sabores(id),
  quantidade     int not null check (quantidade > 0),
  preco_unitario numeric(12,2) not null check (preco_unitario >= 0),
  sem_logo       boolean not null default false,
  unique (pedido_id, sabor_id, sem_logo)
);

create table pagamentos (
  id          bigint generated always as identity primary key,
  pedido_id   bigint not null references pedidos(id),
  valor       numeric(12,2) not null check (valor > 0),
  forma       text not null default 'pix',
  data        date not null default current_date,
  observacao  text,
  criado_em   timestamptz not null default now()
);

create table producoes (
  id              bigint generated always as identity primary key,
  sabor_id        bigint not null references sabores(id),
  versao_id       bigint not null references receita_versoes(id),
  quantidade      int not null check (quantidade > 0),
  sem_logo        boolean not null default false,
  pedido_id       bigint references pedidos(id),
  custo_total     numeric(12,2) not null,      -- congelado no momento da produção
  custo_unitario  numeric(12,4) not null,
  data            date not null default current_date,
  observacao      text,
  criado_em       timestamptz not null default now()
);

create table movimentos_estoque (
  id              bigint generated always as identity primary key,
  ingrediente_id  bigint not null references ingredientes(id),
  tipo            tipo_movimento not null,
  quantidade      numeric(14,4) not null check (quantidade <> 0),  -- + entrada / − saída
  custo_unitario  numeric(14,6),
  compra_id       bigint references compras(id),
  producao_id     bigint references producoes(id),
  justificativa   text,
  data            date not null default current_date,
  criado_em       timestamptz not null default now(),
  check (tipo not in ('perda', 'ajuste') or coalesce(trim(justificativa), '') <> '')
);
create index movimentos_ingrediente_idx on movimentos_estoque (ingrediente_id);

-- Estoque de pudins prontos (sem controle de validade)
create table movimentos_pronto (
  id            bigint generated always as identity primary key,
  sabor_id      bigint not null references sabores(id),
  tipo          tipo_movimento_pronto not null,
  quantidade    int not null check (quantidade <> 0),
  producao_id   bigint references producoes(id),
  pedido_id     bigint references pedidos(id),
  justificativa text,
  data          date not null default current_date,
  criado_em     timestamptz not null default now(),
  check (tipo not in ('perda', 'ajuste') or coalesce(trim(justificativa), '') <> '')
);

-- Pudins prontos destinados a um pedido (vindos de produção ou do estoque pronto)
create table alocacoes (
  id          bigint generated always as identity primary key,
  pedido_id   bigint not null references pedidos(id),
  sabor_id    bigint not null references sabores(id),
  quantidade  int not null check (quantidade > 0),
  sem_logo    boolean not null default false,
  producao_id bigint references producoes(id),
  criado_em   timestamptz not null default now()
);
create index alocacoes_pedido_idx on alocacoes (pedido_id);

-- Despesas operacionais (necessárias para lucro líquido)
create table despesas (
  id         bigint generated always as identity primary key,
  descricao  text not null,
  categoria  text,
  valor      numeric(12,2) not null check (valor > 0),
  data       date not null default current_date,
  criado_em  timestamptz not null default now()
);

-- Auditoria de todas as alterações
create table auditoria (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  operacao     text not null,
  registro_id  bigint,
  antes        jsonb,
  depois       jsonb,
  usuario      text,
  canal        text,
  em           timestamptz not null default now()
);

-- Confirmações pendentes do bot (resumo mostrado antes de gravar)
create table bot_confirmacoes (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  acao        text not null,
  parametros  jsonb not null,
  resumo      text not null,
  status      text not null default 'pendente' check (status in ('pendente', 'confirmada', 'cancelada', 'expirada')),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '30 minutes'
);

-- Histórico curto da conversa do bot
create table bot_mensagens (
  id          bigint generated always as identity primary key,
  telegram_id bigint not null,
  papel       text not null check (papel in ('user', 'assistant')),
  conteudo    text not null,
  criado_em   timestamptz not null default now()
);
create index bot_mensagens_idx on bot_mensagens (telegram_id, criado_em desc);
