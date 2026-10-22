import { FormEvent, useState } from 'react';
import { supabase } from '../supabase';
import { Mensagem } from '../componentes';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true); setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    setOcupado(false);
  }

  return (
    <div className="login">
      <form className="cartao pilha" onSubmit={entrar}>
        <div style={{ textAlign: 'center' }}>
          <img src="/icone.svg" alt="" />
          <h1 style={{ marginBottom: 4 }}>SANJA Gestão</h1>
          <div className="mudo">Sanja Pudim</div>
        </div>
        <label className="campo">E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="campo">Senha<input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        <Mensagem erro={erro} />
        <button className="botao" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
