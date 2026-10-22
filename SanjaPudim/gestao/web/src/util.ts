import { useCallback, useEffect, useState } from 'react';

export type Linha = Record<string, any>;

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoeda = (v: unknown) => (v === null || v === undefined ? '—' : moeda.format(Number(v)));
export const fmtNum = (v: unknown, casas = 2) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });

// Mostra quantidades em unidade amigável: 1500 g → 1,5 kg; 2000 ml → 2 L
export function fmtQtd(v: unknown, unidade: string) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (unidade === 'g' && Math.abs(n) >= 1000) return `${fmtNum(n / 1000, 3)} kg`;
  if (unidade === 'ml' && Math.abs(n) >= 1000) return `${fmtNum(n / 1000, 3)} L`;
  return `${fmtNum(n, 2)} ${unidade}`;
}

// Preço por unidade base → por kg / litro / unidade
export function fmtPrecoUnidade(v: unknown, unidade: string) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (unidade === 'g') return `${fmtMoeda(n * 1000)}/kg`;
  if (unidade === 'ml') return `${fmtMoeda(n * 1000)}/L`;
  return `${fmtMoeda(n)}/un`;
}

export const fmtData = (v: unknown) => {
  if (!v) return '—';
  const [a, m, d] = String(v).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

export const STATUS: Record<string, string> = {
  solicitado: 'Solicitado',
  confirmado: 'Confirmado',
  em_producao: 'Em produção',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

// Carrega dados assíncronos com estado de carregamento/erro e função para recarregar
export function useDados<T>(carregar: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await carregar());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, deps);
  useEffect(() => { recarregar(); }, [recarregar]);
  return { dados, erro, carregando, recarregar };
}

// Exporta linhas em CSV (separador ; para abrir certo no Excel em português)
export function baixarCSV(nome: string, linhas: Linha[], colunas: [string, string][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [colunas.map(([, t]) => t).join(';'), ...linhas.map((l) => colunas.map(([c]) => esc(l[c])).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}
