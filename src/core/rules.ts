import type {
  GameDef,
  GameMode,
  Outcome,
  Participant,
  PlayerStats,
  Profile,
  Role,
  Settings,
  TableRow,
} from './types';

// Regole pure: nessun accesso ai dati. Le stesse regole sono replicate nelle funzioni SQL.

export const DEFAULT_SETTINGS: Settings = {
  dailyBonusBase: 100,
  startingChips: 1000,
  wheel: [1, 1.5, 1, 2, 1, 3, 1.5, 5],
  streakBonusPct: 10,
  maxStreak: 7,
  joinTokenTtlSeconds: 120,
  allowManualCode: true,
  timezone: 'Europe/Rome',
};

export const CHIP_DENOMINATIONS = [5, 10, 25, 100, 500, 1000] as const;

export function canOpenTables(role: Role): boolean {
  return role === 'game_master' || role === 'staff';
}

/** Variazione di fiches per una puntata ed un esito. Gli arrotondamenti favoriscono il banco. */
export function chipDelta(bet: number, outcome: Outcome): number {
  // arrotondamento a 6 decimali per evitare errori in virgola mobile (es. 100 * 1.15)
  return Math.floor(Math.round(bet * outcome.mult * 1e6) / 1e6);
}

/** Saldo utilizzabile da un partecipante (in on_close include i risultati non ancora applicati). */
export function availableChips(p: Pick<Participant, 'pendingDelta'> & { profile: { chips: number } }): number {
  return p.profile.chips + p.pendingDelta;
}

export function validateBet(table: TableRow, bet: number): string | null {
  if (!Number.isInteger(bet) || bet <= 0) return 'La puntata deve essere un numero intero positivo.';
  if (table.minBet > 0 && bet < table.minBet) return `Puntata minima: ${table.minBet}.`;
  if (table.maxBet > 0 && bet > table.maxBet) return `Puntata massima: ${table.maxBet}.`;
  return null;
}

export function activePlayers(participants: Participant[]): Participant[] {
  return participants.filter((p) => p.isPlaying && !p.leftAt);
}

export function activeParticipants(participants: Participant[]): Participant[] {
  return participants.filter((p) => !p.leftAt);
}

/** Restituisce un messaggio d'errore se il tavolo non può essere avviato. */
export function validateStart(game: GameDef, table: TableRow, participants: Participant[]): string | null {
  const present = activeParticipants(participants);
  if (present.length < game.minParticipants) {
    return `Servono almeno ${game.minParticipants} partecipanti (game master incluso): ora siete in ${present.length}.`;
  }
  const players = activePlayers(participants);
  if (game.mode !== 'chips' && players.length < 2) return 'Servono almeno 2 giocatori in gara.';
  if (players.length < 1) return 'Nessun giocatore al tavolo.';
  if (table.useTeams) {
    const a = players.filter((p) => p.team === 'A').length;
    const b = players.filter((p) => p.team === 'B').length;
    if (a === 0 || b === 0 || a + b !== players.length) return 'Assegna ogni giocatore alla squadra A o B.';
  }
  return null;
}

export function canJoin(game: GameDef, table: TableRow, participants: Participant[]): string | null {
  if (table.status === 'closed' || table.status === 'cancelled') return 'Il tavolo è chiuso.';
  if (table.status === 'playing' && !game.allowLateJoin) return 'La partita è già iniziata.';
  if (activeParticipants(participants).length >= game.maxParticipants) return 'Il tavolo è al completo.';
  return null;
}

/**
 * Calcola il piazzamento finale. Restituisce una mappa userId -> posizione (1 = vincitore,
 * pari merito condividono la posizione). Il master che non gioca non viene classificato.
 */
export function computePlacements(mode: GameMode, participants: Participant[]): Map<string, number> {
  const players = participants.filter((p) => p.isPlaying);
  const key = (p: Participant): number[] => {
    if (mode === 'chips') return [p.netDelta];
    if (mode === 'points') return [p.score];
    // vite: prima chi è ancora vivo (per vite rimaste), poi gli eliminati per ultimi eliminati
    const alive = p.lives > 0 && !p.leftAt ? 1 : 0;
    return [alive, alive ? p.lives : (p.eliminationOrder ?? 0)];
  };
  const sorted = [...players].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
  const result = new Map<string, number>();
  sorted.forEach((p, i) => {
    if (i > 0 && key(sorted[i - 1]).join() === key(p).join()) {
      result.set(p.userId, result.get(sorted[i - 1].userId)!);
    } else {
      result.set(p.userId, i + 1);
    }
  });
  return result;
}

export function isWin(mode: GameMode, placement: number | null, netDelta: number): boolean {
  if (placement !== 1) return false;
  return mode !== 'chips' || netDelta > 0;
}

/** Data "di calendario" nel fuso configurato (YYYY-MM-DD). */
export function dayInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface BonusComputation {
  amount: number;
  multiplier: number;
  segment: number;
  streak: number;
}

export function computeDailyBonus(
  settings: Settings,
  lastBonusDate: string | null,
  currentStreak: number,
  today: string,
  random: number,
): BonusComputation | null {
  if (lastBonusDate === today) return null;
  const streak = lastBonusDate === previousDay(today) ? Math.min(currentStreak + 1, settings.maxStreak) : 1;
  const wheel = settings.wheel.length ? settings.wheel : [1];
  const segment = Math.min(wheel.length - 1, Math.floor(random * wheel.length));
  const multiplier = wheel[segment];
  const streakFactor = 1 + (settings.streakBonusPct / 100) * (streak - 1);
  const amount = Math.round(settings.dailyBonusBase * multiplier * streakFactor);
  return { amount, multiplier, segment, streak };
}

export function bonusAvailable(profile: Pick<Profile, 'lastBonusDate'>, settings: Settings, now = new Date()): boolean {
  return profile.lastBonusDate !== dayInTimezone(now, settings.timezone);
}

export interface Level {
  title: string;
  min: number;
  next: number | null;
}

const LEVELS: { title: string; min: number }[] = [
  { title: 'Matricola', min: 0 },
  { title: 'Habitué', min: 5 },
  { title: 'Giocatore di sala', min: 15 },
  { title: 'High Roller', min: 40 },
  { title: 'Asso del tavolo', min: 80 },
  { title: 'Leggenda del Casinò', min: 150 },
];

/** Livello basato su partite giocate + 2 punti per vittoria. */
export function levelFor(stats: Pick<PlayerStats, 'gamesPlayed' | 'wins'>): Level & { xp: number } {
  const xp = stats.gamesPlayed + stats.wins * 2;
  let idx = 0;
  LEVELS.forEach((l, i) => {
    if (xp >= l.min) idx = i;
  });
  return { ...LEVELS[idx], next: LEVELS[idx + 1]?.min ?? null, xp };
}

export interface Badge {
  id: string;
  icon: string;
  label: string;
  hint: string;
  earned: boolean;
}

export function badgesFor(stats: PlayerStats, profile: Pick<Profile, 'chips' | 'bonusStreak' | 'role'>): Badge[] {
  return [
    { id: 'first_win', icon: '🏆', label: 'Prima vittoria', hint: 'Vinci una partita', earned: stats.wins >= 1 },
    { id: 'regular', icon: '🎲', label: 'Habitué', hint: 'Gioca 10 partite', earned: stats.gamesPlayed >= 10 },
    { id: 'high_roller', icon: '💎', label: 'High Roller', hint: 'Raggiungi 5.000 fiches', earned: profile.chips >= 5000 },
    { id: 'big_win', icon: '💰', label: 'Colpo grosso', hint: 'Vinci 1.000 fiches in un tavolo', earned: stats.biggestWin >= 1000 },
    { id: 'survivor', icon: '❤️', label: 'Sopravvissuto', hint: 'Vinci un gioco a vite', earned: stats.winsByMode.lives >= 1 },
    { id: 'loyal', icon: '🔥', label: 'Fedelissimo', hint: '7 giorni di bonus di fila', earned: profile.bonusStreak >= 7 },
    {
      id: 'croupier',
      icon: '🎩',
      label: 'Croupier',
      hint: 'Diventa game master e conduci 5 tavoli',
      earned: profile.role !== 'player' && stats.tablesMastered >= 5,
    },
  ];
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomInts(n: number, max: number): number[] {
  const out: number[] = [];
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out.push(buf[i] % max);
  return out;
}

export function generateTableCode(): string {
  return randomInts(5, CODE_ALPHABET.length)
    .map((i) => CODE_ALPHABET[i])
    .join('');
}

export function generateToken(length = 20): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return randomInts(length, alphabet.length)
    .map((i) => alphabet[i])
    .join('');
}

export function generatePin(): string {
  return randomInts(6, 10).join('');
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_.]{3,20}$/.test(username);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

export const AVATARS = ['🎩', '🃏', '🎲', '🍀', '💎', '👑', '🦊', '🐯', '🦁', '🐺', '🦄', '🐙', '🚀', '⭐', '🔥', '🍒', '🎰', '🕶️', '🌙', '⚡'];
export const COLORS = ['#d4af37', '#e0115f', '#1fb6ff', '#2ecc71', '#9b59ff', '#ff7a18', '#f5f1e3', '#ff2bd6'];
