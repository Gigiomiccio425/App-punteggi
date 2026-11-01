import type {
  AdminOverview,
  AuditEntry,
  BonusResult,
  ChipsEntry,
  CreateTableInput,
  GameDef,
  GmRequest,
  GmRequestStatus,
  JoinMethod,
  JoinToken,
  JoinTokenKind,
  LeaderKind,
  LeaderRow,
  LedgerEntry,
  LivesChange,
  PlayerStats,
  PointsChange,
  Profile,
  ProfileLite,
  Role,
  Settings,
  TableState,
  TableStatus,
  TableSummary,
  Team,
} from '../core/types';

export type Unsubscribe = () => void;

export interface SignUpInput {
  /** usata solo dalla demo: il server identifica gli utenti con lo username */
  email?: string;
  password: string;
  username: string;
  displayName: string;
}

export interface DemoAccount {
  username: string;
  displayName: string;
  role: Role;
  avatar: string;
}

/**
 * Contratto unico per l'accesso ai dati. Due implementazioni:
 * - LocalBackend: modalità demo, tutto nel browser (multi-scheda via BroadcastChannel);
 * - ApiBackend: produzione, API PHP + SQLite (server/api) su hosting condiviso (es. Aruba Linux Basic),
 *   con aggiornamento dei tavoli tramite polling.
 * Tutte le operazioni che muovono fiches sono atomiche lato server.
 */
export interface Backend {
  readonly mode: 'demo' | 'server';

  // --- autenticazione ---
  currentUser(): Promise<Profile | null>;
  signIn(identifier: string, password: string): Promise<Profile>;
  signUp(input: SignUpInput): Promise<Profile>;
  signOut(): Promise<void>;
  changePassword?(current: string, next: string): Promise<void>;
  onAuthChange(cb: () => void): Unsubscribe;
  demoAccounts?(): Promise<DemoAccount[]>;

  // --- profili, statistiche, classifica ---
  getProfile(userId: string): Promise<Profile>;
  findProfileByUsername(username: string): Promise<Profile | null>;
  updateMyProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatar' | 'color' | 'bio'>>): Promise<Profile>;
  getStats(userId: string): Promise<PlayerStats>;
  leaderboard(kind: LeaderKind): Promise<LeaderRow[]>;
  myLedger(limit?: number): Promise<LedgerEntry[]>;

  // --- bonus e impostazioni pubbliche ---
  getSettings(): Promise<Settings>;
  claimDailyBonus(): Promise<BonusResult>;

  // --- pass personale NFC ---
  getMyPassToken(): Promise<string>;
  rotateMyPassToken(): Promise<string>;

  // --- richieste game master ---
  requestGameMaster(motivation: string): Promise<GmRequest>;
  myGmRequest(): Promise<GmRequest | null>;

  // --- giochi e tavoli ---
  listGames(): Promise<GameDef[]>;
  listActiveTables(): Promise<TableSummary[]>;
  myActiveTableId(): Promise<string | null>;
  getTable(tableId: string): Promise<TableState>;
  subscribeLobby(cb: () => void): Unsubscribe;
  subscribeTable(tableId: string, cb: () => void): Unsubscribe;
  createTable(input: CreateTableInput): Promise<string>;
  issueJoinToken(tableId: string, kind: JoinTokenKind): Promise<JoinToken>;
  joinWithToken(code: string, token: string, via: JoinMethod): Promise<string>;
  addPlayerByPass(tableId: string, passToken: string): Promise<ProfileLite>;
  leaveTable(tableId: string): Promise<void>;
  kick(tableId: string, userId: string): Promise<void>;
  setTeam(tableId: string, userId: string, team: Team | null): Promise<void>;
  startTable(tableId: string): Promise<void>;
  recordChipsRound(tableId: string, entries: ChipsEntry[]): Promise<void>;
  recordLivesRound(tableId: string, changes: LivesChange[]): Promise<void>;
  recordPointsRound(tableId: string, changes: PointsChange[]): Promise<void>;
  undoLastRound(tableId: string): Promise<void>;
  closeTable(tableId: string): Promise<void>;
  cancelTable(tableId: string): Promise<void>;

  // --- amministrazione (solo staff) ---
  adminOverview(): Promise<AdminOverview>;
  adminListUsers(query?: string): Promise<Profile[]>;
  adminSetRole(userId: string, role: Role): Promise<void>;
  adminSetBanned(userId: string, banned: boolean): Promise<void>;
  adminAdjustChips(userId: string, delta: number, reason: string): Promise<void>;
  /** token del pass di un utente, per scrivergli un braccialetto NFC (es. giocatori con iPhone) */
  adminUserPassToken(userId: string): Promise<string>;
  adminListGmRequests(status?: GmRequestStatus): Promise<GmRequest[]>;
  adminReviewGmRequest(id: string, approve: boolean, note?: string): Promise<void>;
  adminListTables(statuses?: TableStatus[]): Promise<TableSummary[]>;
  adminUpsertGame(game: GameDef): Promise<void>;
  adminUpdateSettings(patch: Partial<Settings>): Promise<Settings>;
  adminLedger(opts?: { userId?: string; limit?: number }): Promise<LedgerEntry[]>;
  adminAudit(limit?: number): Promise<AuditEntry[]>;
}
