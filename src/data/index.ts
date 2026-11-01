import type { Backend } from './backend';
import { LocalBackend } from './local/LocalBackend';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase se configurato via .env, altrimenti modalità demo nel browser. */
export async function createBackend(): Promise<Backend> {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (SUPABASE_URL && SUPABASE_KEY && !forceDemo) {
    const { SupabaseBackend } = await import('./supabase/SupabaseBackend');
    return new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
  }
  return new LocalBackend();
}
