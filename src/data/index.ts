import type { Backend } from './backend';
import { ApiBackend } from './api/ApiBackend';
import { LocalBackend } from './local/LocalBackend';

/**
 * Produzione: API PHP + SQLite pubblicata insieme al sito (cartella /api).
 * Demo (dati solo nel browser): VITE_BACKEND=demo in fase di build/sviluppo, oppure ?demo nell'URL.
 */
export async function createBackend(): Promise<Backend> {
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) sessionStorage.setItem('party-casino-force-demo', '1');
  const forceDemo = sessionStorage.getItem('party-casino-force-demo') === '1';
  if (forceDemo || import.meta.env.VITE_BACKEND === 'demo') return new LocalBackend();
  return new ApiBackend();
}
