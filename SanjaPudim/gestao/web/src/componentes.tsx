import { ReactNode, useState } from 'react';
import { fmtNum, STATUS } from './util';

export function Mensagem({ erro, ok }: { erro?: string | null; ok?: string | null }) {
  if (erro) return <div className="aviso erro" role="alert">{erro}</div>;
  if (ok) return <div className="aviso ok" role="status">{ok}</div>;
  return null;
}

export function Status({ s }: { s: string }) {
  return <span className={`etiqueta ${s}`}>{STATUS[s] ?? s}</span>;
}

export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="cartao modal pilha" role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="linha"><h2 style={{ margin: 0 }}>{titulo}</h2><span className="espaco" />
          <button className="botao sec peq" onClick={aoFechar} aria-label="Fechar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

// Executa uma ação assíncrona mostrando erro/sucesso; devolve [executar, estado]
export function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function executar(fn: () => Promise<unknown>, sucesso?: string) {
    setOcupado(true); setErro(null); setOk(null);
    try {
      await fn();
      if (sucesso) setOk(sucesso);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }
  return { executar, ocupado, erro, ok, limpar: () => { setErro(null); setOk(null); } };
}

// Barras horizontais: uma série, rótulo de valor direto, dica ao passar o mouse
export function Barras({ dados, formatar = (v) => fmtNum(v, 0) }: { dados: { rotulo: string; valor: number; dica?: string }[]; formatar?: (v: number) => string }) {
  if (!dados.length) return <div className="vazio">Sem vendas no período.</div>;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return (
    <div className="barras" role="list">
      {dados.map((d) => (
        <div className="barra-linha" role="listitem" key={d.rotulo} title={d.dica ?? `${d.rotulo}: ${formatar(d.valor)}`}>
          <span>{d.rotulo}</span>
          <div className="barra-trilho"><div className="barra" style={{ width: `${(d.valor / max) * 100}%` }} /></div>
          <span className="barra-valor">{formatar(d.valor)}</span>
        </div>
      ))}
    </div>
  );
}

const caminhos: Record<string, string> = {
  inicio: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  pedidos: 'M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zm2 5h6m-6 4h6m-6 4h4',
  estoque: 'M3 7l9-4 9 4v10l-9 4-9-4zm0 0 9 4 9-4m-9 4v10',
  receitas: 'M6 3h9l3 3v15H6zm3 6h6m-6 4h6m-6 4h4',
  compras: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 8H6.2M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  relatorios: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  sair: 'M15 4h4v16h-4M10 8l-4 4 4 4m-4-4h11',
};

export function Icone({ nome }: { nome: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={caminhos[nome]} />
    </svg>
  );
}
