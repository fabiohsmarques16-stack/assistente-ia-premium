import { FormEvent, useState } from 'react';
import { consulta, rpc, supabase } from '../supabase';
import { Mensagem, Modal, useAcao } from '../componentes';
import { fmtPrecoUnidade, fmtQtd, Linha, useDados } from '../util';

const UNIDADES: Record<string, string[]> = { g: ['g', 'kg'], ml: ['ml', 'l'], un: ['un'] };

export default function Estoque() {
  const [aba, setAba] = useState('Ingredientes');
  const [modal, setModal] = useState<string | null>(null);
  const [editando, setEditando] = useState<Linha | null>(null);
  const { dados, erro, recarregar } = useDados(async () => {
    const [estoque, prontos, sabores] = await Promise.all([
      consulta<Linha[]>(supabase.from('vw_estoque').select('*').order('tipo').order('nome')),
      consulta<Linha[]>(supabase.from('vw_estoque_pronto').select('*').order('sabor_id')),
      consulta<Linha[]>(supabase.from('sabores').select('*').eq('ativo', true).order('id')),
    ]);
    return { estoque, prontos, sabores };
  });
  const fechar = (salvou?: boolean) => { setModal(null); setEditando(null); if (salvou) recarregar(); };

  return (
    <div className="pilha">
      <div className="cabecalho">
        <h1>Estoque</h1>
        <div className="linha">
          <button className="botao" onClick={() => setModal('producao')}>Registrar produção</button>
          <button className="botao sec" onClick={() => setModal('ajuste')}>Perda / ajuste</button>
          <button className="botao sec" onClick={() => setModal('ingrediente')}>+ Ingrediente</button>
        </div>
      </div>
      <div className="abas">
        {['Ingredientes', 'Pudins prontos'].map((a) => (
          <button key={a} className={`aba ${a === aba ? 'ativa' : ''}`} onClick={() => setAba(a)}>{a}</button>
        ))}
      </div>
      <Mensagem erro={erro} />

      {dados && aba === 'Ingredientes' && (
        <div className="cartao"><div className="tabela-wrap"><table>
          <thead><tr><th>Item</th><th className="num">Em estoque</th><th className="num">Reservado</th><th className="num">Disponível</th><th className="num">Mínimo</th><th className="num">Custo médio</th><th></th></tr></thead>
          <tbody>{dados.estoque.map((i) => (
            <tr key={i.id}>
              <td>{i.abaixo_minimo && <span title="Abaixo do mínimo">⚠ </span>}<strong>{i.nome}</strong>{i.marca ? ` · ${i.marca}` : ''}
                <div className="mudo">{i.tipo === 'embalagem' ? 'Embalagem' : 'Ingrediente'}{i.embalagem_qtd ? ` · emb. ${fmtQtd(i.embalagem_qtd, i.unidade)}` : ' · embalagem a definir'}</div></td>
              <td className="num">{fmtQtd(i.estoque_fisico, i.unidade)}</td>
              <td className="num">{fmtQtd(i.reservado, i.unidade)}</td>
              <td className="num" style={{ color: i.abaixo_minimo ? 'var(--erro)' : undefined, fontWeight: 600 }}>{fmtQtd(i.disponivel, i.unidade)}</td>
              <td className="num">{fmtQtd(i.estoque_minimo, i.unidade)}</td>
              <td className="num">{Number(i.custo_medio) > 0 ? fmtPrecoUnidade(i.custo_medio, i.unidade) : '—'}</td>
              <td><button className="botao sec peq" onClick={() => { setEditando(i); setModal('ingrediente'); }}>Editar</button></td>
            </tr>))}</tbody>
        </table></div>
        <p className="mudo">Reservado = ingredientes dos pedidos confirmados que ainda não foram produzidos. A baixa acontece ao registrar a produção.</p></div>
      )}

      {dados && aba === 'Pudins prontos' && (
        <div className="cartao"><div className="tabela-wrap"><table>
          <thead><tr><th>Sabor</th><th className="num">Prontos</th><th className="num">Destinados a pedidos</th><th className="num">Livres</th></tr></thead>
          <tbody>{dados.prontos.map((p) => (
            <tr key={p.sabor_id}><td>{p.nome}</td><td className="num">{p.estoque}</td><td className="num">{p.comprometido}</td><td className="num"><strong>{p.livre}</strong></td></tr>))}</tbody>
        </table></div>
        <p className="mudo">Pudins livres (ex.: de pedido cancelado) são usados automaticamente no próximo pedido confirmado do mesmo sabor.</p></div>
      )}

      {modal === 'producao' && dados && <Producao sabores={dados.sabores} aoFechar={fechar} />}
      {modal === 'ajuste' && dados && <Ajuste itens={dados.estoque} sabores={dados.sabores} aoFechar={fechar} />}
      {modal === 'ingrediente' && <Ingrediente atual={editando} aoFechar={fechar} />}
    </div>
  );
}

function Producao({ sabores, aoFechar }: { sabores: Linha[]; aoFechar: (s?: boolean) => void }) {
  const [sabor, setSabor] = useState(String(sabores[0]?.id ?? ''));
  const [qtd, setQtd] = useState('8');
  const [semLogo, setSemLogo] = useState(false);
  const [excecao, setExcecao] = useState('');
  const acao = useAcao();
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (await acao.executar(() => rpc('registrar_producao', {
      p_sabor_id: Number(sabor), p_quantidade: Number(qtd), p_sem_logo: semLogo, p_excecao_motivo: excecao || null,
    }))) aoFechar(true);
  }
  return (
    <Modal titulo="Registrar produção" aoFechar={() => aoFechar()}>
      <form className="form" onSubmit={salvar}>
        <label className="campo">Sabor<select value={sabor} onChange={(e) => setSabor(e.target.value)}>
          {sabores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
        <label className="campo">Quantidade (copos)<input type="number" min={1} step={1} required value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
        <label className="check largo"><input type="checkbox" checked={semLogo} onChange={(e) => setSemLogo(e.target.checked)} />Sem adesivo de logo</label>
        <label className="campo largo">Motivo da exceção (só se não for múltiplo de 8)<input value={excecao} onChange={(e) => setExcecao(e.target.value)} /></label>
        <div className="largo mudo">Os ingredientes da receita são baixados do estoque e os pudins vão para os pedidos confirmados mais próximos da entrega.</div>
        <div className="largo"><Mensagem erro={acao.erro} /></div>
        <button className="botao largo" disabled={acao.ocupado}>Confirmar produção</button>
      </form>
    </Modal>
  );
}

function Ajuste({ itens, sabores, aoFechar }: { itens: Linha[]; sabores: Linha[]; aoFechar: (s?: boolean) => void }) {
  const [alvo, setAlvo] = useState('ingrediente');
  const [id, setId] = useState(String(itens[0]?.id ?? ''));
  const [sabor, setSabor] = useState(String(sabores[0]?.id ?? ''));
  const [tipo, setTipo] = useState('perda');
  const [qtd, setQtd] = useState('');
  const [unidade, setUnidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const acao = useAcao();
  const item = itens.find((i) => String(i.id) === id);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const n = Number(qtd.replace(',', '.'));
    const ok = await acao.executar(() => alvo === 'ingrediente'
      ? rpc('registrar_ajuste_estoque', { p_ingrediente_id: Number(id), p_quantidade: n, p_tipo: tipo, p_justificativa: motivo, p_unidade: unidade || item?.unidade })
      : rpc('registrar_ajuste_pronto', { p_sabor_id: Number(sabor), p_quantidade: Math.round(n), p_tipo: tipo, p_justificativa: motivo }));
    if (ok) aoFechar(true);
  }
  return (
    <Modal titulo="Perda ou ajuste de estoque" aoFechar={() => aoFechar()}>
      <form className="form" onSubmit={salvar}>
        <label className="campo">Estoque de<select value={alvo} onChange={(e) => setAlvo(e.target.value)}>
          <option value="ingrediente">Ingredientes / embalagens</option><option value="pronto">Pudins prontos</option></select></label>
        <label className="campo">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="perda">Perda / desperdício</option><option value="ajuste">Ajuste (+ ou −)</option></select></label>
        {alvo === 'ingrediente'
          ? <>
              <label className="campo">Item<select value={id} onChange={(e) => { setId(e.target.value); setUnidade(''); }}>
                {itens.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</select></label>
              <label className="campo">Unidade<select value={unidade || item?.unidade} onChange={(e) => setUnidade(e.target.value)}>
                {(UNIDADES[item?.unidade] ?? []).map((u) => <option key={u}>{u}</option>)}</select></label>
            </>
          : <label className="campo">Sabor<select value={sabor} onChange={(e) => setSabor(e.target.value)}>
              {sabores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>}
        <label className="campo">Quantidade{tipo === 'ajuste' ? ' (use − para retirar)' : ''}<input inputMode="decimal" required value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
        <label className="campo largo">Justificativa (obrigatória)<input required value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
        <div className="largo"><Mensagem erro={acao.erro} /></div>
        <button className="botao largo" disabled={acao.ocupado}>Registrar</button>
      </form>
    </Modal>
  );
}

function Ingrediente({ atual, aoFechar }: { atual: Linha | null; aoFechar: (s?: boolean) => void }) {
  const [nome, setNome] = useState(atual?.nome ?? '');
  const [marca, setMarca] = useState(atual?.marca ?? '');
  const [tipo, setTipo] = useState(atual?.tipo ?? 'ingrediente');
  const [unidade, setUnidade] = useState(atual?.unidade ?? 'g');
  const [unEmb, setUnEmb] = useState(atual?.unidade ?? 'g');
  const [emb, setEmb] = useState(atual?.embalagem_qtd ? String(Number(atual.embalagem_qtd)) : '');
  const [minimo, setMinimo] = useState(atual ? String(Number(atual.estoque_minimo)) : '0');
  const acao = useAcao();
  const fator = (u: string) => (u === 'kg' || u === 'l' ? 1000 : 1);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const linha = {
      nome: nome.trim(), marca: marca.trim() || null, tipo, unidade,
      embalagem_qtd: emb ? Number(emb.replace(',', '.')) * fator(unEmb) : null,
      estoque_minimo: Number(minimo.replace(',', '.')) || 0,
    };
    const ok = await acao.executar(() => consulta(atual
      ? supabase.from('ingredientes').update({ ...linha, unidade: undefined }).eq('id', atual.id)
      : supabase.from('ingredientes').insert(linha)));
    if (ok) aoFechar(true);
  }
  return (
    <Modal titulo={atual ? `Editar ${atual.nome}` : 'Novo ingrediente ou embalagem'} aoFechar={() => aoFechar()}>
      <form className="form" onSubmit={salvar}>
        <label className="campo">Nome<input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label className="campo">Marca (opcional)<input value={marca} onChange={(e) => setMarca(e.target.value)} /></label>
        <label className="campo">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="ingrediente">Ingrediente</option><option value="embalagem">Embalagem / tampa / adesivo</option></select></label>
        <label className="campo">Medido em<select value={unidade} disabled={Boolean(atual)} onChange={(e) => { setUnidade(e.target.value); setUnEmb(e.target.value); }}>
          <option value="g">gramas (g / kg)</option><option value="ml">mililitros (ml / litro)</option><option value="un">unidades</option></select></label>
        <label className="campo">Tamanho da embalagem<input inputMode="decimal" value={emb} placeholder="ex.: 395" onChange={(e) => setEmb(e.target.value)} /></label>
        <label className="campo">Unidade da embalagem<select value={unEmb} onChange={(e) => setUnEmb(e.target.value)}>
          {UNIDADES[unidade].map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="campo">Estoque mínimo ({unidade})<input inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} /></label>
        <div className="largo"><Mensagem erro={acao.erro} /></div>
        <button className="botao largo" disabled={acao.ocupado}>Salvar</button>
      </form>
    </Modal>
  );
}
