-- SANJA Gestão — dados iniciais informados pela Sanja Pudim (22/10/2026)
-- Só entra aqui o que foi informado. Tamanho de embalagem desconhecido fica vazio
-- e é preenchido na primeira compra. A receita da calda ainda não foi informada.

do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); end $$;

insert into sabores (nome) values ('Tradicional'), ('Ninho'), ('Doce de Leite'), ('Brigadeiro'), ('Chocolate');

insert into ingredientes (nome, tipo, unidade, embalagem_qtd) values
  ('Ovo',                     'ingrediente', 'un', null),
  ('Leite',                   'ingrediente', 'ml', null),
  ('Leite condensado',        'ingrediente', 'g',  395),
  ('Creme de leite',          'ingrediente', 'g',  200),
  ('Leite em pó',             'ingrediente', 'g',  null),
  ('Copo',                    'embalagem',   'un', null),
  ('Tampa',                   'embalagem',   'un', null),
  ('Adesivo tabela nutricional', 'embalagem', 'un', null),
  ('Adesivo logo',            'embalagem',   'un', null);

-- Calda: receita própria, feita em lote separado (ingredientes e rendimento a cadastrar)
insert into receitas (nome, tipo) values ('Calda', 'calda');

do $$
declare
  ing jsonb := (select jsonb_object_agg(nome, id) from ingredientes);
  calda bigint := (select id from receitas where nome = 'Calda');
  base jsonb;
begin
  base := jsonb_build_array(
    jsonb_build_object('ingrediente_id', ing -> 'Ovo', 'quantidade', 6),
    jsonb_build_object('ingrediente_id', ing -> 'Leite', 'quantidade', 350),
    jsonb_build_object('ingrediente_id', ing -> 'Leite condensado', 'quantidade', 395),
    jsonb_build_object('ingrediente_id', ing -> 'Creme de leite', 'quantidade', 200),
    jsonb_build_object('ingrediente_id', ing -> 'Copo', 'quantidade', 8),
    jsonb_build_object('ingrediente_id', ing -> 'Tampa', 'quantidade', 8),
    jsonb_build_object('ingrediente_id', ing -> 'Adesivo tabela nutricional', 'quantidade', 8),
    jsonb_build_object('ingrediente_id', ing -> 'Adesivo logo', 'quantidade', 8, 'opcional_codigo', 'logo'));

  perform salvar_receita('Pudim Tradicional', 'pudim', (select id from sabores where nome = 'Tradicional'),
                         8, base, calda, 'Receita informada pela proprietária.');
  perform salvar_receita('Pudim Ninho', 'pudim', (select id from sabores where nome = 'Ninho'),
                         8, base || jsonb_build_array(jsonb_build_object('ingrediente_id', ing -> 'Leite em pó', 'quantidade', 60)),
                         calda, 'Receita informada pela proprietária.');
  perform salvar_receita('Pudim Doce de Leite', 'pudim', (select id from sabores where nome = 'Doce de Leite'),
                         8, base, calda, 'Leite condensado cozido (doce de leite). Receita informada pela proprietária.');
end $$;

do $$ begin perform set_config('request.jwt.claims', '', false); end $$;
