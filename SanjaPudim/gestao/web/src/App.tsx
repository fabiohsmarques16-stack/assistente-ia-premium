import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configurado, rpc, supabase } from './supabase';
import { Icone } from './componentes';
import Login from './paginas/Login';
import Inicio from './paginas/Inicio';
import Pedidos from './paginas/Pedidos';
import Estoque from './paginas/Estoque';
import Receitas from './paginas/Receitas';
import Compras from './paginas/Compras';
import Relatorios from './paginas/Relatorios';
import Configuracoes from './paginas/Configuracoes';

const PAGINAS = [
  { id: 'inicio', nome: 'Início', C: Inicio },
  { id: 'pedidos', nome: 'Pedidos', C: Pedidos },
  { id: 'estoque', nome: 'Estoque', C: Estoque },
  { id: 'receitas', nome: 'Receitas', C: Receitas },
  { id: 'compras', nome: 'Compras', C: Compras },
  { id: 'relatorios', nome: 'Relatórios', C: Relatorios },
  { id: 'config', nome: 'Config.', C: Configuracoes },
] as const;

export type Navegar = (pagina: string) => void;

function paginaDaUrl() {
  const id = location.hash.replace('#', '');
  return PAGINAS.some((p) => p.id === id) ? id : 'inicio';
}

export default function App() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [pagina, setPagina] = useState(paginaDaUrl);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    const aoMudarHash = () => setPagina(paginaDaUrl());
    window.addEventListener('hashchange', aoMudarHash);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', aoMudarHash); };
  }, []);

  useEffect(() => {
    if (!sessao) { setAutorizado(null); return; }
    rpc<boolean>('sanja_autorizado').then(setAutorizado).catch(() => setAutorizado(false));
  }, [sessao]);

  if (!configurado) {
    return <div className="login"><div className="cartao pilha"><h2>Configuração pendente</h2>
      <p>Crie o arquivo <code>.env.local</code> com <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja <code>.env.example</code>).</p></div></div>;
  }
  if (sessao === undefined) return null;
  if (!sessao) return <Login />;
  if (autorizado === false) {
    return <div className="login"><div className="cartao pilha"><h2>Acesso não liberado</h2>
      <p>Este login ainda não está autorizado. No Supabase, rode:</p>
      <code style={{ wordBreak: 'break-all' }}>insert into usuarios (nome, auth_user_id) values ('Seu nome', '{sessao.user.id}');</code>
      <button className="botao sec" onClick={() => supabase.auth.signOut()}>Sair</button></div></div>;
  }
  if (autorizado === null) return null;

  const navegar: Navegar = (p) => { location.hash = p; };
  const Atual = PAGINAS.find((p) => p.id === pagina)!.C;

  return (
    <div className="app">
      <nav className="lateral" aria-label="Menu principal">
        <div className="marca"><img src="/icone.svg" alt="" /><div>SANJA Gestão<small>Sanja Pudim</small></div></div>
        {PAGINAS.map((p) => (
          <button key={p.id} className={`nav-item ${p.id === pagina ? 'ativo' : ''}`} onClick={() => navegar(p.id)}
                  aria-current={p.id === pagina ? 'page' : undefined}>
            <Icone nome={p.id} />{p.nome}
          </button>
        ))}
        <span className="espaco" />
        <button className="nav-item sair" onClick={() => supabase.auth.signOut()}><Icone nome="sair" />Sair</button>
      </nav>
      <main className="conteudo">
        <div className="topo-movel"><img src="/icone.svg" alt="" />SANJA Gestão</div>
        <Atual navegar={navegar} />
      </main>
    </div>
  );
}
