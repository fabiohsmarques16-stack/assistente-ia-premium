-- Testes das regras de negócio do SANJA Gestão.
-- Cada bloco roda numa transação desfeita no final (rollback), partindo dos dados iniciais.
\set QUIET on
\pset tuples_only on
set client_min_messages = notice;
\o /dev/null
create schema if not exists teste;
grant usage on schema teste to authenticated, anon;

create or replace function teste.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

-- espera que a instrução falhe com uma mensagem contendo o trecho
create or replace function teste.falha(sql text, trecho text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok - %', msg; return; end if;
    raise exception 'FALHOU: % (erro inesperado: %)', msg, sqlerrm;
  end;
  raise exception 'FALHOU: % (não deu erro)', msg;
end $$;

create or replace function teste.ing(p text) returns bigint language sql as $$ select id from ingredientes where nome = p $$;
create or replace function teste.sab(p text) returns bigint language sql as $$ select id from sabores where nome = p $$;
create or replace function teste.est(p text) returns numeric language sql as $$ select estoque_fisico(teste.ing(p)) $$;
create or replace function teste.res(p text) returns numeric language sql as $$ select reservado from vw_estoque where nome = p $$;

-- Compra de tudo que uma receita usa (em quantidade para n lotes)
create or replace function teste.abastecer(n int) returns void language plpgsql as $$
begin
  perform registrar_compra(teste.ing('Ovo'), 6 * n, 1, 'un', 0.80);
  perform registrar_compra(teste.ing('Leite'), n, 350, 'ml', 2.10);
  perform registrar_compra(teste.ing('Leite condensado'), n, null, null, 5.40);
  perform registrar_compra(teste.ing('Creme de leite'), n, null, null, 3.20);
  perform registrar_compra(teste.ing('Leite em pó'), n, 60, 'g', 2.40);
  perform registrar_compra(teste.ing('Copo'), 8 * n, 1, 'un', 0.50);
  perform registrar_compra(teste.ing('Tampa'), 8 * n, 1, 'un', 0.20);
  perform registrar_compra(teste.ing('Adesivo tabela nutricional'), 8 * n, 1, 'un', 0.10);
  perform registrar_compra(teste.ing('Adesivo logo'), 8 * n, 1, 'un', 0.15);
end $$;

\echo '--- autorização'
begin;
select teste.falha($$select registrar_compra(1, 1, 1, 'un', 1)$$, 'não autorizado', 'sem login não registra compra');
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);
select teste.falha($$select registrar_compra(1, 1, 1, 'un', 1)$$, 'não autorizado', 'usuário logado mas não cadastrado é recusado');
insert into usuarios (nome, auth_user_id) values ('Dona', '00000000-0000-0000-0000-000000000001');
select teste.ok(sanja_autorizado(), 'usuário cadastrado é autorizado');
set local role authenticated;
select teste.ok((select count(*) from ingredientes) = 9, 'app lê os cadastros (RLS)');
select teste.falha($$insert into compras (ingrediente_id, qtd_embalagens, qtd_por_embalagem, preco_unitario, preco_total) values (1, 1, 1, 1, 1)$$,
                     'permission denied', 'app não grava compra direto na tabela');
select teste.falha($$insert into movimentos_estoque (ingrediente_id, tipo, quantidade) values (1, 'ajuste', 5)$$,
                     'permission denied', 'app não mexe no estoque sem passar pelas funções');
select teste.falha($$update ingredientes set custo_medio = 0$$, 'permission denied', 'app não altera o custo médio');
select teste.ok(registrar_compra(teste.ing('Ovo'), 30, 1, 'un', 0.80) > 0, 'app registra compra pela função');
reset role;
set local role anon;
select teste.falha($$select count(*) from ingredientes$$, 'permission denied', 'visitante sem login não lê nada');
reset role;
rollback;

\echo '--- unidades'
select teste.ok(converter_unidade(2, 'kg', 'g') = 2000, 'kg → g');
select teste.ok(converter_unidade(1.5, 'litro', 'ml') = 1500, 'litro → ml');
select teste.falha($$select converter_unidade(1, 'kg', 'ml')$$, 'incompatível', 'kg em ingrediente medido em ml é recusado');

\echo '--- compras e preços'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- "Comprei 10 caixas de leite condensado por R$ 5,40 cada."
select registrar_compra(teste.ing('Leite condensado'), 10, null, null, 5.40, null, '2026-10-01');
select teste.ok(teste.est('Leite condensado') = 3950, 'usa a embalagem cadastrada (10 × 395 g)');
select teste.ok((select preco_total from compras order by id desc limit 1) = 54.00, 'total = 10 × 5,40');
select teste.ok(abs((select custo_medio from ingredientes where nome = 'Leite condensado') - 5.40 / 395) < 1e-6, 'custo médio da primeira compra');
-- segunda compra: 2 latas a R$ 7,00 (total informado)
select registrar_compra(teste.ing('Leite condensado'), 2, 395, 'g', null, 14.00, '2026-10-05', 'Atacadão');
select teste.ok(abs((select custo_medio from ingredientes where nome = 'Leite condensado') - 68.0 / 4740) < 1e-6, 'média ponderada móvel após 2ª compra');
select teste.ok((select round(menor_preco * 395, 2) = 5.40 and round(maior_preco * 395, 2) = 7.00
                     and round(media_simples * 395, 2) = 6.20 and round(media_ponderada * 395, 4) = round(68.0 / 12, 4)
                     from vw_precos_compra where nome = 'Leite condensado'), 'menor, maior, média simples e ponderada');
-- leite em litros: preço normalizado por ml
select registrar_compra(teste.ing('Leite'), 12, 1, 'litro', 4.50);
select teste.ok(teste.est('Leite') = 12000, '12 litros = 12000 ml');
select teste.ok(abs((select preco_por_unidade from compras order by id desc limit 1) - 0.0045) < 1e-9, 'preço por ml');
select teste.ok((select embalagem_qtd from ingredientes where nome = 'Leite') = 1000, 'embalagem do leite aprendida na 1ª compra');
select teste.falha($$select registrar_compra(teste.ing('Ovo'), 30)$$, 'tamanho da embalagem', 'ovo sem embalagem cadastrada pede o tamanho');
select teste.falha($$select registrar_compra(teste.ing('Ovo'), 30, 1, 'un')$$, 'preço', 'compra sem preço é recusada');
select teste.ok((select count(*) from compras_semelhantes(teste.ing('Leite condensado'), 10, '2026-10-02')) = 1, 'detecta compra possivelmente duplicada');
select teste.falha($$update compras set preco_total = 1$$, 'não podem ser alterados', 'histórico de compras é imutável');
rollback;

\echo '--- perdas e ajustes'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select registrar_compra(teste.ing('Ovo'), 30, 1, 'un', 0.80);
select teste.falha($$select registrar_ajuste_estoque(teste.ing('Ovo'), 2, 'perda', '')$$, 'justificativa', 'perda exige justificativa');
select registrar_ajuste_estoque(teste.ing('Ovo'), 2, 'perda', 'quebraram na entrega');
select teste.ok(teste.est('Ovo') = 28, 'perda desconta do estoque');
select registrar_ajuste_estoque(teste.ing('Ovo'), 1, 'ajuste', 'contagem física');
select teste.ok(teste.est('Ovo') = 29, 'ajuste positivo');
select teste.falha($$select registrar_ajuste_estoque(teste.ing('Ovo'), -40, 'ajuste', 'erro')$$, 'negativo', 'ajuste não deixa estoque negativo');
rollback;

\echo '--- receitas e custo'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select teste.abastecer(1);
select teste.ok((select count(*) from receita_itens ri join receita_versoes rv on rv.id = ri.versao_id and rv.vigente
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Ninho') = 9, 'Ninho tem os 9 itens informados');
-- custo do lote Tradicional: 6×0,80 + 2,10 + 5,40 + 3,20 + 8×0,50 + 8×0,20 + 8×0,10 + 8×0,15 = 23,10
select teste.ok((select (custo_receita(rv.id) ->> 'custo_lote')::numeric from receita_versoes rv
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Tradicional' and rv.vigente) = 23.10, 'custo do lote tradicional');
select teste.ok((select (custo_receita(rv.id) ->> 'custo_copo')::numeric from receita_versoes rv
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Tradicional' and rv.vigente) = 2.8875, 'custo por copo (sem calda cadastrada)');
select teste.ok((select (custo_receita(rv.id) ->> 'custo_copo_sem_logo')::numeric from receita_versoes rv
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Tradicional' and rv.vigente) = 2.7375, 'custo por copo sem adesivo de logo');
-- calda: 1 lote serve 24 copos
select salvar_receita('Calda', 'calda', null, 24, jsonb_build_array(jsonb_build_object('ingrediente_id', teste.ing('Leite condensado'), 'quantidade', 395)));
select teste.ok((select (custo_receita(rv.id) ->> 'custo_calda_copo')::numeric from receita_versoes rv
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Tradicional' and rv.vigente) = round(5.40 / 24, 4), 'calda entra no custo por copo');
-- nova versão não altera a anterior
select salvar_receita('Pudim Chocolate', 'pudim', teste.sab('Chocolate'), 8,
                      jsonb_build_array(jsonb_build_object('ingrediente_id', teste.ing('Ovo'), 'quantidade', 5)));
select salvar_receita('Pudim Chocolate', 'pudim', teste.sab('Chocolate'), 8,
                      jsonb_build_array(jsonb_build_object('ingrediente_id', teste.ing('Ovo'), 'quantidade', 6)));
select teste.ok((select count(*) = 2 and count(*) filter (where vigente) = 1 from receita_versoes rv
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Chocolate'), 'histórico de versões');
select teste.ok((select ri.quantidade from receita_itens ri join receita_versoes rv on rv.id = ri.versao_id
                    join receitas r on r.id = rv.receita_id where r.nome = 'Pudim Chocolate' and rv.versao = 1) = 5, 'versão 1 permanece intacta');
select teste.falha($$select salvar_receita('X', 'pudim', teste.sab('Brigadeiro'), 8, '[{"ingrediente_id": 999999, "quantidade": 1}]')$$,
                     'não cadastrado', 'receita não aceita ingrediente inexistente');
rollback;

\echo '--- pedidos e regras comerciais'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select criar_cliente('Camila', 'varejo') \gset cli_
select criar_cliente('Mercadinho Bom Preço', 'revenda') \gset rev_
-- "Entrou pedido da Camila de 16 tradicionais e 8 Ninho para sexta."
select criar_pedido(:cli_criar_cliente, jsonb_build_array(
         jsonb_build_object('sabor_id', teste.sab('Tradicional'), 'quantidade', 16),
         jsonb_build_object('sabor_id', teste.sab('Ninho'), 'quantidade', 8)), '2026-10-23') \gset ped_
select teste.ok((select valor_total = 360 and saldo = 360 and tipo = 'varejo' from vw_pedidos where id = :ped_criar_pedido), 'varejo: 24 × R$ 15,00 = R$ 360,00');
select teste.falha(format($$select criar_pedido(%s, '[{"sabor_id": %s, "quantidade": 10}]')$$, :cli_criar_cliente, teste.sab('Ninho')),
                     'múltiplo de 8', 'quantidade fora do múltiplo de 8 é recusada');
select teste.falha(format($$select criar_pedido(%s, '[{"sabor_id": %s, "quantidade": 16}]')$$, :rev_criar_cliente, teste.sab('Ninho')),
                     'mínimo é 24', 'revenda abaixo de 24 é recusada');
select criar_pedido(:rev_criar_cliente, jsonb_build_array(
         jsonb_build_object('sabor_id', teste.sab('Ninho'), 'quantidade', 8),
         jsonb_build_object('sabor_id', teste.sab('Tradicional'), 'quantidade', 8),
         jsonb_build_object('sabor_id', teste.sab('Doce de Leite'), 'quantidade', 8))) \gset mix_
select teste.ok((select valor_total = 228 from vw_pedidos where id = :mix_criar_pedido), 'revenda com sabores mesclados: 24 × R$ 9,50 = R$ 228,00');
select criar_pedido(:rev_criar_cliente, jsonb_build_array(jsonb_build_object('sabor_id', teste.sab('Ninho'), 'quantidade', 16)),
                    null, null, 'cliente novo, pedido de teste') \gset exc_
select teste.ok((select excecao_motivo = 'cliente novo, pedido de teste' from pedidos where id = :exc_criar_pedido), 'exceção autorizada fica registrada');
update configuracoes set preco_varejo = 16;
select teste.ok((select valor_total = 360 from vw_pedidos where id = :ped_criar_pedido), 'mudar o preço não altera pedido já feito');
select teste.falha(format('select atualizar_status_pedido(%s, %L)', :ped_criar_pedido, 'pronto'), 'não é possível', 'não pula de solicitado para pronto');
rollback;

\echo '--- reserva, lista de compras e produção'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select criar_cliente('Camila') \gset cli_
select criar_pedido(:cli_criar_cliente, jsonb_build_array(
         jsonb_build_object('sabor_id', teste.sab('Tradicional'), 'quantidade', 16),
         jsonb_build_object('sabor_id', teste.sab('Ninho'), 'quantidade', 8, 'sem_logo', true)), '2026-10-23') \gset ped_
select teste.ok(teste.res('Ovo') = 0, 'pedido só solicitado não reserva');
select atualizar_status_pedido(:ped_criar_pedido, 'confirmado');
select teste.ok(teste.res('Ovo') = 18, 'confirmado reserva 3 lotes × 6 ovos');
select teste.ok(teste.res('Leite condensado') = 1185, 'reserva 3 latas de leite condensado');
select teste.ok(teste.res('Leite em pó') = 60, 'só o Ninho usa leite em pó');
select teste.ok(teste.res('Adesivo logo') = 16, 'Ninho sem logo não reserva adesivo de logo');
select teste.ok(teste.est('Ovo') = 0, 'reserva não desconta o estoque físico');

-- lista de compras com estoque parcial e mínimo
update ingredientes set estoque_minimo = 395 where nome = 'Leite condensado';
select registrar_compra(teste.ing('Leite condensado'), 1, null, null, 5.40);
select (lista_compras() -> 'itens') l \gset
select teste.ok((select (x ->> 'necessario')::numeric = 1185 and (x ->> 'estoque')::numeric = 395
                          and (x ->> 'comprar')::numeric = 1185 and (x ->> 'embalagens')::int = 3
                          and (x ->> 'custo_previsto')::numeric = 16.20
                     from jsonb_array_elements(:'l'::jsonb) x where x ->> 'ingrediente' = 'Leite condensado'),
                  'leite condensado: precisa 1185, tem 395, mínimo 395 → 3 latas, R$ 16,20');
select teste.ok((select (x ->> 'comprar')::numeric = 18 and x -> 'custo_previsto' = 'null'::jsonb
                     from jsonb_array_elements(:'l'::jsonb) x where x ->> 'ingrediente' = 'Ovo'),
                  'ovo sem embalagem e sem preço: sugere 18, custo desconhecido');
select teste.ok((lista_compras() -> 'avisos')::text like '%Sem preço de compra para Ovo%', 'avisa ingrediente sem preço');
select teste.ok((lista_compras() -> 'avisos')::text like '%calda%', 'avisa que a calda não tem ingredientes');
select teste.ok((select count(*) from jsonb_array_elements(lista_compras('2026-10-01') -> 'itens') x
                    where (x ->> 'necessario')::numeric > 0) = 0, 'filtro de data: nada a entregar até 01/10');
select teste.ok((select (x ->> 'comprar')::numeric from jsonb_array_elements(lista_compras('2026-10-01') -> 'itens') x
                    where x ->> 'ingrediente' = 'Ovo') = 18, 'mas reservas de pedidos posteriores continuam contando');

-- produção sem estoque é recusada
select teste.falha(format('select registrar_producao(%s, 16)', teste.sab('Tradicional')), 'estoque insuficiente', 'produção sem estoque é recusada');
select teste.abastecer(3);
select teste.falha(format('select registrar_producao(%s, 12)', teste.sab('Tradicional')), 'múltiplo de 8', 'produção fora do múltiplo é recusada');

-- "Registre a produção de 16 tradicionais."
select registrar_producao(teste.sab('Tradicional'), 16) \gset prod_
select teste.ok(teste.est('Ovo') = 6, 'produção baixa 12 ovos (18 − 12)');
select teste.ok(teste.est('Leite condensado') = 395 + 3 * 395 - 790, 'produção baixa 2 latas');
select teste.ok(teste.res('Ovo') = 6, 'reserva cai para o que falta produzir (Ninho)');
select teste.ok((select status from pedidos where id = :ped_criar_pedido) = 'em_producao', 'pedido passa para em produção');
select teste.ok((select custo_total from producoes where id = :prod_registrar_producao) =
                  round(2 * (6 * 0.80 + 2.10 + 5.40 + 3.20 + 8 * 0.50 + 8 * 0.20 + 8 * 0.10 + 8 * 0.15), 2), 'custo da produção congelado');

select registrar_producao(teste.sab('Ninho'), 8, :ped_criar_pedido, true);
select teste.ok(teste.est('Adesivo logo') = 24 - 16, 'produção sem logo não gasta adesivo de logo');
select teste.ok(teste.res('Ovo') = 0, 'nada mais reservado');
select teste.ok((select status from pedidos where id = :ped_criar_pedido) = 'pronto', 'pedido fica pronto quando tudo foi produzido');
select teste.ok((select estoque = 16 and comprometido = 16 and livre = 0 from vw_estoque_pronto where nome = 'Tradicional'), 'pudins prontos comprometidos com o pedido');

-- pagamento e entrega
select teste.falha(format('select registrar_pagamento(%s, 400)', :ped_criar_pedido), 'maior que o saldo', 'pagamento acima do saldo é recusado');
select registrar_pagamento(:ped_criar_pedido, 100);
select teste.ok((select valor_recebido = 100 and saldo = 260 from vw_pedidos where id = :ped_criar_pedido), 'saldo pendente após pagamento parcial');
select registrar_entrega(:ped_criar_pedido, current_date);
select teste.ok((select estoque = 0 from vw_estoque_pronto where nome = 'Tradicional'), 'entrega tira do estoque pronto');
select teste.ok((select status = 'entregue' from pedidos where id = :ped_criar_pedido), 'pedido entregue');
select teste.falha(format('select atualizar_status_pedido(%s, %L)', :ped_criar_pedido, 'cancelado'), 'não é possível', 'pedido entregue não pode ser cancelado');

-- relatório
select relatorio_periodo(current_date, current_date) r \gset
select teste.ok((:'r'::jsonb ->> 'faturamento')::numeric = 360, 'faturamento do dia');
select teste.ok((:'r'::jsonb ->> 'recebido')::numeric = 100, 'recebido do dia');
select teste.ok((:'r'::jsonb ->> 'pudins_vendidos')::int = 24, 'pudins vendidos');
select teste.ok((:'r'::jsonb ->> 'lucro_bruto')::numeric =
                  360 - (select sum(custo_total) from producoes), 'lucro bruto = faturamento − custo dos vendidos');
select teste.ok(:'r'::jsonb -> 'lucro_liquido' = 'null'::jsonb, 'sem despesas, lucro líquido não é apresentado');
select teste.ok((:'r'::jsonb ->> 'pendente_total')::numeric = 260, 'valor pendente');
insert into despesas (descricao, valor) values ('Gás', 50);
select teste.ok((relatorio_periodo(current_date, current_date) ->> 'lucro_liquido')::numeric =
                  (:'r'::jsonb ->> 'lucro_bruto')::numeric - 50, 'lucro líquido com despesas cadastradas');
select teste.ok((resumo_painel() ->> 'faturamento_mes')::numeric = 360, 'painel: faturamento do mês');
rollback;

\echo '--- cancelamento após produção volta como estoque pronto'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select teste.abastecer(2);
select criar_cliente('Ana') \gset a_
select criar_cliente('Bia') \gset b_
select criar_pedido(:a_criar_cliente, jsonb_build_array(jsonb_build_object('sabor_id', teste.sab('Tradicional'), 'quantidade', 8)),
                    null, null, null, null, current_date, 'confirmado') \gset p1_
select registrar_producao(teste.sab('Tradicional'), 8);
select atualizar_status_pedido(:p1_criar_pedido, 'cancelado');
select teste.ok((select livre = 8 from vw_estoque_pronto where nome = 'Tradicional'), 'cancelado após produzir: 8 pudins livres');
select criar_pedido(:b_criar_cliente, jsonb_build_array(jsonb_build_object('sabor_id', teste.sab('Tradicional'), 'quantidade', 8)),
                    null, null, null, null, current_date, 'confirmado') \gset p2_
select teste.ok((select status = 'pronto' from pedidos where id = :p2_criar_pedido), 'novo pedido usa o estoque pronto e já fica pronto');
select teste.ok(teste.res('Ovo') = 0, 'sem reserva de ingredientes para o que já está pronto');
select teste.ok(teste.est('Ovo') = 6, 'ingredientes consumidos uma única vez');
rollback;

\echo '--- auditoria'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select criar_cliente('Teste');
select teste.ok((select canal = 'bot' and tabela = 'clientes' from auditoria order by id desc limit 1), 'alterações ficam na auditoria com o canal');
rollback;

\echo 'TODOS OS TESTES PASSARAM'
