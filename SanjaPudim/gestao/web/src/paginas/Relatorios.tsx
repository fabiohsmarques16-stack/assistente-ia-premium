import { useState } from 'react';
import { rpc } from '../supabase';
import { Barras, Mensagem } from '../componentes';
import { baixarCSV, fmtData, fmtMoeda, fmtNum, fmtPrecoUnidade, fmtQtd, hojeISO, Linha, somarDias, useDados } from '../util';

function periodo(tipo: string): [string, string] {
  const hoje = hojeISO();
  if (tipo === 'Hoje') return [hoje, hoje];
  if (tipo === 'Semana') {
    const dia = new Date(`${hoje}T12:00:00`).getDay(); // 0 = domingo
    return [somarDias(hoje, -((dia + 6) % 7)), hoje];
  }
  if (tipo === 'Mês') return [`${hoje.slice(0, 8)}01`, hoje];
  return [somarDias(hoje, -29), hoje];
}

function Comparacao({ atual, anterior, moeda = true }: { atual: number; anterior: number; moeda?: boolean }) {
  const dif = atual - anterior;
  if (!anterior && !atual) return null;
  const pct = anterior ? ` (${dif >= 0 ? '+' : ''}${fmtNum((dif / anterior) * 100, 1)}%)` : '';
  return <div className={`detalhe ${dif >= 0 ? 'delta-pos' : 'delta-neg'}`}>
    {dif >= 0 ? '▲' : '▼'} {moeda ? fmtMoeda(Math.abs(dif)) : fmtNum(Math.abs(dif), 0)}{pct} vs. período anterior</div>;
}

export default function Relatorios() {
  const [tipo, setTipo] = useState('Mês');
  const [ini, setIni] = useState(periodo('Mês')[0]);
  const [fim, setFim] = useState(periodo('Mês')[1]);
  const escolher = (t: string) => { setTipo(t); if (t !== 'Personalizado') { const [a, b] = periodo(t); setIni(a); setFim(b); } };
  const { dados: r, erro } = useDados(() => rpc<Linha>('relatorio_periodo', { p_inicio: ini, p_fim: fim }), [ini, fim]);

  const exportar = () => r && baixarCSV(`relatorio-${ini}-a-${fim}.csv`, [
    { m: 'Período', v: `${fmtData(ini)} a ${fmtData(fim)}` },
    { m: 'Faturamento (R$)', v: Number(r.faturamento) }, { m: 'Recebido (R$)', v: Number(r.recebido) },
    { m: 'Pendente total (R$)', v: Number(r.pendente_total) }, { m: 'Pedidos entregues', v: r.pedidos_entregues },
    { m: 'Pudins vendidos', v: r.pudins_vendidos }, { m: 'Ticket médio (R$)', v: Number(r.ticket_medio) },
    { m: 'Custo dos vendidos (R$)', v: Number(r.custo_vendidos) }, { m: 'Lucro bruto estimado (R$)', v: Number(r.lucro_bruto) },
    { m: 'Despesas operacionais (R$)', v: r.despesas_operacionais }, { m: 'Lucro líquido (R$)', v: r.lucro_liquido ?? 'não calculado' },
    ...(r.por_sabor as Linha[]).map((s) => ({ m: `Sabor ${s.sabor}`, v: `${s.quantidade} un · receita ${s.receita} · custo ${s.custo} · margem ${s.margem}` })),
  ], [['m', 'Métrica'], ['v', 'Valor']]);

  return (
    <div className="pilha">
      <div className="cabecalho">
        <h1>Relatórios</h1>
        <div className="linha nao-imprimir">
          <button className="botao sec peq" disabled={!r} onClick={exportar}>Exportar CSV</button>
          <button className="botao sec peq" onClick={() => print()}>Imprimir / PDF</button>
        </div>
      </div>
      <div className="linha nao-imprimir">
        <div className="abas" style={{ margin: 0 }}>
          {['Hoje', 'Semana', 'Mês', '30 dias', 'Personalizado'].map((t) => (
            <button key={t} className={`aba ${t === tipo ? 'ativa' : ''}`} onClick={() => escolher(t)}>{t}</button>))}
        </div>
        {tipo === 'Personalizado' && <>
          <label className="campo">De<input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></label>
          <label className="campo">Até<input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        </>}
      </div>
      <div className="mudo">Período: {fmtData(ini)} a {fmtData(fim)}{r ? ` · comparado a ${fmtData(r.anterior.inicio)}–${fmtData(r.anterior.fim)}` : ''}</div>
      <Mensagem erro={erro} />
      {r && <>
        <div className="grade grade-kpi">
          <div className="cartao kpi"><div className="rotulo">Faturamento</div><div className="valor">{fmtMoeda(r.faturamento)}</div>
            <Comparacao atual={Number(r.faturamento)} anterior={Number(r.anterior.faturamento)} /></div>
          <div className="cartao kpi"><div className="rotulo">Recebido no período</div><div className="valor">{fmtMoeda(r.recebido)}</div>
            <div className="detalhe">pendente total {fmtMoeda(r.pendente_total)}</div></div>
          <div className="cartao kpi"><div className="rotulo">Pudins vendidos</div><div className="valor">{fmtNum(r.pudins_vendidos, 0)}</div>
            <Comparacao atual={Number(r.pudins_vendidos)} anterior={Number(r.anterior.pudins_vendidos)} moeda={false} /></div>
          <div className="cartao kpi"><div className="rotulo">Pedidos entregues</div><div className="valor">{r.pedidos_entregues}</div>
            <div className="detalhe">ticket médio {fmtMoeda(r.ticket_medio)}</div></div>
          <div className="cartao kpi"><div className="rotulo">Lucro bruto estimado</div><div className="valor">{fmtMoeda(r.lucro_bruto)}</div>
            <Comparacao atual={Number(r.lucro_bruto)} anterior={Number(r.anterior.lucro_bruto)} /></div>
          <div className="cartao kpi"><div className="rotulo">Lucro líquido</div>
            <div className="valor">{r.lucro_liquido == null ? '—' : fmtMoeda(r.lucro_liquido)}</div>
            <div className="detalhe">{r.lucro_liquido_nota}</div></div>
        </div>

        <div className="grade grade-2">
          <section className="cartao">
            <h2>Sabores mais vendidos</h2>
            <Barras dados={(r.por_sabor as Linha[]).map((s) => ({ rotulo: s.sabor, valor: Number(s.quantidade) }))} />
          </section>
          <section className="cartao">
            <h2>Margem de contribuição por sabor</h2>
            {(r.por_sabor as Linha[]).length === 0 ? <div className="vazio">Sem vendas no período.</div> :
              <div className="tabela-wrap"><table>
                <thead><tr><th>Sabor</th><th className="num">Qtd.</th><th className="num">Receita</th><th className="num">Custo</th><th className="num">Margem</th></tr></thead>
                <tbody>{(r.por_sabor as Linha[]).map((s) => (
                  <tr key={s.sabor_id}><td>{s.sabor}</td><td className="num">{s.quantidade}</td><td className="num">{fmtMoeda(s.receita)}</td>
                    <td className="num">{fmtMoeda(s.custo)}</td><td className="num">{fmtMoeda(s.margem)}{s.margem_pct != null ? ` (${fmtNum(s.margem_pct, 1)}%)` : ''}</td></tr>))}</tbody>
              </table></div>}
          </section>
          <section className="cartao">
            <h2>Ingredientes mais utilizados</h2>
            {(r.ingredientes_mais_usados as Linha[]).length === 0 ? <div className="vazio">Nenhuma produção no período.</div> :
              <ul className="lista">{(r.ingredientes_mais_usados as Linha[]).map((i) => (
                <li key={i.ingrediente}><span>{i.ingrediente}</span><span className="mudo">{fmtQtd(i.quantidade, i.unidade)} · {fmtMoeda(i.custo)}</span></li>))}</ul>}
            <p className="mudo">Produção no período: {r.pudins_produzidos} pudins, custo {fmtMoeda(r.custo_producao_periodo)}.</p>
          </section>
          <section className="cartao">
            <h2>Estoque abaixo do mínimo</h2>
            {(r.estoque_abaixo_minimo as Linha[]).length === 0 ? <div className="vazio">Nenhum item abaixo do mínimo.</div> :
              <ul className="lista">{(r.estoque_abaixo_minimo as Linha[]).map((i) => (
                <li key={i.ingrediente}><span>⚠ {i.ingrediente}</span><span className="mudo">{fmtQtd(i.disponivel, i.unidade)} · mín. {fmtQtd(i.minimo, i.unidade)}</span></li>))}</ul>}
          </section>
        </div>

        <section className="cartao">
          <h2>Preços de compra</h2>
          {(r.precos_compra as Linha[]).length === 0 ? <div className="vazio">Sem compras registradas.</div> :
            <div className="tabela-wrap"><table>
              <thead><tr><th>Item</th><th className="num">Menor</th><th className="num">Maior</th><th className="num">Média</th><th className="num">Média ponderada</th></tr></thead>
              <tbody>{(r.precos_compra as Linha[]).map((p) => (
                <tr key={p.ingrediente}><td>{p.ingrediente}</td><td className="num">{fmtPrecoUnidade(p.menor, p.unidade)}</td><td className="num">{fmtPrecoUnidade(p.maior, p.unidade)}</td>
                  <td className="num">{fmtPrecoUnidade(p.media_simples, p.unidade)}</td><td className="num">{fmtPrecoUnidade(p.media_ponderada, p.unidade)}</td></tr>))}</tbody>
            </table></div>}
        </section>
        <p className="mudo">Faturamento considera pedidos entregues no período. Lucro bruto = faturamento − custo de produção dos pudins vendidos (média das produções do sabor). Lucro líquido só aparece quando há despesas operacionais cadastradas em Configurações.</p>
      </>}
    </div>
  );
}
