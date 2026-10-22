import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configurado = Boolean(url && chave);
export const supabase = createClient(url ?? 'http://localhost', chave ?? 'sem-chave');

// Chama uma função do banco e devolve o resultado ou lança o erro com a mensagem do servidor.
export async function rpc<T = any>(funcao: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcao, args);
  if (error) throw new Error(error.hint ? `${error.message} ${error.hint}` : error.message);
  return data as T;
}

export async function consulta<T = any>(promessa: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promessa;
  if (error) throw new Error(error.message);
  return data as T;
}
