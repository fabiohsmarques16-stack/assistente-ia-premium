import { FormEvent, useState } from 'react';
import { consulta, supabase } from '../supabase';
import { Mensagem, useAcao } from '../componentes';
import { fmtData, fmtMoeda, hojeISO, Linha, useDados } from '../util';

export default function Configuracoes() {
  const { dados, erro, recarregar } = useDados(async () => {
    const [cfg, sabores, clientes, despesas] = await Promise.all([
      consulta<Linha>(supabase.from('configuracoes').select('*').single()),
      consulta<Linha[]>(supabase.from('sabores').select('*').order('id')),
      consulta<Linha[]>(supabase.from('clientes').select('*').order('nome')),
      consulta<Linha[]>(supabase.from('despesas').select('*').order('data', { ascending: false }).limit(50)),
    ]);
    return { cfg, sabores, clientes, despesas };
  });

  return (
    <div className="pilha">
      <div className="cabecalho"><h1>Configurações</h1></div>
      <Mensagem erro={erro} />
      {dados && <>
        <Regras cfg={dados.cfg} aoSalvar={recarregar} />
        <div className="grade grade-2">
          <Sabores sabores={dados.sabores} aoSalvar={recarregar} />
          <Despesas despesas={dados.despesas} aoSalvar={recarregar} />
        </div>
        <Clientes clientes={dados.clientes} aoSalvar={recarregar} />
        <section className="cartao pilha">
          <h2>Conta</h2>
          <p className="mudo" style={{ margin: 0 }}>Os dados ficam no Supabase e sincronizam entre celular, computador e o bot do Telegram.</p>
          <div><button className="botao sec" onClick={() => supabase.auth.signOut()}>Sair</button></div>
        </section>
      </>}
    </div>
  );
}

function Regras({ cfg, aoSalvar }: { cfg: Linha; aoSalvar: () => void }) {
  const [v, setV] = useState<Linha>({ ...cfg });
  const acao = useAcao();
  const campo = (k: string, rotulo: string, decimal = false) => (
    <label className="campo">{rotulo}<input inputMode={decimal ? 'decimal' : 'numeric'} required value={String(v[k])}
      onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const n = (k: string) => Number(String(v[k]).replace(',', '.'));
    if (await acao.executar(() => consulta(supabase.from('configuracoes').update({
      preco_varejo: n('preco_varejo'), preco_revenda: n('preco_revenda'), minimo_varejo: n('minimo_varejo'),
      minimo_revenda: n('minimo_revenda'), multiplo_producao: n('multiplo_producao'), capacidade_caixa: n('capacidade_caixa'),
      atualizado_em: new Date().toISOString(),
    }).eq('id', 1)), 'Regras salvas. Valem para os próximos pedidos.')) aoSalvar();
  }
  return (
    <form className="cartao pilha" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>Regras comerciais</h2>
      <div className="form">
        {campo('preco_varejo', 'Preço varejo (R$/copo)', true)}
        {campo('minimo_varejo', 'Mínimo varejo (un)')}
        {campo('preco_revenda', 'Preço revenda (R$/copo)', true)}
        {campo('minimo_revenda', 'Mínimo revenda (un)')}
        {campo('multiplo_producao', 'Múltiplo por sabor (un)')}
        {campo('capacidade_caixa', 'Pudins por caixa')}
      </div>
      <p className="mudo" style={{ margin: 0 }}>Pedidos já registrados mantêm o preço da época. Exceções às regras podem ser autorizadas no pedido, informando o motivo.</p>
      <Mensagem erro={acao.erro} ok={acao.ok} />
      <div><button className="botao" disabled={acao.ocupado}>Salvar regras</button></div>
    </form>
  );
}

function Sabores({ sabores, aoSalvar }: { sabores: Linha[]; aoSalvar: () => void }) {
  const [nome, setNome] = useState('');
  const acao = useAcao();
  async function adicionar(e: FormEvent) {
    e.preventDefault();
    if (await acao.executar(() => consulta(supabase.from('sabores').insert({ nome: nome.trim() })), `Sabor ${nome} adicionado. Cadastre a receita em Receitas.`)) { setNome(''); aoSalvar(); }
  }
  const alternar = (s: Linha) => acao.executar(() => consulta(supabase.from('sabores').update({ ativo: !s.ativo }).eq('id', s.id))).then((ok) => ok && aoSalvar());
  return (
    <section className="cartao pilha">
      <h2 style={{ margin: 0 }}>Sabores</h2>
      <ul className="lista">{sabores.map((s) => (
        <li key={s.id}><span style={{ opacity: s.ativo ? 1 : .5 }}>{s.nome}{s.ativo ? '' : ' (inativo)'}</span>
          <button className="botao sec peq" onClick={() => alternar(s)}>{s.ativo ? 'Desativar' : 'Ativar'}</button></li>))}</ul>
      <form className="linha" onSubmit={adicionar}>
        <label className="campo espaco">Novo sabor<input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <button className="botao" disabled={acao.ocupado}>Adicionar</button>
      </form>
      <Mensagem erro={acao.erro} ok={acao.ok} />
    </section>
  );
}

function Despesas({ despesas, aoSalvar }: { despesas: Linha[]; aoSalvar: () => void }) {
  const [desc, setDesc] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO());
  const acao = useAcao();
  async function adicionar(e: FormEvent) {
    e.preventDefault();
    if (await acao.executar(() => consulta(supabase.from('despesas').insert({ descricao: desc.trim(), valor: Number(valor.replace(',', '.')), data })))) {
      setDesc(''); setValor(''); aoSalvar();
    }
  }
  return (
    <section className="cartao pilha">
      <h2 style={{ margin: 0 }}>Despesas operacionais</h2>
      <p className="mudo" style={{ margin: 0 }}>Gás, energia, transporte, taxas… Necessárias para calcular o lucro líquido.</p>
      <form className="form" onSubmit={adicionar}>
        <label className="campo">Descrição<input required value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="campo">Valor (R$)<input inputMode="decimal" required value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className="campo">Data<input type="date" required value={data} onChange={(e) => setData(e.target.value)} /></label>
        <button className="botao" disabled={acao.ocupado}>Adicionar</button>
      </form>
      <Mensagem erro={acao.erro} />
      {despesas.length === 0 ? <div className="vazio">Nenhuma despesa cadastrada.</div> :
        <ul className="lista">{despesas.map((d) => (
          <li key={d.id}><span>{d.descricao}<br /><span className="mudo">{fmtData(d.data)}</span></span>
            <span className="linha">{fmtMoeda(d.valor)}
              <button className="botao perigo peq" onClick={() => confirm(`Excluir a despesa "${d.descricao}"?`) &&
                acao.executar(() => consulta(supabase.from('despesas').delete().eq('id', d.id))).then((ok) => ok && aoSalvar())}>Excluir</button></span></li>))}</ul>}
    </section>
  );
}

function Clientes({ clientes, aoSalvar }: { clientes: Linha[]; aoSalvar: () => void }) {
  const acao = useAcao();
  const mudarTipo = (c: Linha, tipo: string) => acao.executar(() => consulta(supabase.from('clientes').update({ tipo }).eq('id', c.id))).then((ok) => ok && aoSalvar());
  return (
    <section className="cartao pilha">
      <h2 style={{ margin: 0 }}>Clientes</h2>
      <Mensagem erro={acao.erro} />
      {clientes.length === 0 ? <div className="vazio">Os clientes são cadastrados ao criar um pedido.</div> :
        <div className="tabela-wrap"><table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>Tipo</th></tr></thead>
          <tbody>{clientes.map((c) => (
            <tr key={c.id}><td>{c.nome}</td><td>{c.telefone ?? '—'}</td>
              <td><select value={c.tipo} onChange={(e) => mudarTipo(c, e.target.value)} aria-label={`Tipo de ${c.nome}`}>
                <option value="varejo">Varejo</option><option value="revenda">Revenda</option></select></td></tr>))}</tbody>
        </table></div>}
    </section>
  );
}
