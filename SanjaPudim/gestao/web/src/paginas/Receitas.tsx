import { FormEvent, useState } from 'react';
import { consulta, rpc, supabase } from '../supabase';
import { Mensagem, Modal, useAcao } from '../componentes';
import { fmtData, fmtMoeda, fmtQtd, Linha, useDados } from '../util';

export default function Receitas() {
  const [editando, setEditando] = useState<Linha | null>(null);
  const { dados, erro, recarregar } = useDados(async () => {
    const [receitas, versoes, ingredientes, sabores] = await Promise.all([
      consulta<Linha[]>(supabase.from('receitas').select('*, sabores(nome)').eq('ativo', true).order('tipo', { ascending: false }).order('id')),
      consulta<Linha[]>(supabase.from('receita_versoes').select('*').order('versao', { ascending: false })),
      consulta<Linha[]>(supabase.from('ingredientes').select('*').eq('ativo', true).order('nome')),
      consulta<Linha[]>(supabase.from('sabores').select('*').eq('ativo', true).order('id')),
    ]);
    const vigentes = versoes.filter((v) => v.vigente);
    const custos = await Promise.all(vigentes.map((v) => rpc<Linha>('custo_receita', { p_versao_id: v.id })));
    return {
      receitas: receitas.map((r): Linha => {
        const v = vigentes.find((x) => x.receita_id === r.id);
        return { ...r, versao: v, custo: v ? custos[vigentes.indexOf(v)] : null, versoes: versoes.filter((x) => x.receita_id === r.id).length };
      }),
      ingredientes, sabores,
    };
  });

  const semReceita = dados?.sabores.filter((s) => !dados.receitas.some((r) => r.sabor_id === s.id && r.custo?.tem_itens)) ?? [];

  return (
    <div className="pilha">
      <div className="cabecalho">
        <h1>Receitas</h1>
        <button className="botao" onClick={() => setEditando({})}>+ Nova receita</button>
      </div>
      <Mensagem erro={erro} />
      {semReceita.length > 0 && <div className="aviso alerta">Sem receita cadastrada: {semReceita.map((s) => s.nome).join(', ')}. Esses sabores não entram no cálculo de compras e não podem ser produzidos.</div>}
      <div className="grade grade-2">
        {dados?.receitas.map((r) => (
          <article key={r.id} className="cartao pilha" style={{ gap: 10 }}>
            <div className="linha">
              <div><strong>{r.nome}</strong>
                <div className="mudo">{r.tipo === 'calda' ? 'Calda (lote separado)' : r.sabores?.nome}{r.versao ? ` · versão ${r.versao.versao} de ${fmtData(r.versao.criado_em)} · rende ${Number(r.versao.rendimento)} copos` : ''}</div></div>
              <span className="espaco" />
              <button className="botao sec peq" onClick={() => setEditando(r)}>Editar</button>
            </div>
            {!r.custo?.tem_itens
              ? <div className="aviso alerta">Ingredientes ainda não cadastrados.</div>
              : <>
                  <ul className="lista">{(r.custo.itens as Linha[]).map((i) => (
                    <li key={i.ingrediente_id}><span>{i.nome}{i.opcional_codigo === 'logo' ? <span className="mudo"> (retirado em pedido sem logo)</span> : ''}</span>
                      <span className="mudo">{fmtQtd(i.quantidade, i.unidade)} · {i.preco_unidade == null ? 'sem preço' : fmtMoeda(i.custo)}</span></li>))}</ul>
                  <div className="linha">
                    <span>Lote: <strong>{fmtMoeda(r.custo.custo_lote)}</strong></span>
                    <span>Por copo: <strong>{fmtMoeda(r.custo.custo_copo)}</strong></span>
                    {r.tipo === 'pudim' && <span className="mudo">sem logo {fmtMoeda(r.custo.custo_copo_sem_logo)}</span>}
                  </div>
                  {r.tipo === 'pudim' && <div className="mudo">Inclui calda {fmtMoeda(r.custo.custo_calda_copo)}/copo{r.custo.calda_vinculada && !r.custo.calda_tem_itens ? ' (receita da calda pendente)' : ''}.</div>}
                  {(r.custo.itens_sem_preco as string[]).length > 0 && <div className="aviso info">Custo parcial: sem preço de compra para {(r.custo.itens_sem_preco as string[]).join(', ')}.</div>}
                </>}
          </article>
        ))}
      </div>
      {editando && dados && <Editor receita={editando} todas={dados.receitas} ingredientes={dados.ingredientes} sabores={dados.sabores}
        aoFechar={(s) => { setEditando(null); if (s) recarregar(); }} />}
    </div>
  );
}

function Editor({ receita, todas, ingredientes, sabores, aoFechar }:
  { receita: Linha; todas: Linha[]; ingredientes: Linha[]; sabores: Linha[]; aoFechar: (s?: boolean) => void }) {
  const nova = !receita.id;
  const [tipo, setTipo] = useState(receita.tipo ?? 'pudim');
  const [nome, setNome] = useState(receita.nome ?? '');
  const [sabor, setSabor] = useState(String(receita.sabor_id ?? ''));
  const [rend, setRend] = useState(String(Number(receita.versao?.rendimento ?? 8)));
  const caldas = todas.filter((r) => r.tipo === 'calda');
  const [calda, setCalda] = useState(String(receita.versao?.receita_calda_id ?? (nova ? caldas[0]?.id ?? '' : '')));
  const [itens, setItens] = useState<Linha[]>(
    (receita.custo?.itens as Linha[] | undefined)?.map((i) => ({ ingrediente_id: String(i.ingrediente_id), quantidade: String(Number(i.quantidade)), logo: i.opcional_codigo === 'logo' })) ?? [],
  );
  const [obs, setObs] = useState('');
  const acao = useAcao();
  const mudar = (k: number, campo: string, v: unknown) => setItens(itens.map((i, j) => (j === k ? { ...i, [campo]: v } : i)));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await acao.executar(() => rpc('salvar_receita', {
      p_nome: nome, p_tipo: tipo, p_sabor_id: tipo === 'pudim' ? Number(sabor) : null, p_rendimento: Number(rend),
      p_itens: itens.filter((i) => i.ingrediente_id && Number(i.quantidade) > 0).map((i) => ({
        ingrediente_id: Number(i.ingrediente_id), quantidade: Number(String(i.quantidade).replace(',', '.')), opcional_codigo: i.logo ? 'logo' : null,
      })),
      p_receita_calda_id: tipo === 'pudim' && calda ? Number(calda) : null, p_observacao: obs || null,
    }));
    if (ok) aoFechar(true);
  }

  return (
    <Modal titulo={nova ? 'Nova receita' : `Editar ${receita.nome}`} aoFechar={() => aoFechar()}>
      <form className="pilha" onSubmit={salvar}>
        {!nova && <div className="aviso info">Salvar cria a versão {(receita.versoes ?? 0) + 1}. Produções e custos anteriores continuam com a versão antiga.</div>}
        <div className="form">
          {nova && <label className="campo">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="pudim">Pudim</option><option value="calda">Calda</option></select></label>}
          <label className="campo">Nome<input required value={nome} disabled={!nova} onChange={(e) => setNome(e.target.value)} /></label>
          {tipo === 'pudim' && <label className="campo">Sabor<select required value={sabor} disabled={!nova} onChange={(e) => setSabor(e.target.value)}>
            <option value="">Selecione…</option>{sabores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>}
          <label className="campo">Rendimento (copos por lote)<input type="number" min={1} step="any" required value={rend} onChange={(e) => setRend(e.target.value)} /></label>
          {tipo === 'pudim' && <label className="campo">Calda<select value={calda} onChange={(e) => setCalda(e.target.value)}>
            <option value="">Sem calda</option>{caldas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>}
        </div>
        <div>
          <h3>Ingredientes por lote</h3>
          {itens.map((i, k) => {
            const ing = ingredientes.find((x) => String(x.id) === i.ingrediente_id);
            return (
              <div className="form" key={k} style={{ marginBottom: 8 }}>
                <label className="campo">Item<select value={i.ingrediente_id} onChange={(e) => mudar(k, 'ingrediente_id', e.target.value)}>
                  <option value="">Selecione…</option>{ingredientes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
                <label className="campo">Quantidade ({ing?.unidade ?? '—'})<input inputMode="decimal" value={i.quantidade} onChange={(e) => mudar(k, 'quantidade', e.target.value)} /></label>
                <div className="linha">
                  <label className="check"><input type="checkbox" checked={Boolean(i.logo)} onChange={(e) => mudar(k, 'logo', e.target.checked)} />é o adesivo de logo</label>
                  <button type="button" className="botao perigo peq" onClick={() => setItens(itens.filter((_, j) => j !== k))}>Remover</button>
                </div>
              </div>
            );
          })}
          <button type="button" className="botao sec peq" onClick={() => setItens([...itens, { ingrediente_id: '', quantidade: '' }])}>+ Adicionar item</button>
          <p className="mudo">Ingrediente que não está na lista? Cadastre primeiro em Estoque → + Ingrediente.</p>
        </div>
        <label className="campo">O que mudou (opcional)<input value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        <Mensagem erro={acao.erro} />
        <button className="botao" disabled={acao.ocupado}>Salvar versão</button>
      </form>
    </Modal>
  );
}
