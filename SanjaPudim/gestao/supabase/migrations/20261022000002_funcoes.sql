-- SANJA Gestão — regras de negócio
-- Toda alteração comercial passa por estas funções (app e bot usam as mesmas).
-- Elas validam os dados, gravam em transação e geram auditoria via gatilhos.

----------------------------------------------------------------------
-- Autorização
----------------------------------------------------------------------
create or replace function sanja_papel() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

create or replace function sanja_autorizado() returns boolean
language sql stable security definer set search_path = public as $$
  select sanja_papel() = 'service_role'
      or exists (select 1 from usuarios u where u.auth_user_id = auth.uid() and u.ativo)
$$;

create or replace function sanja_exigir_autorizacao() returns void
language plpgsql stable as $$
begin
  if not sanja_autorizado() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;
end $$;

----------------------------------------------------------------------
-- Unidades
----------------------------------------------------------------------
-- Converte uma quantidade informada (g, kg, ml, l, un) para a unidade base do ingrediente.
create or replace function converter_unidade(p_qtd numeric, p_unidade text, p_base unidade_base)
returns numeric language plpgsql immutable as $$
declare
  u text := lower(trim(coalesce(p_unidade, p_base::text)));
begin
  if p_qtd is null then return null; end if;
  u := case u
         when 'litro' then 'l' when 'litros' then 'l' when 'lt' then 'l'
         when 'grama' then 'g' when 'gramas' then 'g'
         when 'quilo' then 'kg' when 'kilo' then 'kg'
         when 'unidade' then 'un' when 'unidades' then 'un' when 'und' then 'un'
         else u end;
  if p_base = 'g' and u = 'g'  then return p_qtd; end if;
  if p_base = 'g' and u = 'kg' then return p_qtd * 1000; end if;
  if p_base = 'ml' and u = 'ml' then return p_qtd; end if;
  if p_base = 'ml' and u = 'l'  then return p_qtd * 1000; end if;
  if p_base = 'un' and u = 'un' then return p_qtd; end if;
  raise exception 'Unidade "%" incompatível com a unidade do ingrediente (%).', p_unidade, p_base;
end $$;

----------------------------------------------------------------------
-- Consultas de apoio
----------------------------------------------------------------------
create or replace function estoque_fisico(p_ingrediente_id bigint) returns numeric
language sql stable as $$
  select coalesce(sum(quantidade), 0) from movimentos_estoque where ingrediente_id = p_ingrediente_id
$$;

-- Preço de referência por unidade base: custo médio; sem estoque, o da última compra.
create or replace function preco_referencia(p_ingrediente_id bigint) returns numeric
language sql stable as $$
  select coalesce(
    nullif((select custo_medio from ingredientes where id = p_ingrediente_id), 0),
    (select preco_por_unidade from compras where ingrediente_id = p_ingrediente_id
      order by data_compra desc, id desc limit 1))
$$;

-- Unidades já destinadas a um item de pedido
create or replace function qtd_alocada(p_pedido_id bigint, p_sabor_id bigint, p_sem_logo boolean) returns int
language sql stable as $$
  select coalesce(sum(quantidade), 0)::int from alocacoes
   where pedido_id = p_pedido_id and sabor_id = p_sabor_id and sem_logo = p_sem_logo
$$;

-- Itens de pedido que ainda precisam ser produzidos
create or replace function itens_a_produzir(p_status status_pedido[], p_ate date default null)
returns table (pedido_id bigint, sabor_id bigint, sem_logo boolean, quantidade int, data_entrega date)
language sql stable as $$
  select pi.pedido_id, pi.sabor_id, pi.sem_logo,
         greatest(pi.quantidade - qtd_alocada(pi.pedido_id, pi.sabor_id, pi.sem_logo), 0),
         p.data_entrega
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
   where p.status = any (p_status)
     and (p_ate is null or p.data_entrega is null or p.data_entrega <= p_ate)
$$;

-- Ingredientes necessários para produzir uma lista de (sabor, sem_logo, quantidade).
-- Arredonda para lotes inteiros da receita e para lotes inteiros de calda.
create or replace function necessidade_ingredientes(p_itens jsonb)
returns table (ingrediente_id bigint, quantidade numeric)
language sql stable as $$
  with pedidos_sabor as (
    select (x ->> 'sabor_id')::bigint sabor_id,
           coalesce((x ->> 'sem_logo')::boolean, false) sem_logo,
           sum((x ->> 'quantidade')::numeric) qtd
      from jsonb_array_elements(coalesce(p_itens, '[]')) x
     group by 1, 2
    having sum((x ->> 'quantidade')::numeric) > 0
  ),
  lotes as (
    select ps.*, rv.id versao_id, rv.receita_calda_id, rv.rendimento,
           ceil(ps.qtd / rv.rendimento) n_lotes
      from pedidos_sabor ps
      join receitas r on r.sabor_id = ps.sabor_id and r.ativo
      join receita_versoes rv on rv.receita_id = r.id and rv.vigente
  ),
  itens_pudim as (
    select ri.ingrediente_id, ri.quantidade * l.n_lotes qtd
      from lotes l
      join receita_itens ri on ri.versao_id = l.versao_id
     where not (l.sem_logo and ri.opcional_codigo is not distinct from 'logo')
  ),
  copos_calda as (
    select receita_calda_id, sum(n_lotes * rendimento) copos
      from lotes where receita_calda_id is not null group by 1
  ),
  itens_calda as (
    select ri.ingrediente_id, ri.quantidade * ceil(cc.copos / cv.rendimento) qtd
      from copos_calda cc
      join receita_versoes cv on cv.receita_id = cc.receita_calda_id and cv.vigente
      join receita_itens ri on ri.versao_id = cv.id
  )
  select ingrediente_id, sum(qtd) from (
    select * from itens_pudim union all select * from itens_calda
  ) t group by ingrediente_id
$$;

-- Ingredientes reservados pelos pedidos confirmados / em produção ainda não produzidos
create or replace function ingredientes_reservados()
returns table (ingrediente_id bigint, quantidade numeric)
language sql stable as $$
  select * from necessidade_ingredientes((
    select coalesce(jsonb_agg(jsonb_build_object('sabor_id', sabor_id, 'sem_logo', sem_logo, 'quantidade', quantidade)), '[]')
      from itens_a_produzir(array['confirmado', 'em_producao']::status_pedido[])))
$$;

----------------------------------------------------------------------
-- Visões
----------------------------------------------------------------------
create or replace view vw_estoque with (security_invoker = true) as
  select i.id, i.nome, i.marca, i.tipo, i.unidade, i.embalagem_qtd, i.estoque_minimo, i.custo_medio,
         coalesce(m.fisico, 0) estoque_fisico,
         coalesce(r.quantidade, 0) reservado,
         coalesce(m.fisico, 0) - coalesce(r.quantidade, 0) disponivel,
         coalesce(m.fisico, 0) - coalesce(r.quantidade, 0) < i.estoque_minimo abaixo_minimo
    from ingredientes i
    left join (select ingrediente_id, sum(quantidade) fisico from movimentos_estoque group by 1) m on m.ingrediente_id = i.id
    left join ingredientes_reservados() r on r.ingrediente_id = i.id
   where i.ativo;

create or replace view vw_precos_compra with (security_invoker = true) as
  select i.id ingrediente_id, i.nome, i.unidade,
         count(c.id) compras,
         min(c.preco_por_unidade) menor_preco,
         max(c.preco_por_unidade) maior_preco,
         avg(c.preco_por_unidade) media_simples,
         sum(c.preco_total) / nullif(sum(c.quantidade_total), 0) media_ponderada,
         (array_agg(c.preco_por_unidade order by c.data_compra desc, c.id desc))[1] ultimo_preco
    from ingredientes i
    join compras c on c.ingrediente_id = i.id
   group by i.id, i.nome, i.unidade;

create or replace view vw_pedidos with (security_invoker = true) as
  select p.*, c.nome cliente_nome,
         coalesce(it.qtd, 0) quantidade_total,
         coalesce(it.bruto, 0) valor_bruto,
         coalesce(it.bruto, 0) - p.desconto valor_total,
         coalesce(pg.recebido, 0) valor_recebido,
         case when p.status = 'cancelado' then 0
              else coalesce(it.bruto, 0) - p.desconto - coalesce(pg.recebido, 0) end saldo
    from pedidos p
    join clientes c on c.id = p.cliente_id
    left join (select pedido_id, sum(quantidade) qtd, sum(quantidade * preco_unitario) bruto
                 from pedido_itens group by 1) it on it.pedido_id = p.id
    left join (select pedido_id, sum(valor) recebido from pagamentos group by 1) pg on pg.pedido_id = p.id;

create or replace view vw_estoque_pronto with (security_invoker = true) as
  select s.id sabor_id, s.nome,
         coalesce(m.qtd, 0)::int estoque,
         coalesce(a.qtd, 0)::int comprometido,
         (coalesce(m.qtd, 0) - coalesce(a.qtd, 0))::int livre
    from sabores s
    left join (select sabor_id, sum(quantidade) qtd from movimentos_pronto group by 1) m on m.sabor_id = s.id
    left join (select al.sabor_id, sum(al.quantidade) qtd from alocacoes al
                 join pedidos p on p.id = al.pedido_id
                where p.status in ('confirmado', 'em_producao', 'pronto') group by 1) a on a.sabor_id = s.id
   where s.ativo;

----------------------------------------------------------------------
-- Compras e estoque
----------------------------------------------------------------------
create or replace function registrar_compra(
  p_ingrediente_id    bigint,
  p_qtd_embalagens    numeric,
  p_qtd_por_embalagem numeric default null,   -- na unidade informada; vazio = embalagem cadastrada
  p_unidade           text    default null,
  p_preco_unitario    numeric default null,   -- por embalagem
  p_preco_total       numeric default null,
  p_data              date    default current_date,
  p_fornecedor        text    default null,
  p_marca             text    default null,
  p_validade          date    default null,
  p_observacao        text    default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ing ingredientes%rowtype;
  v_por_emb numeric;
  v_unit numeric := p_preco_unitario;
  v_total numeric := p_preco_total;
  v_qtd numeric;
  v_estoque numeric;
  v_forn bigint;
  v_id bigint;
begin
  perform sanja_exigir_autorizacao();
  select * into ing from ingredientes where id = p_ingrediente_id and ativo for update;
  if not found then raise exception 'Ingrediente % não encontrado.', p_ingrediente_id; end if;
  if coalesce(p_qtd_embalagens, 0) <= 0 then raise exception 'Informe a quantidade de embalagens.'; end if;

  v_por_emb := coalesce(converter_unidade(p_qtd_por_embalagem, p_unidade, ing.unidade), ing.embalagem_qtd);
  if v_por_emb is null then
    raise exception 'Informe o tamanho da embalagem de % (ex.: 395 g, 1 litro).', ing.nome;
  end if;

  if v_unit is null and v_total is null then
    raise exception 'Informe o preço unitário ou o preço total da compra.';
  end if;
  v_unit := coalesce(v_unit, round(v_total / p_qtd_embalagens, 4));
  v_total := coalesce(v_total, round(v_unit * p_qtd_embalagens, 2));

  if p_fornecedor is not null and trim(p_fornecedor) <> '' then
    insert into fornecedores (nome) values (trim(p_fornecedor))
      on conflict (nome) do update set nome = excluded.nome
      returning id into v_forn;
  end if;

  v_qtd := p_qtd_embalagens * v_por_emb;
  v_estoque := estoque_fisico(ing.id);

  insert into compras (ingrediente_id, fornecedor_id, marca, data_compra, qtd_embalagens, qtd_por_embalagem,
                       preco_unitario, preco_total, validade, observacao)
  values (ing.id, v_forn, coalesce(p_marca, ing.marca), coalesce(p_data, current_date), p_qtd_embalagens, v_por_emb,
          v_unit, v_total, p_validade, p_observacao)
  returning id into v_id;

  insert into movimentos_estoque (ingrediente_id, tipo, quantidade, custo_unitario, compra_id, data)
  values (ing.id, 'compra', v_qtd, v_total / v_qtd, v_id, coalesce(p_data, current_date));

  -- média ponderada móvel
  update ingredientes set
    custo_medio = case when v_estoque <= 0 then v_total / v_qtd
                       else (v_estoque * custo_medio + v_total) / (v_estoque + v_qtd) end,
    embalagem_qtd = coalesce(embalagem_qtd, v_por_emb)
  where id = ing.id;

  return v_id;
end $$;

-- Compras parecidas recentes (para o bot alertar duplicidade)
create or replace function compras_semelhantes(p_ingrediente_id bigint, p_qtd_embalagens numeric, p_data date default current_date)
returns setof compras language sql stable security definer set search_path = public as $$
  select c.* from compras c
   where sanja_autorizado()
     and c.ingrediente_id = p_ingrediente_id
     and c.qtd_embalagens = p_qtd_embalagens
     and c.data_compra between coalesce(p_data, current_date) - 2 and coalesce(p_data, current_date) + 2
$$;

create or replace function registrar_ajuste_estoque(
  p_ingrediente_id bigint,
  p_quantidade     numeric,           -- perda: quantidade perdida (positiva); ajuste: + ou −
  p_tipo           tipo_movimento,
  p_justificativa  text,
  p_unidade        text default null,
  p_data           date default current_date
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ing ingredientes%rowtype;
  v_qtd numeric;
  v_id bigint;
begin
  perform sanja_exigir_autorizacao();
  if p_tipo not in ('perda', 'ajuste') then raise exception 'Use perda ou ajuste.'; end if;
  if coalesce(trim(p_justificativa), '') = '' then raise exception 'Justificativa obrigatória.'; end if;
  select * into ing from ingredientes where id = p_ingrediente_id for update;
  if not found then raise exception 'Ingrediente % não encontrado.', p_ingrediente_id; end if;

  v_qtd := converter_unidade(p_quantidade, p_unidade, ing.unidade);
  if p_tipo = 'perda' then v_qtd := -abs(v_qtd); end if;
  if coalesce(v_qtd, 0) = 0 then raise exception 'Quantidade inválida.'; end if;
  if estoque_fisico(ing.id) + v_qtd < 0 then
    raise exception 'O estoque de % ficaria negativo (atual: % %).', ing.nome, estoque_fisico(ing.id), ing.unidade;
  end if;

  insert into movimentos_estoque (ingrediente_id, tipo, quantidade, custo_unitario, justificativa, data)
  values (ing.id, p_tipo, v_qtd, ing.custo_medio, trim(p_justificativa), coalesce(p_data, current_date))
  returning id into v_id;
  return v_id;
end $$;

----------------------------------------------------------------------
-- Receitas (versionadas)
----------------------------------------------------------------------
-- p_itens: [{"ingrediente_id": 1, "quantidade": 6, "unidade": "un", "opcional_codigo": null}, ...]
create or replace function salvar_receita(
  p_nome             text,
  p_tipo             tipo_receita,
  p_sabor_id         bigint,
  p_rendimento       numeric,
  p_itens            jsonb,
  p_receita_calda_id bigint default null,
  p_observacao       text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_receita bigint;
  v_versao int;
  v_versao_id bigint;
  it jsonb;
  ing ingredientes%rowtype;
begin
  perform sanja_exigir_autorizacao();
  if coalesce(p_rendimento, 0) <= 0 then raise exception 'Rendimento deve ser maior que zero.'; end if;
  if p_tipo = 'calda' and p_receita_calda_id is not null then raise exception 'Calda não usa outra calda.'; end if;

  select id into v_receita from receitas
   where (p_sabor_id is not null and sabor_id = p_sabor_id) or (p_sabor_id is null and lower(nome) = lower(p_nome));
  if v_receita is null then
    insert into receitas (nome, tipo, sabor_id) values (p_nome, p_tipo, p_sabor_id) returning id into v_receita;
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from receita_versoes where receita_id = v_receita;
  update receita_versoes set vigente = false where receita_id = v_receita and vigente;
  insert into receita_versoes (receita_id, versao, rendimento, receita_calda_id, observacao)
  values (v_receita, v_versao, p_rendimento, p_receita_calda_id, p_observacao)
  returning id into v_versao_id;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into ing from ingredientes where id = (it ->> 'ingrediente_id')::bigint;
    if not found then raise exception 'Ingrediente % não cadastrado.', it ->> 'ingrediente_id'; end if;
    insert into receita_itens (versao_id, ingrediente_id, quantidade, opcional_codigo)
    values (v_versao_id, ing.id,
            converter_unidade((it ->> 'quantidade')::numeric, it ->> 'unidade', ing.unidade),
            nullif(it ->> 'opcional_codigo', ''));
  end loop;

  return v_versao_id;
end $$;

-- Custo estimado de uma versão de receita (pudim inclui a parte da calda por copo)
create or replace function custo_receita(p_versao_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rv receita_versoes%rowtype;
  v_lote numeric := 0;
  v_logo numeric := 0;
  v_calda_copo numeric := 0;
  v_sem_preco text[] := '{}';
  v_calda jsonb;
  v_itens jsonb;
begin
  perform sanja_exigir_autorizacao();
  select * into rv from receita_versoes where id = p_versao_id;
  if not found then raise exception 'Versão de receita % não encontrada.', p_versao_id; end if;

  select coalesce(sum(ri.quantidade * coalesce(preco_referencia(i.id), 0)), 0),
         coalesce(sum(ri.quantidade * coalesce(preco_referencia(i.id), 0)) filter (where ri.opcional_codigo = 'logo'), 0),
         coalesce(array_agg(i.nome) filter (where preco_referencia(i.id) is null), '{}'),
         coalesce(jsonb_agg(jsonb_build_object(
           'ingrediente_id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'quantidade', ri.quantidade,
           'opcional_codigo', ri.opcional_codigo, 'preco_unidade', preco_referencia(i.id),
           'custo', round(ri.quantidade * coalesce(preco_referencia(i.id), 0), 4)) order by i.nome), '[]')
    into v_lote, v_logo, v_sem_preco, v_itens
    from receita_itens ri join ingredientes i on i.id = ri.ingrediente_id
   where ri.versao_id = rv.id;

  if rv.receita_calda_id is not null then
    select custo_receita(cv.id) into v_calda
      from receita_versoes cv where cv.receita_id = rv.receita_calda_id and cv.vigente;
    v_calda_copo := coalesce((v_calda ->> 'custo_copo')::numeric, 0);
    v_sem_preco := v_sem_preco || coalesce(array(select jsonb_array_elements_text(v_calda -> 'itens_sem_preco')), '{}');
  end if;

  return jsonb_build_object(
    'versao_id', rv.id,
    'rendimento', rv.rendimento,
    'custo_lote', round(v_lote, 2),
    'custo_calda_copo', round(v_calda_copo, 4),
    'custo_copo', round(v_lote / rv.rendimento + v_calda_copo, 4),
    'custo_copo_sem_logo', round((v_lote - v_logo) / rv.rendimento + v_calda_copo, 4),
    'calda_vinculada', rv.receita_calda_id is not null,
    'calda_tem_itens', coalesce((v_calda ->> 'tem_itens')::boolean, false),
    'tem_itens', jsonb_array_length(v_itens) > 0,
    'itens', v_itens,
    'itens_sem_preco', to_jsonb(v_sem_preco));
end $$;

----------------------------------------------------------------------
-- Clientes e pedidos
----------------------------------------------------------------------
create or replace function criar_cliente(p_nome text, p_tipo tipo_cliente default 'varejo', p_telefone text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform sanja_exigir_autorizacao();
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do cliente.'; end if;
  insert into clientes (nome, tipo, telefone) values (trim(p_nome), coalesce(p_tipo, 'varejo'), p_telefone)
  returning id into v_id;
  return v_id;
end $$;

-- Retorna a lista de regras violadas (vazia = pedido válido)
create or replace function validar_pedido(p_tipo tipo_cliente, p_itens jsonb) returns text[]
language plpgsql stable as $$
declare
  cfg configuracoes%rowtype;
  v_total int := 0;
  v_minimo int;
  erros text[] := '{}';
  it jsonb;
  v_qtd int;
begin
  select * into cfg from configuracoes where id = 1;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_qtd := (it ->> 'quantidade')::int;
    if coalesce(v_qtd, 0) <= 0 then
      erros := erros || 'Quantidade inválida.';
    elsif v_qtd % cfg.multiplo_producao <> 0 then
      erros := erros || format('%s unidades de %s não é múltiplo de %s.', v_qtd,
                 (select nome from sabores where id = (it ->> 'sabor_id')::bigint), cfg.multiplo_producao);
    end if;
    v_total := v_total + coalesce(v_qtd, 0);
  end loop;
  v_minimo := case p_tipo when 'revenda' then cfg.minimo_revenda else cfg.minimo_varejo end;
  if v_total < v_minimo then
    erros := erros || format('Pedido de %s com %s unidades; o mínimo é %s.', p_tipo, v_total, v_minimo);
  end if;
  return erros;
end $$;

-- p_itens: [{"sabor_id": 1, "quantidade": 16, "sem_logo": false}, ...]
create or replace function criar_pedido(
  p_cliente_id      bigint,
  p_itens           jsonb,
  p_data_entrega    date default null,
  p_tipo            tipo_cliente default null,   -- vazio = tipo do cliente
  p_excecao_motivo  text default null,           -- obrigatório para dispensar uma regra
  p_observacao      text default null,
  p_data_pedido     date default current_date,
  p_status          status_pedido default 'solicitado'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cfg configuracoes%rowtype;
  cli clientes%rowtype;
  v_tipo tipo_cliente;
  v_preco numeric;
  erros text[];
  v_id bigint;
  it jsonb;
begin
  perform sanja_exigir_autorizacao();
  select * into cfg from configuracoes where id = 1;
  select * into cli from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente % não encontrado.', p_cliente_id; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'O pedido precisa de pelo menos um sabor.'; end if;
  if p_status not in ('solicitado', 'confirmado') then raise exception 'Pedido novo deve ser solicitado ou confirmado.'; end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    if not exists (select 1 from sabores where id = (it ->> 'sabor_id')::bigint and ativo) then
      raise exception 'Sabor % não cadastrado.', it ->> 'sabor_id';
    end if;
  end loop;

  v_tipo := coalesce(p_tipo, cli.tipo);
  erros := validar_pedido(v_tipo, p_itens);
  if array_length(erros, 1) > 0 and coalesce(trim(p_excecao_motivo), '') = '' then
    raise exception 'Pedido fora das regras: %', array_to_string(erros, ' ')
      using hint = 'Para autorizar mesmo assim, informe o motivo da exceção.';
  end if;

  v_preco := case v_tipo when 'revenda' then cfg.preco_revenda else cfg.preco_varejo end;

  insert into pedidos (cliente_id, tipo, data_pedido, data_entrega, status, excecao_motivo, observacao)
  values (cli.id, v_tipo, coalesce(p_data_pedido, current_date), p_data_entrega, 'solicitado',
          case when array_length(erros, 1) > 0 then trim(p_excecao_motivo) end, p_observacao)
  returning id into v_id;

  insert into pedido_itens (pedido_id, sabor_id, quantidade, preco_unitario, sem_logo)
  select v_id, (x ->> 'sabor_id')::bigint, sum((x ->> 'quantidade')::int), v_preco,
         coalesce((x ->> 'sem_logo')::boolean, false)
    from jsonb_array_elements(p_itens) x group by 2, 5;

  if p_status = 'confirmado' then perform atualizar_status_pedido(v_id, 'confirmado'); end if;
  return v_id;
end $$;

-- Destina pudins prontos livres a um pedido (ex.: sobras de pedido cancelado)
create or replace function alocar_estoque_pronto(p_pedido_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_livre int;
  v_qtd int;
  v_total int := 0;
begin
  perform sanja_exigir_autorizacao();
  for r in select * from itens_a_produzir(array['confirmado', 'em_producao']::status_pedido[]) where pedido_id = p_pedido_id and quantidade > 0 loop
    select livre into v_livre from vw_estoque_pronto where sabor_id = r.sabor_id;
    v_qtd := least(coalesce(v_livre, 0), r.quantidade);
    if v_qtd > 0 then
      insert into alocacoes (pedido_id, sabor_id, quantidade, sem_logo) values (p_pedido_id, r.sabor_id, v_qtd, r.sem_logo);
      v_total := v_total + v_qtd;
    end if;
  end loop;
  return v_total;
end $$;

create or replace function pedido_totalmente_alocado(p_pedido_id bigint) returns boolean
language sql stable as $$
  select not exists (select 1 from pedido_itens pi where pi.pedido_id = p_pedido_id
                      and qtd_alocada(pi.pedido_id, pi.sabor_id, pi.sem_logo) < pi.quantidade)
$$;

create or replace function atualizar_status_pedido(p_pedido_id bigint, p_status status_pedido) returns status_pedido
language plpgsql security definer set search_path = public as $$
declare
  p pedidos%rowtype;
  permitido boolean;
begin
  perform sanja_exigir_autorizacao();
  select * into p from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido % não encontrado.', p_pedido_id; end if;
  if p.status = p_status then return p.status; end if;
  if p_status = 'entregue' then raise exception 'Use registrar_entrega para entregar o pedido.'; end if;

  permitido := case p.status
    when 'solicitado'  then p_status in ('confirmado', 'cancelado')
    when 'confirmado'  then p_status in ('solicitado', 'em_producao', 'pronto', 'cancelado')
    when 'em_producao' then p_status in ('pronto', 'cancelado')
    when 'pronto'      then p_status in ('cancelado')
    else false end;
  if not permitido then
    raise exception 'Não é possível mudar o pedido de "%" para "%".', p.status, p_status;
  end if;
  if p_status = 'solicitado' and exists (select 1 from alocacoes where pedido_id = p.id) then
    raise exception 'O pedido já tem pudins produzidos; não pode voltar para solicitado.';
  end if;

  update pedidos set status = p_status where id = p.id;

  if p_status = 'confirmado' then
    perform alocar_estoque_pronto(p.id);
    if pedido_totalmente_alocado(p.id) then update pedidos set status = 'pronto' where id = p.id; end if;
  elsif p_status = 'pronto' and not pedido_totalmente_alocado(p.id) then
    raise exception 'Ainda faltam pudins a produzir para este pedido.';
  end if;

  return (select status from pedidos where id = p.id);
end $$;

create or replace function registrar_entrega(p_pedido_id bigint, p_data date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare
  p pedidos%rowtype;
begin
  perform sanja_exigir_autorizacao();
  select * into p from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido % não encontrado.', p_pedido_id; end if;
  if p.status in ('confirmado', 'em_producao') then
    perform alocar_estoque_pronto(p.id);
  elsif p.status <> 'pronto' then
    raise exception 'Pedido está "%"; só pedidos prontos podem ser entregues.', p.status;
  end if;
  if not pedido_totalmente_alocado(p.id) then
    raise exception 'Ainda faltam pudins a produzir para este pedido.';
  end if;

  insert into movimentos_pronto (sabor_id, tipo, quantidade, pedido_id, data)
  select sabor_id, 'entrega', -sum(quantidade), p.id, coalesce(p_data, current_date)
    from pedido_itens where pedido_id = p.id group by sabor_id;

  update pedidos set status = 'entregue', entregue_em = coalesce(p_data, current_date)::timestamptz where id = p.id;
end $$;

create or replace function registrar_pagamento(
  p_pedido_id bigint, p_valor numeric, p_forma text default null, p_data date default current_date, p_observacao text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_saldo numeric;
  v_status status_pedido;
  v_id bigint;
begin
  perform sanja_exigir_autorizacao();
  select saldo, status into v_saldo, v_status from vw_pedidos where id = p_pedido_id;
  if not found then raise exception 'Pedido % não encontrado.', p_pedido_id; end if;
  if v_status = 'cancelado' then raise exception 'Pedido cancelado não recebe pagamento.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Valor inválido.'; end if;
  if p_valor > v_saldo then
    raise exception 'Valor R$ % maior que o saldo pendente R$ %.', p_valor, v_saldo;
  end if;
  insert into pagamentos (pedido_id, valor, forma, data, observacao)
  values (p_pedido_id, p_valor,
          coalesce(p_forma, (select forma_pagamento_padrao from configuracoes where id = 1)),
          coalesce(p_data, current_date), p_observacao)
  returning id into v_id;
  return v_id;
end $$;

----------------------------------------------------------------------
-- Produção (baixa física do estoque)
----------------------------------------------------------------------
create or replace function registrar_producao(
  p_sabor_id         bigint,
  p_quantidade       int,
  p_pedido_id        bigint  default null,   -- vazio = distribui para os pedidos pendentes mais antigos
  p_sem_logo         boolean default false,
  p_data             date    default current_date,
  p_excecao_motivo   text    default null,   -- para produzir fora do múltiplo configurado
  p_observacao       text    default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cfg configuracoes%rowtype;
  rv receita_versoes%rowtype;
  cv receita_versoes%rowtype;
  v_lotes numeric;
  v_consumo jsonb;
  v_custo numeric := 0;
  v_falta text;
  v_id bigint;
  v_resto int := p_quantidade;
  v_qtd int;
  r record;
begin
  perform sanja_exigir_autorizacao();
  select * into cfg from configuracoes where id = 1;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Quantidade inválida.'; end if;
  if p_quantidade % cfg.multiplo_producao <> 0 and coalesce(trim(p_excecao_motivo), '') = '' then
    raise exception 'Produção de % não é múltiplo de %.', p_quantidade, cfg.multiplo_producao
      using hint = 'Para autorizar mesmo assim, informe o motivo da exceção.';
  end if;

  select rv2.* into rv from receita_versoes rv2 join receitas r2 on r2.id = rv2.receita_id
   where r2.sabor_id = p_sabor_id and r2.ativo and rv2.vigente;
  if not found or not exists (select 1 from receita_itens where versao_id = rv.id) then
    raise exception 'O sabor % não tem receita cadastrada.', (select nome from sabores where id = p_sabor_id);
  end if;
  if rv.receita_calda_id is not null then
    select * into cv from receita_versoes where receita_id = rv.receita_calda_id and vigente;
  end if;

  if p_pedido_id is not null then
    select * into r from itens_a_produzir(array['confirmado', 'em_producao']::status_pedido[])
     where pedido_id = p_pedido_id and sabor_id = p_sabor_id and sem_logo = coalesce(p_sem_logo, false);
    if not found then
      raise exception 'O pedido % não está confirmado ou não tem esse sabor.', p_pedido_id;
    end if;
    if p_quantidade > r.quantidade then
      raise exception 'O pedido % precisa de apenas % unidades desse sabor.', p_pedido_id, r.quantidade;
    end if;
  end if;

  v_lotes := p_quantidade / rv.rendimento;

  -- consumo: itens da receita por lote + calda proporcional por copo
  select coalesce(jsonb_agg(jsonb_build_object('ingrediente_id', ingrediente_id, 'qtd', qtd)), '[]') into v_consumo
    from (select ingrediente_id, sum(qtd) qtd from (
            select ri.ingrediente_id, ri.quantidade * v_lotes qtd
              from receita_itens ri
             where ri.versao_id = rv.id and not (coalesce(p_sem_logo, false) and ri.opcional_codigo is not distinct from 'logo')
            union all
            select ri.ingrediente_id, ri.quantidade * p_quantidade / cv.rendimento
              from receita_itens ri where cv.id is not null and ri.versao_id = cv.id
          ) t group by ingrediente_id) c;

  select string_agg(format('%s (precisa %s %s, tem %s)', i.nome, round(c.qtd, 2), i.unidade, round(estoque_fisico(i.id), 2)), '; ')
    into v_falta
    from jsonb_to_recordset(v_consumo) c(ingrediente_id bigint, qtd numeric)
    join ingredientes i on i.id = c.ingrediente_id
   where estoque_fisico(i.id) < c.qtd;
  if v_falta is not null then
    raise exception 'Estoque insuficiente: %', v_falta
      using hint = 'Registre a compra ou um ajuste de estoque antes da produção.';
  end if;

  select coalesce(sum(c.qtd * i.custo_medio), 0) into v_custo
    from jsonb_to_recordset(v_consumo) c(ingrediente_id bigint, qtd numeric)
    join ingredientes i on i.id = c.ingrediente_id;

  insert into producoes (sabor_id, versao_id, quantidade, sem_logo, pedido_id, custo_total, custo_unitario, data, observacao)
  values (p_sabor_id, rv.id, p_quantidade, coalesce(p_sem_logo, false), p_pedido_id,
          round(v_custo, 2), round(v_custo / p_quantidade, 4), coalesce(p_data, current_date),
          coalesce(p_observacao, nullif(trim(p_excecao_motivo), '')))
  returning id into v_id;

  insert into movimentos_estoque (ingrediente_id, tipo, quantidade, custo_unitario, producao_id, data)
  select c.ingrediente_id, 'consumo', -c.qtd, i.custo_medio, v_id, coalesce(p_data, current_date)
    from jsonb_to_recordset(v_consumo) c(ingrediente_id bigint, qtd numeric)
    join ingredientes i on i.id = c.ingrediente_id;

  insert into movimentos_pronto (sabor_id, tipo, quantidade, producao_id, data)
  values (p_sabor_id, 'producao', p_quantidade, v_id, coalesce(p_data, current_date));

  -- destina os pudins: ao pedido informado ou aos pedidos pendentes por data de entrega
  for r in
    select * from itens_a_produzir(array['confirmado', 'em_producao']::status_pedido[]) x
     where x.sabor_id = p_sabor_id and x.sem_logo = coalesce(p_sem_logo, false) and x.quantidade > 0
       and (p_pedido_id is null or x.pedido_id = p_pedido_id)
     order by x.data_entrega nulls last, x.pedido_id
  loop
    exit when v_resto <= 0;
    v_qtd := least(v_resto, r.quantidade);
    insert into alocacoes (pedido_id, sabor_id, quantidade, sem_logo, producao_id)
    values (r.pedido_id, p_sabor_id, v_qtd, coalesce(p_sem_logo, false), v_id);
    v_resto := v_resto - v_qtd;
    update pedidos set status = case when pedido_totalmente_alocado(id) then 'pronto' else 'em_producao' end::status_pedido
     where id = r.pedido_id;
  end loop;

  return v_id;
end $$;

create or replace function registrar_ajuste_pronto(
  p_sabor_id bigint, p_quantidade int, p_tipo tipo_movimento_pronto, p_justificativa text, p_data date default current_date
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_qtd int := p_quantidade;
  v_livre int;
  v_id bigint;
begin
  perform sanja_exigir_autorizacao();
  if p_tipo not in ('perda', 'ajuste') then raise exception 'Use perda ou ajuste.'; end if;
  if coalesce(trim(p_justificativa), '') = '' then raise exception 'Justificativa obrigatória.'; end if;
  if p_tipo = 'perda' then v_qtd := -abs(v_qtd); end if;
  select livre into v_livre from vw_estoque_pronto where sabor_id = p_sabor_id;
  if coalesce(v_livre, 0) + v_qtd < 0 then
    raise exception 'Só há % pudins prontos livres desse sabor.', coalesce(v_livre, 0);
  end if;
  insert into movimentos_pronto (sabor_id, tipo, quantidade, justificativa, data)
  values (p_sabor_id, p_tipo, v_qtd, trim(p_justificativa), coalesce(p_data, current_date))
  returning id into v_id;
  return v_id;
end $$;

----------------------------------------------------------------------
-- Lista de compras
----------------------------------------------------------------------
-- p_ate: considera pedidos com entrega até essa data (vazio = todos em aberto)
create or replace function lista_compras(p_ate date default null, p_incluir_solicitados boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_status status_pedido[] := case when p_incluir_solicitados
                                   then array['solicitado', 'confirmado', 'em_producao']
                                   else array['confirmado', 'em_producao'] end::status_pedido[];
  v_escopo jsonb;
  v_fora jsonb;
  v_itens jsonb;
  v_avisos text[] := '{}';
begin
  perform sanja_exigir_autorizacao();

  -- pedidos do período
  select coalesce(jsonb_agg(jsonb_build_object('sabor_id', sabor_id, 'sem_logo', sem_logo, 'quantidade', quantidade)), '[]')
    into v_escopo from itens_a_produzir(v_status, p_ate) where quantidade > 0;
  -- reservas de pedidos confirmados fora do período (também consomem o estoque)
  select coalesce(jsonb_agg(jsonb_build_object('sabor_id', x.sabor_id, 'sem_logo', x.sem_logo, 'quantidade', x.quantidade)), '[]')
    into v_fora
    from itens_a_produzir(array['confirmado', 'em_producao']::status_pedido[]) x
   where x.quantidade > 0 and p_ate is not null and x.data_entrega > p_ate;

  -- avisos: sabores sem receita, calda sem itens
  select v_avisos || coalesce(array_agg(distinct 'Sabor ' || s.nome || ' sem receita cadastrada; não entrou no cálculo.'), '{}')
    into v_avisos
    from jsonb_array_elements(v_escopo) e join sabores s on s.id = (e ->> 'sabor_id')::bigint
   where not exists (select 1 from receitas r join receita_versoes rv on rv.receita_id = r.id and rv.vigente
                       join receita_itens ri on ri.versao_id = rv.id where r.sabor_id = s.id);
  select v_avisos || coalesce(array_agg(distinct 'Receita de calda "' || c.nome || '" sem ingredientes cadastrados.'), '{}')
    into v_avisos
    from jsonb_array_elements(v_escopo) e
    join receitas r on r.sabor_id = (e ->> 'sabor_id')::bigint
    join receita_versoes rv on rv.receita_id = r.id and rv.vigente
    join receitas c on c.id = rv.receita_calda_id
   where not exists (select 1 from receita_versoes cv join receita_itens ri on ri.versao_id = cv.id
                      where cv.receita_id = c.id and cv.vigente);

  with nec as (select * from necessidade_ingredientes(v_escopo)),
       fora as (select * from necessidade_ingredientes(v_fora)),
       base as (
         select i.id, i.nome, i.unidade, i.embalagem_qtd, i.estoque_minimo,
                coalesce(n.quantidade, 0) necessario,
                estoque_fisico(i.id) estoque,
                coalesce(r.quantidade, 0) reservado,
                coalesce(f.quantidade, 0) reservado_fora,
                preco_referencia(i.id) preco
           from ingredientes i
           left join nec n on n.ingrediente_id = i.id
           left join fora f on f.ingrediente_id = i.id
           left join ingredientes_reservados() r on r.ingrediente_id = i.id
          where i.ativo
       ),
       calc as (
         select b.*, greatest(b.necessario + b.reservado_fora + b.estoque_minimo - b.estoque, 0) falta from base b
       ),
       sug as (
         select c.*,
                case when c.falta = 0 then 0
                     when c.embalagem_qtd is null then c.falta
                     else ceil(c.falta / c.embalagem_qtd) * c.embalagem_qtd end sugerido,
                case when c.falta > 0 and c.embalagem_qtd is not null then ceil(c.falta / c.embalagem_qtd) end embalagens
           from calc c
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ingrediente_id', id, 'ingrediente', nome, 'unidade', unidade,
           'necessario', round(necessario, 2), 'estoque', round(estoque, 2), 'reservado', round(reservado, 2),
           'estoque_minimo', estoque_minimo, 'comprar', round(sugerido, 2), 'embalagens', embalagens,
           'tamanho_embalagem', embalagem_qtd, 'preco_unidade', round(preco, 6),
           'custo_previsto', case when preco is null then null else round(sugerido * preco, 2) end)
         order by nome), '[]')
    into v_itens
    from sug where necessario > 0 or sugerido > 0;

  select v_avisos || coalesce(array_agg('Sem preço de compra para ' || (x ->> 'ingrediente') || '.'), '{}')
    into v_avisos
    from jsonb_array_elements(v_itens) x where (x ->> 'comprar')::numeric > 0 and x -> 'preco_unidade' = 'null'::jsonb;

  return jsonb_build_object(
    'ate', p_ate,
    'itens', v_itens,
    'custo_total_previsto', (select round(sum((x ->> 'custo_previsto')::numeric), 2) from jsonb_array_elements(v_itens) x),
    'avisos', to_jsonb(v_avisos));
end $$;
