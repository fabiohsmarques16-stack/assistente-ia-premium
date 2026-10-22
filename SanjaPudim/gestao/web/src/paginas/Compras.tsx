import { FormEvent, useState } from 'react';
import { consulta, rpc, supabase } from '../supabase';
import { Mensagem, useAcao } from '../componentes';
import { baixarCSV, fmtData, fmtMoeda, fmtPrecoUnidade, fmtQtd, hojeISO, Linha, somarDias, useDados } from '../util';

const UNIDADES: Record<string, string[]> = { g: ['g', 'kg'], ml: ['ml', 'l'], un: ['un'] };

export default function Compras() {
  const [aba, setAba] = useState('Lista de compras');
  return (
    <div className="pilha">
      <div className="cabecalho"><h1>Compras</h1></div>
      <div className="abas">
        {['Lista de compras', 'Registrar compra', 'Histórico', 'Preços'].map((a) => (
          <button key={a} className={`aba ${a === aba ? 'ativa' : ''}`} onClick={() => setAba(a)}>{a}</button>
        ))}
      </div>
      {aba === 'Lista de compras' && <Lista />}
      {aba === 'Registrar compra' && <Registrar />}
      {aba === 'Histórico' && <Historico />}
      {aba === 'Preços' && <Precos />}
    </div>
  );
}

function Lista() {
  const [ate, setAte] = useState(somarDias(hojeISO(), 7));
  const [todos, setTodos] = useState(false);
  const [solicitados, setSolicitados] = useState(true);
  const { dados, erro } = useDados(() => rpc<Linha>('lista_compras', { p_ate: todos ? null : ate, p_incluir_solicitados: solicitados }), [ate, todos, solicitados]);
  const itens = (dados?.itens ?? []) as Linha[];
  return (
    <div className="cartao pilha">
      <div className="linha nao-imprimir">
        <label className="campo">Pedidos com entrega até<input type="date" value={ate} disabled={todos} onChange={(e) => setAte(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />todos em aberto</label>
        <label className="check"><input type="checkbox" checked={solicitados} onChange={(e) => setSolicitados(e.target.checked)} />incluir pedidos ainda não confirmados</label>
        <span className="espaco" />
        <button className="botao sec peq" disabled={!itens.length} onClick={() => baixarCSV(`lista-compras-${hojeISO()}.csv`, itens, [
          ['ingrediente', 'Ingrediente'], ['unidade', 'Unidade'], ['necessario', 'Necessário'], ['estoque', 'Em estoque'], ['reservado', 'Reservado'],
          ['estoque_minimo', 'Mínimo'], ['comprar', 'Comprar'], ['embalagens', 'Embalagens'], ['custo_previsto', 'Custo previsto (R$)']])}>Exportar CSV</button>
        <button className="botao sec peq" onClick={() => print()}>Imprimir / PDF</button>
      </div>
      <Mensagem erro={erro} />
      {(dados?.avisos as string[] | undefined)?.map((a) => <div key={a} className="aviso alerta">{a}</div>)}
      {dados && itens.length === 0 && <div className="vazio">Nada a comprar: o estoque cobre os pedidos e o mínimo.</div>}
      {itens.length > 0 && <div className="tabela-wrap"><table>
        <thead><tr><th>Ingrediente</th><th className="num">Necessário</th><th className="num">Em estoque</th><th className="num">Reservado</th><th className="num">Mínimo</th><th className="num">Comprar</th><th className="num">Preço est.</th><th className="num">Custo previsto</th></tr></thead>
        <tbody>{itens.map((i) => (
          <tr key={i.ingrediente_id}>
            <td><strong>{i.ingrediente}</strong></td>
            <td className="num">{fmtQtd(i.necessario, i.unidade)}</td>
            <td className="num">{fmtQtd(i.estoque, i.unidade)}</td>
            <td className="num">{fmtQtd(i.reservado, i.unidade)}</td>
            <td className="num">{fmtQtd(i.estoque_minimo, i.unidade)}</td>
            <td className="num"><strong>{Number(i.comprar) > 0 ? (i.embalagens ? `${i.embalagens} × ${fmtQtd(i.tamanho_embalagem, i.unidade)}` : fmtQtd(i.comprar, i.unidade)) : '—'}</strong></td>
            <td className="num">{fmtPrecoUnidade(i.preco_unidade, i.unidade)}</td>
            <td className="num">{fmtMoeda(i.custo_previsto)}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={7}><strong>Total previsto</strong></td><td className="num"><strong>{fmtMoeda(dados?.custo_total_previsto)}</strong></td></tr></tfoot>
      </table></div>}
      <p className="mudo">Comprar = necessário + reservas de outros pedidos + estoque mínimo − estoque, arredondado para embalagens inteiras.</p>
    </div>
  );
}

function Registrar() {
  const { dados: ingredientes } = useDados(() => consulta<Linha[]>(supabase.from('ingredientes').select('*').eq('ativo', true).order('nome')));
  const [id, setId] = useState('');
  const [emb, setEmb] = useState('');
  const [tam, setTam] = useState('');
  const [un, setUn] = useState('');
  const [modo, setModo] = useState('unitario');
  const [preco, setPreco] = useState('');
  const [data, setData] = useState(hojeISO());
  const [forn, setForn] = useState('');
  const [marca, setMarca] = useState('');
  const [validade, setValidade] = useState('');
  const acao = useAcao();
  const ing = ingredientes?.find((i) => String(i.id) === id);
  const n = (s: string) => Number(s.replace(',', '.'));

  function escolher(v: string) {
    setId(v);
    const i = ingredientes?.find((x) => String(x.id) === v);
    setUn(i?.unidade ?? '');
    setTam(i?.embalagem_qtd ? String(Number(i.embalagem_qtd)) : '');
    setMarca(i?.marca ?? '');
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const parecidas = await rpc<Linha[]>('compras_semelhantes', { p_ingrediente_id: Number(id), p_qtd_embalagens: n(emb), p_data: data });
    if (parecidas.length && !confirm(`Já existe compra de ${emb} embalagens de ${ing?.nome} em ${fmtData(parecidas[0].data_compra)}. Registrar mesmo assim?`)) return;
    const ok = await acao.executar(() => rpc('registrar_compra', {
      p_ingrediente_id: Number(id), p_qtd_embalagens: n(emb), p_qtd_por_embalagem: tam ? n(tam) : null, p_unidade: un || null,
      p_preco_unitario: modo === 'unitario' ? n(preco) : null, p_preco_total: modo === 'total' ? n(preco) : null,
      p_data: data, p_fornecedor: forn || null, p_marca: marca || null, p_validade: validade || null,
    }), `Compra registrada: ${emb} × ${ing?.nome}.`);
    if (ok) { setEmb(''); setPreco(''); setValidade(''); }
  }

  const total = emb && preco ? (modo === 'unitario' ? n(emb) * n(preco) : n(preco)) : null;
  return (
    <form className="cartao form" onSubmit={salvar}>
      <label className="campo largo">Ingrediente / embalagem<select required value={id} onChange={(e) => escolher(e.target.value)}>
        <option value="">Selecione…</option>{ingredientes?.map((i) => <option key={i.id} value={i.id}>{i.nome}{i.marca ? ` · ${i.marca}` : ''}</option>)}</select></label>
      <label className="campo">Nº de embalagens<input inputMode="decimal" required value={emb} onChange={(e) => setEmb(e.target.value)} /></label>
      <label className="campo">Conteúdo de cada embalagem<input inputMode="decimal" required value={tam} placeholder="ex.: 395" onChange={(e) => setTam(e.target.value)} /></label>
      <label className="campo">Unidade<select value={un} onChange={(e) => setUn(e.target.value)} disabled={!ing}>
        {(UNIDADES[ing?.unidade] ?? []).map((u) => <option key={u}>{u}</option>)}</select></label>
      <label className="campo">Preço informado<select value={modo} onChange={(e) => setModo(e.target.value)}>
        <option value="unitario">por embalagem</option><option value="total">total da compra</option></select></label>
      <label className="campo">Valor (R$)<input inputMode="decimal" required value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
      <label className="campo">Data da compra<input type="date" required value={data} onChange={(e) => setData(e.target.value)} /></label>
      <label className="campo">Fornecedor (opcional)<input value={forn} onChange={(e) => setForn(e.target.value)} /></label>
      <label className="campo">Marca (opcional)<input value={marca} onChange={(e) => setMarca(e.target.value)} /></label>
      <label className="campo">Validade (opcional)<input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></label>
      <div className="largo mudo">{total != null && !Number.isNaN(total) ? `Total: ${fmtMoeda(total)}` : ''}</div>
      <div className="largo"><Mensagem erro={acao.erro} ok={acao.ok} /></div>
      <button className="botao largo" disabled={acao.ocupado}>Registrar compra</button>
    </form>
  );
}

function Historico() {
  const { dados, erro } = useDados(() => consulta<Linha[]>(supabase.from('compras')
    .select('*, ingredientes(nome, unidade), fornecedores(nome)').order('data_compra', { ascending: false }).order('id', { ascending: false }).limit(200)));
  return (
    <div className="cartao">
      <Mensagem erro={erro} />
      {dados?.length === 0 && <div className="vazio">Nenhuma compra registrada.</div>}
      {!!dados?.length && <div className="tabela-wrap"><table>
        <thead><tr><th>Data</th><th>Item</th><th className="num">Qtd.</th><th className="num">Preço/emb.</th><th className="num">Total</th><th className="num">Preço normalizado</th><th>Fornecedor</th></tr></thead>
        <tbody>{dados.map((c) => (
          <tr key={c.id}><td>{fmtData(c.data_compra)}</td><td>{c.ingredientes?.nome}{c.marca ? ` · ${c.marca}` : ''}</td>
            <td className="num">{Number(c.qtd_embalagens)} × {fmtQtd(c.qtd_por_embalagem, c.ingredientes?.unidade)}</td>
            <td className="num">{fmtMoeda(c.preco_unitario)}</td><td className="num">{fmtMoeda(c.preco_total)}</td>
            <td className="num">{fmtPrecoUnidade(c.preco_por_unidade, c.ingredientes?.unidade)}</td><td>{c.fornecedores?.nome ?? '—'}</td></tr>))}</tbody>
      </table></div>}
    </div>
  );
}

function Precos() {
  const { dados, erro } = useDados(() => consulta<Linha[]>(supabase.from('vw_precos_compra').select('*').order('nome')));
  return (
    <div className="cartao">
      <Mensagem erro={erro} />
      {dados?.length === 0 && <div className="vazio">Sem compras registradas ainda.</div>}
      {!!dados?.length && <div className="tabela-wrap"><table>
        <thead><tr><th>Item</th><th className="num">Compras</th><th className="num">Menor</th><th className="num">Maior</th><th className="num">Média simples</th><th className="num">Média ponderada</th><th className="num">Último</th></tr></thead>
        <tbody>{dados.map((p) => (
          <tr key={p.ingrediente_id}><td>{p.nome}</td><td className="num">{p.compras}</td>
            <td className="num">{fmtPrecoUnidade(p.menor_preco, p.unidade)}</td><td className="num">{fmtPrecoUnidade(p.maior_preco, p.unidade)}</td>
            <td className="num">{fmtPrecoUnidade(p.media_simples, p.unidade)}</td><td className="num">{fmtPrecoUnidade(p.media_ponderada, p.unidade)}</td>
            <td className="num">{fmtPrecoUnidade(p.ultimo_preco, p.unidade)}</td></tr>))}</tbody>
      </table></div>}
      <p className="mudo">Preços normalizados por kg, litro ou unidade. A média ponderada considera a quantidade comprada em cada compra.</p>
    </div>
  );
}
