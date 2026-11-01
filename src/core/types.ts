// Modello di dominio condiviso da UI, backend demo e backend Supabase.

export type Role = 'player' | 'game_master' | 'staff';
export type GameMode = 'chips' | 'lives' | 'points';
export type Room = 'casino' | 'arcade';
export type TableStatus = 'lobby' | 'playing' | 'closed' | 'cancelled';
/** live = le fiches si aggiornano a ogni mano; on_close = si accumulano e si applicano alla chiusura. */
export type Settlement = 'live' | 'on_close';
export type JoinMethod = 'nfc_table' | 'nfc_pass' | 'qr' | 'code' | 'master';
export type JoinTokenKind = 'nfc' | 'static' | 'qr';
export type Team = 'A' | 'B';

export interface ProfileLite {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  color: string;
  role: Role;
  chips: number;
}

export interface Profile extends ProfileLite {
  bio: string;
  banned: boolean;
  createdAt: string;
  lastBonusDate: string | null;
  bonusStreak: number;
}

export interface Outcome {
  key: string;
  label: string;
  /** moltiplicatore della puntata: -1 persa, 0 pari, 1 vinta, 1.5 blackjack... */
  mult: number;
}

export interface GameDef {
  id: string;
  name: string;
  mode: GameMode;
  room: Room;
  icon: string;
  description: string;
  /** partecipanti minimi per avviare, game master incluso */
  minParticipants: number;
  maxParticipants: number;
  defaultLives: number;
  targetPoints: number;
  masterPlaysDefault: boolean;
  allowTeams: boolean;
  allowLateJoin: boolean;
  outcomes: Outcome[];
  allowCustomDelta: boolean;
  enabled: boolean;
  sort: number;
}

export interface TableRow {
  id: string;
  code: string;
  name: string;
  gameId: string;
  masterId: string;
  status: TableStatus;
  settlement: Settlement;
  masterPlays: boolean;
  startingLives: number;
  targetPoints: number;
  minBet: number;
  maxBet: number; // 0 = nessun limite
  useTeams: boolean;
  roundCount: number;
  createdAt: string;
  startedAt: string | null;
  closedAt: string | null;
}

export interface Participant {
  tableId: string;
  userId: string;
  isMaster: boolean;
  isPlaying: boolean;
  joinedVia: JoinMethod;
  lives: number;
  score: number;
  team: Team | null;
  /** fiches maturate ma non ancora applicate al saldo (modalità on_close) */
  pendingDelta: number;
  /** variazione complessiva di fiches a questo tavolo */
  netDelta: number;
  eliminatedAt: string | null;
  eliminationOrder: number | null;
  placement: number | null;
  joinedAt: string;
  leftAt: string | null;
  profile: ProfileLite;
}

export interface RoundEffect {
  userId: string;
  chips?: number;
  lives?: number;
  points?: number;
  bet?: number;
  outcome?: string;
  eliminated?: boolean;
  /** ordine di eliminazione precedente, se la mano ha "resuscitato" il giocatore */
  prevOrder?: number | null;
}

export interface Round {
  id: string;
  tableId: string;
  number: number;
  createdAt: string;
  createdBy: string;
  effects: RoundEffect[];
  undone: boolean;
}

export interface TableState {
  table: TableRow;
  game: GameDef;
  master: ProfileLite;
  participants: Participant[];
  rounds: Round[];
}

export interface TableSummary {
  table: TableRow;
  game: GameDef;
  master: ProfileLite;
  participantCount: number;
}

export interface Settings {
  dailyBonusBase: number;
  startingChips: number;
  /** moltiplicatori degli spicchi della ruota del bonus giornaliero */
  wheel: number[];
  streakBonusPct: number;
  maxStreak: number;
  joinTokenTtlSeconds: number;
  allowQrFallback: boolean;
  timezone: string;
}

export type LedgerKind =
  | 'signup'
  | 'daily_bonus'
  | 'table_round'
  | 'table_settlement'
  | 'admin_adjust'
  | 'undo';

export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  kind: LedgerKind;
  tableId: string | null;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export type GmRequestStatus = 'pending' | 'approved' | 'rejected';

export interface GmRequest {
  id: string;
  userId: string;
  motivation: string;
  status: GmRequestStatus;
  reviewNote: string;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  profile?: ProfileLite;
}

export interface GameStat {
  gameId: string;
  played: number;
  wins: number;
  net: number;
}

export interface RecentGame {
  tableId: string;
  tableName: string;
  gameId: string;
  mode: GameMode;
  closedAt: string;
  placement: number | null;
  netDelta: number;
  wasMaster: boolean;
  won: boolean;
}

export interface PlayerStats {
  userId: string;
  gamesPlayed: number;
  wins: number;
  chipsWon: number;
  chipsLost: number;
  biggestWin: number;
  tablesMastered: number;
  winsByMode: Record<GameMode, number>;
  byGame: GameStat[];
  recent: RecentGame[];
}

export interface LeaderRow {
  profile: ProfileLite;
  value: number;
}

export type LeaderKind = 'chips' | 'wins' | 'games';

export interface BonusResult {
  amount: number;
  multiplier: number;
  segment: number;
  streak: number;
  balance: number;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AdminOverview {
  users: number;
  activeTables: number;
  chipsInCirculation: number;
  pendingGmRequests: number;
  tablesToday: number;
  bannedUsers: number;
}

export interface CreateTableInput {
  gameId: string;
  name: string;
  settlement: Settlement;
  masterPlays: boolean;
  startingLives: number;
  targetPoints: number;
  minBet: number;
  maxBet: number;
  useTeams: boolean;
}

export interface ChipsEntry {
  userId: string;
  bet: number;
  outcomeKey?: string;
  customDelta?: number;
}

export interface LivesChange {
  userId: string;
  delta: number;
}

export interface PointsChange {
  userId?: string;
  team?: Team;
  points: number;
}

export interface JoinToken {
  token: string;
  kind: JoinTokenKind;
  expiresAt: string | null;
}

export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}
