-- SANJA Gestão — relatórios
-- Faturamento = pedidos entregues no período. Recebimentos = pagamentos com data no período.
-- Lucro bruto = faturamento − custo de produção dos pudins vendidos.
-- Lucro líquido só é calculado quando há despesas operacionais cadastradas no período.

-- Custo médio por pudim de um sabor, pelas produções registradas até a data
create or replace function custo_medio_pudim(p_sabor_id bigint, p_ate date) returns numeric
language sql stable as $$
  select sum(custo_total) / nullif(sum(quantidade), 0)
    from producoes where sabor_id = p_sabor_id and data <= p_ate
$$;

create or replace function metricas_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  v_desp numeric;
begin
  perform sanja_exigir_autorizacao();

  with entregues as (
    select * from vw_pedidos where status = 'entregue' and entregue_em::date between p_inicio and p_fim
  ),
  itens as (
    select pi.sabor_id, s.nome, sum(pi.quantidade) qtd,
           sum(pi.quantidade * pi.preco_unitario) receita_bruta,
           sum(pi.quantidade * coalesce(custo_medio_pudim(pi.sabor_id, p_fim), 0)) custo
      from entregues e
      join pedido_itens pi on pi.pedido_id = e.id
      join sabores s on s.id = pi.sabor_id
     group by pi.sabor_id, s.nome
  ),
  totais as (
    select coalesce(sum(valor_total), 0) faturamento,
           coalesce(sum(desconto), 0) descontos,
           count(*) pedidos
      from entregues
  )
  select jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim,
    'faturamento', t.faturamento,
    'pedidos_entregues', t.pedidos,
    'pudins_vendidos', coalesce((select sum(qtd) from itens), 0),
    'ticket_medio', case when t.pedidos > 0 then round(t.faturamento / t.pedidos, 2) else 0 end,
    'recebido', coalesce((select sum(valor) from pagamentos where data between p_inicio and p_fim), 0),
    'custo_vendidos', round(coalesce((select sum(custo) from itens), 0), 2),
    'lucro_bruto', round(t.faturamento - coalesce((select sum(custo) from itens), 0), 2),
    'custo_producao_periodo', coalesce((select sum(custo_total) from producoes where data between p_inicio and p_fim), 0),
    'pudins_produzidos', coalesce((select sum(quantidade) from producoes where data between p_inicio and p_fim), 0),
    'por_sabor', coalesce((select jsonb_agg(jsonb_build_object(
        'sabor_id', sabor_id, 'sabor', nome, 'quantidade', qtd,
        'receita', round(receita_bruta, 2), 'custo', round(custo, 2),
        'margem', round(receita_bruta - custo, 2),
        'margem_pct', case when receita_bruta > 0 then round((receita_bruta - custo) / receita_bruta * 100, 1) end)
        order by qtd desc) from itens), '[]'),
    'ingredientes_mais_usados', coalesce((select jsonb_agg(x order by (x ->> 'custo')::numeric desc) from (
        select jsonb_build_object('ingrediente', i.nome, 'unidade', i.unidade,
                                  'quantidade', round(-sum(m.quantidade), 2),
                                  'custo', round(-sum(m.quantidade * coalesce(m.custo_unitario, 0)), 2)) x
          from movimentos_estoque m join ingredientes i on i.id = m.ingrediente_id
         where m.tipo = 'consumo' and m.data between p_inicio and p_fim
         group by i.id, i.nome, i.unidade
         order by -sum(m.quantidade * coalesce(m.custo_unitario, 0)) desc limit 10) q), '[]'))
  into v from totais t;

  select sum(valor) into v_desp from despesas where data between p_inicio and p_fim;
  v := v || jsonb_build_object(
    'despesas_operacionais', v_desp,
    'lucro_liquido', case when v_desp is not null then round((v ->> 'lucro_bruto')::numeric - v_desp, 2) end,
    'lucro_liquido_nota', case when v_desp is null
      then 'Sem despesas operacionais cadastradas no período; lucro líquido não calculado.'
      else 'Considera apenas as despesas cadastradas.' end);
  return v;
end $$;

-- Relatório completo com comparação ao período anterior de mesma duração
create or replace function relatorio_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dias int := p_fim - p_inicio + 1;
  atual jsonb;
  anterior jsonb;
begin
  perform sanja_exigir_autorizacao();
  if p_fim < p_inicio then raise exception 'Data final antes da inicial.'; end if;
  atual := metricas_periodo(p_inicio, p_fim);
  anterior := metricas_periodo(p_inicio - v_dias, p_inicio - 1);
  return atual || jsonb_build_object(
    'pendente_total', (select coalesce(sum(saldo), 0) from vw_pedidos where status <> 'cancelado'),
    'pedidos_novos', (select count(*) from pedidos where data_pedido between p_inicio and p_fim and status <> 'cancelado'),
    'estoque_abaixo_minimo', coalesce((select jsonb_agg(jsonb_build_object(
        'ingrediente', nome, 'unidade', unidade, 'disponivel', round(disponivel, 2), 'minimo', estoque_minimo))
        from vw_estoque where abaixo_minimo), '[]'),
    'precos_compra', coalesce((select jsonb_agg(jsonb_build_object(
        'ingrediente', nome, 'unidade', unidade, 'compras', compras,
        'menor', round(menor_preco, 6), 'maior', round(maior_preco, 6),
        'media_simples', round(media_simples, 6), 'media_ponderada', round(media_ponderada, 6)) order by nome)
        from vw_precos_compra), '[]'),
    'anterior', jsonb_build_object(
      'inicio', anterior -> 'inicio', 'fim', anterior -> 'fim',
      'faturamento', anterior -> 'faturamento', 'pedidos_entregues', anterior -> 'pedidos_entregues',
      'pudins_vendidos', anterior -> 'pudins_vendidos', 'lucro_bruto', anterior -> 'lucro_bruto',
      'recebido', anterior -> 'recebido'));
end $$;

-- Números do painel inicial
create or replace function resumo_painel(p_hoje date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_hoje)::date;
  m jsonb;
begin
  perform sanja_exigir_autorizacao();
  m := metricas_periodo(v_ini, p_hoje);
  return jsonb_build_object(
    'mes_inicio', v_ini,
    'faturamento_mes', m -> 'faturamento',
    'pudins_vendidos_mes', m -> 'pudins_vendidos',
    'lucro_bruto_mes', m -> 'lucro_bruto',
    'vendas_por_sabor', m -> 'por_sabor',
    'pedidos_abertos', (select count(*) from pedidos where status in ('solicitado', 'confirmado', 'em_producao', 'pronto')),
    'a_receber', (select coalesce(sum(saldo), 0) from vw_pedidos where status <> 'cancelado'),
    'proximas_entregas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'cliente', cliente_nome, 'data_entrega', data_entrega, 'status', status,
        'quantidade', quantidade_total, 'saldo', saldo) order by data_entrega nulls last, id)
        from (select * from vw_pedidos where status in ('solicitado', 'confirmado', 'em_producao', 'pronto')
               order by data_entrega nulls last, id limit 8) p), '[]'),
    'alertas_estoque', coalesce((select jsonb_agg(jsonb_build_object(
        'ingrediente', nome, 'unidade', unidade, 'disponivel', round(disponivel, 2), 'minimo', estoque_minimo))
        from vw_estoque where abaixo_minimo), '[]'));
end $$;
