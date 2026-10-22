-- SANJA Gestão — segurança e auditoria
-- Leitura: usuários autorizados. Escrita direta: apenas cadastros simples.
-- Movimentações (compras, estoque, pedidos, pagamentos, produção) só por funções.

do $$
declare t text;
begin
  foreach t in array array[
    'configuracoes', 'usuarios', 'fornecedores', 'ingredientes', 'compras', 'sabores', 'receitas',
    'receita_versoes', 'receita_itens', 'clientes', 'pedidos', 'pedido_itens', 'pagamentos', 'producoes',
    'movimentos_estoque', 'movimentos_pronto', 'alocacoes', 'despesas', 'auditoria',
    'bot_confirmacoes', 'bot_mensagens']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy leitura_autorizados on %I for select to authenticated using (sanja_autorizado())', t);
  end loop;

  -- cadastros editáveis diretamente pelo app
  foreach t in array array['fornecedores', 'ingredientes', 'sabores', 'clientes', 'despesas'] loop
    execute format('create policy insere_autorizados on %I for insert to authenticated with check (sanja_autorizado())', t);
    execute format('create policy altera_autorizados on %I for update to authenticated using (sanja_autorizado()) with check (sanja_autorizado())', t);
  end loop;
  create policy altera_autorizados on configuracoes for update to authenticated
    using (sanja_autorizado()) with check (sanja_autorizado());
  create policy remove_autorizados on despesas for delete to authenticated using (sanja_autorizado());
end $$;

-- dados do bot e auditoria não são lidos pelo app
drop policy leitura_autorizados on bot_confirmacoes;
drop policy leitura_autorizados on bot_mensagens;

----------------------------------------------------------------------
-- Auditoria
----------------------------------------------------------------------
create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
begin
  insert into auditoria (tabela, operacao, registro_id, antes, depois, usuario, canal)
  values (tg_table_name, tg_op, (coalesce(v_novo, v_velho) ->> 'id')::bigint, v_velho, v_novo,
          coalesce(auth.uid()::text, nullif(sanja_papel(), ''), session_user),
          case sanja_papel() when 'service_role' then 'bot' when 'authenticated' then 'app' else 'sistema' end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'configuracoes', 'usuarios', 'fornecedores', 'ingredientes', 'compras', 'sabores', 'receitas',
    'receita_versoes', 'receita_itens', 'clientes', 'pedidos', 'pedido_itens', 'pagamentos', 'producoes',
    'movimentos_estoque', 'movimentos_pronto', 'alocacoes', 'despesas']
  loop
    execute format('create trigger auditoria after insert or update or delete on %I for each row execute function auditar()', t);
  end loop;
end $$;

-- histórico de compras, movimentos e auditoria nunca são apagados ou alterados
create or replace function bloquear_alteracao() returns trigger language plpgsql as $$
begin
  raise exception 'Registros de % não podem ser alterados ou apagados. Use um ajuste.', tg_table_name;
end $$;
create trigger imutavel before update or delete on compras for each row execute function bloquear_alteracao();
create trigger imutavel before update or delete on movimentos_estoque for each row execute function bloquear_alteracao();
create trigger imutavel before update or delete on movimentos_pronto for each row execute function bloquear_alteracao();
create trigger imutavel before update or delete on auditoria for each row execute function bloquear_alteracao();
create trigger imutavel before update or delete on receita_itens for each row execute function bloquear_alteracao();

----------------------------------------------------------------------
-- Privilégios
----------------------------------------------------------------------
-- O Supabase concede tudo por padrão a anon e authenticated em tabelas e funções novas.
-- Esta função deixa só o necessário. Rode de novo após restaurar um backup:
--   select sanja_aplicar_permissoes();
create or replace function sanja_aplicar_permissoes() returns void language plpgsql as $$
begin
  revoke all on all tables in schema public from anon, authenticated;
  grant all on all tables in schema public to service_role;
  grant usage on all sequences in schema public to authenticated, service_role;
  grant select on all tables in schema public to authenticated;
  grant insert, update on fornecedores, sabores, clientes, despesas to authenticated;
  grant delete on despesas to authenticated;
  grant update on configuracoes to authenticated;
  -- custo médio é calculado pelas compras e a unidade não muda depois de criada
  grant insert (nome, marca, tipo, unidade, embalagem_qtd, estoque_minimo, ativo),
        update (nome, marca, tipo, embalagem_qtd, estoque_minimo, ativo) on ingredientes to authenticated;

  -- funções: só usuários logados (cada uma ainda checa sanja_autorizado)
  revoke execute on all functions in schema public from public, anon, authenticated;
  grant execute on all functions in schema public to authenticated, service_role;
  revoke execute on function sanja_aplicar_permissoes() from authenticated, service_role;
end $$;

select sanja_aplicar_permissoes();
