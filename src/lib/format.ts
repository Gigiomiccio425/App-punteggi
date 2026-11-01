import { AppError, type GameMode, type Role } from '../core/types';

const nf = new Intl.NumberFormat('it-IT');
export const fmt = (n: number) => nf.format(n);
export const signed = (n: number) => (n > 0 ? `+${nf.format(n)}` : n < 0 ? `−${nf.format(-n)}` : '±0');

const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function errMsg(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof DOMException && e.name === 'AbortError') return 'Operazione annullata.';
  if (e instanceof Error) return e.message;
  return String(e);
}

export const ROLE_LABEL: Record<Role, string> = {
  player: 'Giocatore',
  game_master: 'Game master',
  staff: 'Staff',
};

export const MODE_LABEL: Record<GameMode, string> = {
  chips: 'Fiches',
  lives: 'Vite',
  points: 'Punti',
};

export const STATUS_LABEL = {
  lobby: 'In attesa',
  playing: 'In gioco',
  closed: 'Chiuso',
  cancelled: 'Annullato',
} as const;

export const LEDGER_LABEL: Record<string, string> = {
  signup: 'Benvenuto',
  daily_bonus: 'Bonus giornaliero',
  table_round: 'Mano al tavolo',
  table_settlement: 'Chiusura conto',
  admin_adjust: 'Rettifica staff',
  undo: 'Mano annullata',
};
