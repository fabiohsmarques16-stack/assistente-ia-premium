import { FormEvent, useState } from 'react';
import { consulta, rpc, supabase } from '../supabase';
import { Mensagem, Modal, Status, useAcao } from '../componentes';
import { fmtData, fmtMoeda, hojeISO, Linha, useDados } from '../util';

const FILTROS: Record<string, string[] | null> = {
  'Em aberto': ['solicitado', 'confirmado', 'em_producao', 'pronto'],
  'Entregues': ['entregue'],
  'Cancelados': ['cancelado'],
  'Todos': null,
};

export default function Pedidos() {
  const [filtro, setFiltro] = useState('Em aberto');
  const [novo, setNovo] = useState(false);
  const [pagando, setPagando] = useState<Linha | null>(null);
  const acao = useAcao();

  const { dados, erro, recarregar } = useDados(async () => {
    let q = supabase.from('vw_pedidos').select('*').order('data_entrega', { ascending: filtro === 'Em aberto', nullsFirst: false }).order('id', { ascending: false }).limit(200);
    const st = FILTROS[filtro];
    if (st) q = q.in('status', st);
    const pedidos = await consulta<Linha[]>(q);
    const ids = pedidos.map((p) => p.id);
    const [itens, aloc] = ids.length
      ? await Promise.all([
          consulta<Linha[]>(supabase.from('pedido_itens').select('*, sabores(nome)').in('pedido_id', ids)),
          consulta<Linha[]>(supabase.from('alocacoes').select('pedido_id, sabor_id, sem_logo, quantidade').in('pedido_id', ids)),
        ])
      : [[], []];
    return pedidos.map((p): Linha => ({
      ...p,
      itens: itens.filter((i) => i.pedido_id === p.id).map((i) => ({
        ...i,
        produzido: aloc.filter((a) => a.pedido_id === p.id && a.sabor_id === i.sabor_id && a.sem_logo === i.sem_logo)
                       .reduce((s, a) => s + a.quantidade, 0),
      })),
    }));
  }, [filtro]);

  const executar = async (fn: () => Promise<unknown>, msg: string) => { if (await acao.executar(fn, msg)) recarregar(); };

  return (
    <div className="pilha">
      <div className="cabecalho">
        <h1>Pedidos</h1>
        <button className="botao" onClick={() => setNovo(true)}>+ Novo pedido</button>
      </div>
      <div className="abas" role="tablist">
        {Object.keys(FILTROS).map((f) => (
          <button key={f} role="tab" aria-selected={f === filtro} className={`aba ${f === filtro ? 'ativa' : ''}`} onClick={() => setFiltro(f)}>{f}</button>
        ))}
      </div>
      <Mensagem erro={erro ?? acao.erro} ok={acao.ok} />
      {dados && dados.length === 0 && <div className="cartao"><div className="vazio">Nenhum pedido aqui.</div></div>}
      <div className="grade grade-2">
        {dados?.map((p) => (
          <article key={p.id} className="cartao pedido">
            <div className="pedido-topo">
              <div>
                <strong>#{p.id} · {p.cliente_nome}</strong>
                <div className="mudo">{p.tipo === 'revenda' ? 'Revenda' : 'Varejo'} · pedido {fmtData(p.data_pedido)} · entrega {fmtData(p.data_entrega)}</div>
              </div>
              <Status s={p.status} />
            </div>
            <div className="pedido-itens">
              {p.itens.map((i: Linha) => (
                <div key={i.id}>{i.quantidade} × {i.sabores?.nome}{i.sem_logo ? ' (sem logo)' : ''}
                  {['confirmado', 'em_producao', 'pronto'].includes(p.status) && <span className="mudo"> · produzido {i.produzido}/{i.quantidade}</span>}
                </div>
              ))}
            </div>
            {p.excecao_motivo && <div className="aviso alerta">Exceção autorizada: {p.excecao_motivo}</div>}
            {p.observacao && <div className="mudo">Obs.: {p.observacao}</div>}
            <div className="linha">
              <span>Total <strong>{fmtMoeda(p.valor_total)}</strong></span>
              <span className="mudo">recebido {fmtMoeda(p.valor_recebido)}</span>
              {Number(p.saldo) > 0 && <span className="etiqueta confirmado">falta {fmtMoeda(p.saldo)}</span>}
            </div>
            <div className="linha">
              {p.status === 'solicitado' && <button className="botao peq" disabled={acao.ocupado}
                onClick={() => executar(() => rpc('atualizar_status_pedido', { p_pedido_id: p.id, p_status: 'confirmado' }), `Pedido #${p.id} confirmado: ingredientes reservados.`)}>Confirmar</button>}
              {['confirmado', 'em_producao'].includes(p.status) && p.itens.filter((i: Linha) => i.produzido < i.quantidade).map((i: Linha) => (
                <button key={i.id} className="botao peq" disabled={acao.ocupado}
                  onClick={() => confirm(`Registrar produção de ${i.quantidade - i.produzido} ${i.sabores?.nome}${i.sem_logo ? ' sem logo' : ''}? Os ingredientes serão baixados do estoque.`) &&
                    executar(() => rpc('registrar_producao', { p_sabor_id: i.sabor_id, p_quantidade: i.quantidade - i.produzido, p_pedido_id: p.id, p_sem_logo: i.sem_logo }),
                             'Produção registrada e estoque atualizado.')}>
                  Produzir {i.quantidade - i.produzido} {i.sabores?.nome}</button>
              ))}
              {['confirmado', 'em_producao', 'pronto'].includes(p.status) && <button className="botao peq" disabled={acao.ocupado || p.status !== 'pronto'}
                title={p.status !== 'pronto' ? 'Disponível quando tudo estiver produzido' : undefined}
                onClick={() => executar(() => rpc('registrar_entrega', { p_pedido_id: p.id }), `Pedido #${p.id} entregue.`)}>Entregar</button>}
              {p.status !== 'cancelado' && Number(p.saldo) > 0 && <button className="botao sec peq" onClick={() => { acao.limpar(); setPagando(p); }}>Pagamento</button>}
              {!['entregue', 'cancelado'].includes(p.status) && <button className="botao perigo peq" disabled={acao.ocupado}
                onClick={() => confirm(`Cancelar o pedido #${p.id}? Pudins já produzidos voltam para o estoque pronto.`) &&
                  executar(() => rpc('atualizar_status_pedido', { p_pedido_id: p.id, p_status: 'cancelado' }), `Pedido #${p.id} cancelado.`)}>Cancelar</button>}
            </div>
          </article>
        ))}
      </div>

      {novo && <NovoPedido aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); recarregar(); }} />}
      {pagando && <Pagamento pedido={pagando} aoFechar={() => setPagando(null)} aoSalvar={() => { setPagando(null); recarregar(); }} />}
    </div>
  );
}

function Pagamento({ pedido, aoFechar, aoSalvar }: { pedido: Linha; aoFechar: () => void; aoSalvar: () => void }) {
  const [valor, setValor] = useState(String(pedido.saldo));
  const [data, setData] = useState(hojeISO());
  const acao = useAcao();
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (await acao.executar(() => rpc('registrar_pagamento', { p_pedido_id: pedido.id, p_valor: Number(valor.replace(',', '.')), p_forma: 'pix', p_data: data }))) aoSalvar();
  }
  return (
    <Modal titulo={`Pagamento · pedido #${pedido.id}`} aoFechar={aoFechar}>
      <form className="form" onSubmit={salvar}>
        <label className="campo">Valor (Pix)<input inputMode="decimal" required value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className="campo">Data<input type="date" required value={data} onChange={(e) => setData(e.target.value)} /></label>
        <div className="largo mudo">Saldo pendente: {fmtMoeda(pedido.saldo)}</div>
        <div className="largo"><Mensagem erro={acao.erro} /></div>
        <button className="botao largo" disabled={acao.ocupado}>Registrar pagamento</button>
      </form>
    </Modal>
  );
}

function NovoPedido({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const { dados, erro } = useDados(async () => {
    const [clientes, sabores, cfg, comReceita] = await Promise.all([
      consulta<Linha[]>(supabase.from('clientes').select('*').order('nome')),
      consulta<Linha[]>(supabase.from('sabores').select('*').eq('ativo', true).order('id')),
      consulta<Linha>(supabase.from('configuracoes').select('*').single()),
      consulta<Linha[]>(supabase.from('receitas').select('sabor_id, receita_versoes!receita_versoes_receita_id_fkey!inner(vigente, receita_itens!inner(id))')
        .eq('receita_versoes.vigente', true).not('sabor_id', 'is', null)),
    ]);
    return { clientes, sabores, cfg, semReceita: sabores.filter((s) => !comReceita.some((r) => r.sabor_id === s.id)).map((s) => s.id) };
  });
  const [clienteId, setClienteId] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novoTipo, setNovoTipo] = useState('varejo');
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [semLogo, setSemLogo] = useState<Record<string, boolean>>({});
  const [entrega, setEntrega] = useState('');
  const [confirmar, setConfirmar] = useState(true);
  const [excecao, setExcecao] = useState('');
  const [obs, setObs] = useState('');
  const acao = useAcao();

  if (erro) return <Modal titulo="Novo pedido" aoFechar={aoFechar}><Mensagem erro={erro} /></Modal>;
  if (!dados) return null;
  const { clientes, sabores, cfg, semReceita } = dados;
  const passo = cfg.multiplo_producao as number;
  const cliente = clientes.find((c) => String(c.id) === clienteId);
  const tipo = clienteId === 'novo' ? novoTipo : cliente?.tipo ?? 'varejo';
  const preco = Number(tipo === 'revenda' ? cfg.preco_revenda : cfg.preco_varejo);
  const minimo = tipo === 'revenda' ? cfg.minimo_revenda : cfg.minimo_varejo;
  const total = Object.values(qtd).reduce((s, n) => s + n, 0);
  const caixas = Math.ceil(total / cfg.capacidade_caixa);
  const foraDaRegra = total > 0 && total < minimo;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const itens = sabores.filter((s) => (qtd[s.id] ?? 0) > 0)
      .map((s) => ({ sabor_id: s.id, quantidade: qtd[s.id], sem_logo: Boolean(semLogo[s.id]) }));
    const ok = await acao.executar(async () => {
      let id = Number(clienteId);
      if (clienteId === 'novo') id = await rpc<number>('criar_cliente', { p_nome: novoNome, p_tipo: novoTipo });
      await rpc('criar_pedido', {
        p_cliente_id: id, p_itens: itens, p_data_entrega: entrega || null,
        p_excecao_motivo: excecao || null, p_observacao: obs || null, p_status: confirmar ? 'confirmado' : 'solicitado',
      });
    });
    if (ok) aoSalvar();
  }

  return (
    <Modal titulo="Novo pedido" aoFechar={aoFechar}>
      <form className="pilha" onSubmit={salvar}>
        <div className="form">
          <label className="campo largo">Cliente
            <select required value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Selecione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>)}
              <option value="novo">+ Novo cliente</option>
            </select>
          </label>
          {clienteId === 'novo' && <>
            <label className="campo">Nome<input required value={novoNome} onChange={(e) => setNovoNome(e.target.value)} /></label>
            <label className="campo">Tipo<select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)}>
              <option value="varejo">Varejo (venda direta)</option><option value="revenda">Revenda</option></select></label>
          </>}
          <label className="campo">Entrega<input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} /></label>
        </div>

        <div>
          <div className="mudo">Quantidades em múltiplos de {passo} · {tipo === 'revenda' ? 'revenda' : 'varejo'} {fmtMoeda(preco)}/un · mínimo {minimo}</div>
          {sabores.map((s) => (
            <div className="sabor-qtd" key={s.id}>
              <span>{s.nome}{semReceita.includes(s.id) && <span className="mudo"> · sem receita</span>}</span>
              <label className="check"><input type="checkbox" checked={Boolean(semLogo[s.id])} onChange={(e) => setSemLogo({ ...semLogo, [s.id]: e.target.checked })} />sem logo</label>
              <span className="contador">
                <button type="button" aria-label={`Menos ${s.nome}`} onClick={() => setQtd({ ...qtd, [s.id]: Math.max(0, (qtd[s.id] ?? 0) - passo) })}>−</button>
                <span>{qtd[s.id] ?? 0}</span>
                <button type="button" aria-label={`Mais ${s.nome}`} onClick={() => setQtd({ ...qtd, [s.id]: (qtd[s.id] ?? 0) + passo })}>+</button>
              </span>
            </div>
          ))}
        </div>

        <div className="linha"><strong>{total} pudins · {caixas} caixa{caixas === 1 ? '' : 's'}</strong><span className="espaco" /><strong>{fmtMoeda(total * preco)}</strong></div>
        {foraDaRegra && <div className="aviso alerta">Abaixo do mínimo de {minimo} unidades. Para registrar assim, informe o motivo da exceção.</div>}
        <div className="form">
          <label className="campo largo">Motivo da exceção (só se fugir das regras)<input value={excecao} onChange={(e) => setExcecao(e.target.value)} /></label>
          <label className="campo largo">Observação<input value={obs} onChange={(e) => setObs(e.target.value)} /></label>
          <label className="check largo"><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />Já confirmar (reserva os ingredientes)</label>
        </div>
        <Mensagem erro={acao.erro} />
        <button className="botao" disabled={acao.ocupado || total === 0}>Salvar pedido</button>
      </form>
    </Modal>
  );
}
