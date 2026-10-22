import type { Navegar } from '../App';
import { rpc } from '../supabase';
import { Barras, Mensagem, Status } from '../componentes';
import { fmtData, fmtMoeda, fmtNum, fmtQtd, hojeISO, Linha, somarDias, useDados } from '../util';

export default function Inicio({ navegar }: { navegar: Navegar }) {
  const { dados, erro } = useDados(async () => {
    const [painel, compras] = await Promise.all([
      rpc<Linha>('resumo_painel'),
      rpc<Linha>('lista_compras', { p_ate: somarDias(hojeISO(), 7) }),
    ]);
    return { painel, compras };
  });

  if (erro) return <Mensagem erro={erro} />;
  if (!dados) return <div className="mudo">Carregando…</div>;
  const { painel: p, compras } = dados;
  const mes = new Date(`${p.mes_inicio}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });
  const aComprar = (compras.itens as Linha[]).filter((i) => Number(i.comprar) > 0);

  return (
    <div className="pilha">
      <div className="cabecalho">
        <h1>Início</h1>
        <button className="botao" onClick={() => navegar('pedidos')}>+ Novo pedido</button>
      </div>

      <div className="grade grade-kpi">
        <div className="cartao kpi"><div className="rotulo">Faturamento de {mes}</div><div className="valor">{fmtMoeda(p.faturamento_mes)}</div><div className="detalhe">pedidos entregues</div></div>
        <div className="cartao kpi"><div className="rotulo">Pedidos em aberto</div><div className="valor">{p.pedidos_abertos}</div><div className="detalhe">a receber {fmtMoeda(p.a_receber)}</div></div>
        <div className="cartao kpi"><div className="rotulo">Pudins vendidos</div><div className="valor">{fmtNum(p.pudins_vendidos_mes, 0)}</div><div className="detalhe">em {mes}</div></div>
        <div className="cartao kpi"><div className="rotulo">Lucro bruto estimado</div><div className="valor">{fmtMoeda(p.lucro_bruto_mes)}</div><div className="detalhe">faturamento − custo de produção</div></div>
      </div>

      <div className="grade grade-2">
        <section className="cartao">
          <h2>Pudins vendidos por sabor — {mes}</h2>
          <Barras dados={(p.vendas_por_sabor as Linha[]).map((s) => ({
            rotulo: s.sabor, valor: Number(s.quantidade),
            dica: `${s.sabor}: ${s.quantidade} un · ${fmtMoeda(s.receita)} · margem ${fmtMoeda(s.margem)}`,
          }))} />
        </section>

        <section className="cartao">
          <h2>Alertas de estoque</h2>
          {(p.alertas_estoque as Linha[]).length === 0
            ? <div className="vazio">Nenhum ingrediente abaixo do mínimo.</div>
            : <ul className="lista">{(p.alertas_estoque as Linha[]).map((a) => (
                <li key={a.ingrediente}><span>⚠ {a.ingrediente}</span>
                  <span className="mudo">{fmtQtd(a.disponivel, a.unidade)} · mín. {fmtQtd(a.minimo, a.unidade)}</span></li>))}</ul>}
        </section>

        <section className="cartao">
          <div className="linha"><h2 style={{ margin: 0 }}>Próximas entregas</h2><span className="espaco" />
            <button className="botao sec peq" onClick={() => navegar('pedidos')}>Ver pedidos</button></div>
          {(p.proximas_entregas as Linha[]).length === 0
            ? <div className="vazio">Nenhum pedido em aberto.</div>
            : <ul className="lista">{(p.proximas_entregas as Linha[]).map((e) => (
                <li key={e.id}><span><strong>{e.cliente}</strong><br /><span className="mudo">{fmtData(e.data_entrega)} · {e.quantidade} un</span></span>
                  <Status s={e.status} /></li>))}</ul>}
        </section>

        <section className="cartao">
          <div className="linha"><h2 style={{ margin: 0 }}>Comprar para os próximos 7 dias</h2><span className="espaco" />
            <button className="botao sec peq" onClick={() => navegar('compras')}>Lista completa</button></div>
          {aComprar.length === 0
            ? <div className="vazio">Nada a comprar para os pedidos da semana.</div>
            : <ul className="lista">{aComprar.map((i) => (
                <li key={i.ingrediente_id}><span>{i.ingrediente}</span>
                  <span className="mudo">{i.embalagens ? `${i.embalagens} emb. · ` : ''}{fmtQtd(i.comprar, i.unidade)}</span></li>))}</ul>}
          {compras.custo_total_previsto != null && <p className="mudo">Custo previsto: {fmtMoeda(compras.custo_total_previsto)}</p>}
          {(compras.avisos as string[]).map((a) => <div key={a} className="aviso alerta" style={{ marginTop: 8 }}>{a}</div>)}
        </section>
      </div>
    </div>
  );
}
