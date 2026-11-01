import { DEFAULT_GAMES } from '../../core/games';
import {
  DEFAULT_SETTINGS,
  canJoin,
  canOpenTables,
  chipDelta,
  computeDailyBonus,
  computePlacements,
  dayInTimezone,
  generatePin,
  generateTableCode,
  generateToken,
  isValidUsername,
  isWin,
  normalizeUsername,
  validateBet,
  validateStart,
} from '../../core/rules';
import {
  AppError,
  type AdminOverview,
  type AuditEntry,
  type BonusResult,
  type ChipsEntry,
  type CreateTableInput,
  type GameDef,
  type GameMode,
  type GmRequest,
  type GmRequestStatus,
  type JoinMethod,
  type JoinToken,
  type JoinTokenKind,
  type LeaderKind,
  type LeaderRow,
  type LedgerEntry,
  type LedgerKind,
  type LivesChange,
  type Participant,
  type PlayerStats,
  type PointsChange,
  type Profile,
  type ProfileLite,
  type Role,
  type Round,
  type RoundEffect,
  type Settings,
  type TableRow,
  type TableState,
  type TableStatus,
  type TableSummary,
  type Team,
} from '../../core/types';
import type { Backend, DemoAccount, SignUpInput, Unsubscribe } from '../backend';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

type StoredParticipant = Omit<Participant, 'profile'>;
type StoredGmRequest = Omit<GmRequest, 'profile'>;
type StoredAudit = Omit<AuditEntry, 'actorName'>;

interface DemoDb {
  version: 1;
  profiles: Profile[];
  credentials: { userId: string; email: string; password: string }[];
  passes: { userId: string; token: string }[];
  settings: Settings;
  games: GameDef[];
  tables: TableRow[];
  participants: StoredParticipant[];
  rounds: Round[];
  ledger: LedgerEntry[];
  gmRequests: StoredGmRequest[];
  audit: StoredAudit[];
  joinTokens: { tableId: string; token: string; kind: JoinTokenKind; expiresAt: string | null }[];
}

export interface LocalBackendOptions {
  storage?: KeyValueStore;
  session?: KeyValueStore;
  /** null disattiva la sincronizzazione tra schede */
  channel?: BroadcastChannel | null;
  now?: () => Date;
  random?: () => number;
  seed?: boolean;
}

const DB_KEY = 'party-casino-demo-db-v1';
const SESSION_KEY = 'party-casino-demo-session';
export const DEMO_PASSWORD = 'demo';

const ACTIVE: TableStatus[] = ['lobby', 'playing'];

function toLite(p: Profile): ProfileLite {
  return {
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    avatar: p.avatar,
    color: p.color,
    role: p.role,
    chips: p.chips,
  };
}

function fail(code: string, message: string): never {
  throw new AppError(code, message);
}

export class LocalBackend implements Backend {
  readonly mode = 'demo' as const;
  private storage: KeyValueStore;
  private session: KeyValueStore;
  private channel: BroadcastChannel | null;
  private now: () => Date;
  private random: () => number;
  private listeners = new Set<() => void>();
  private authListeners = new Set<() => void>();

  constructor(opts: LocalBackendOptions = {}) {
    this.storage = opts.storage ?? globalThis.localStorage;
    this.session = opts.session ?? globalThis.sessionStorage;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
    if (opts.channel !== undefined) this.channel = opts.channel;
    else this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('party-casino-demo') : null;
    this.channel?.addEventListener('message', () => this.listeners.forEach((l) => l()));
    if (!this.storage.getItem(DB_KEY)) {
      this.save(opts.seed === false ? this.emptyDb() : this.seedDb());
    }
  }

  // ------------------------------------------------------------------ infrastruttura

  private emptyDb(): DemoDb {
    return {
      version: 1,
      profiles: [],
      credentials: [],
      passes: [],
      settings: { ...DEFAULT_SETTINGS },
      games: DEFAULT_GAMES.map((g) => ({ ...g, outcomes: g.outcomes.map((o) => ({ ...o })) })),
      tables: [],
      participants: [],
      rounds: [],
      ledger: [],
      gmRequests: [],
      audit: [],
      joinTokens: [],
    };
  }

  private load(): DemoDb {
    const raw = this.storage.getItem(DB_KEY);
    if (!raw) return this.emptyDb();
    return JSON.parse(raw) as DemoDb;
  }

  private save(db: DemoDb) {
    this.storage.setItem(DB_KEY, JSON.stringify(db));
  }

  /** Esegue una mutazione in modo atomico: se fn lancia un errore nulla viene salvato. */
  private mutate<T>(fn: (db: DemoDb) => T): T {
    const db = this.load();
    const result = fn(db);
    this.save(db);
    this.listeners.forEach((l) => l());
    this.channel?.postMessage({ type: 'changed' });
    return result;
  }

  private read<T>(fn: (db: DemoDb) => T): T {
    return fn(this.load());
  }

  private iso() {
    return this.now().toISOString();
  }

  private sessionUserId(): string | null {
    return this.session.getItem(SESSION_KEY);
  }

  private me(db: DemoDb): Profile {
    const id = this.sessionUserId();
    const p = id ? db.profiles.find((x) => x.id === id) : undefined;
    if (!p) fail('auth', 'Devi accedere per continuare.');
    return p;
  }

  private meActive(db: DemoDb): Profile {
    const p = this.me(db);
    if (p.banned) fail('banned', 'Il tuo account è sospeso. Contatta lo staff.');
    return p;
  }

  private staff(db: DemoDb): Profile {
    const p = this.meActive(db);
    if (p.role !== 'staff') fail('forbidden', 'Operazione riservata allo staff.');
    return p;
  }

  private profile(db: DemoDb, id: string): Profile {
    const p = db.profiles.find((x) => x.id === id);
    if (!p) fail('not_found', 'Utente non trovato.');
    return p;
  }

  private table(db: DemoDb, id: string): TableRow {
    const t = db.tables.find((x) => x.id === id);
    if (!t) fail('not_found', 'Tavolo non trovato.');
    return t;
  }

  private game(db: DemoDb, id: string): GameDef {
    const g = db.games.find((x) => x.id === id);
    if (!g) fail('not_found', 'Gioco non trovato.');
    return g;
  }

  private participantsOf(db: DemoDb, tableId: string): Participant[] {
    return db.participants
      .filter((p) => p.tableId === tableId)
      .map((p) => ({ ...p, profile: toLite(this.profile(db, p.userId)) }));
  }

  private storedParticipant(db: DemoDb, tableId: string, userId: string): StoredParticipant | undefined {
    return db.participants.find((p) => p.tableId === tableId && p.userId === userId);
  }

  private requireMaster(db: DemoDb, tableId: string): { actor: Profile; table: TableRow; game: GameDef } {
    const actor = this.meActive(db);
    const table = this.table(db, tableId);
    if (table.masterId !== actor.id && actor.role !== 'staff') {
      fail('forbidden', 'Solo il game master del tavolo può farlo.');
    }
    return { actor, table, game: this.game(db, table.gameId) };
  }

  private ledger(db: DemoDb, userId: string, delta: number, kind: LedgerKind, note: string, tableId: string | null, by: string | null) {
    const p = this.profile(db, userId);
    p.chips += delta;
    if (p.chips < 0) fail('chips', `${p.displayName} non ha abbastanza fiches.`);
    db.ledger.push({
      id: crypto.randomUUID(),
      userId,
      delta,
      balanceAfter: p.chips,
      kind,
      tableId,
      note,
      createdBy: by,
      createdAt: this.iso(),
    });
  }

  private audit(db: DemoDb, actorId: string | null, action: string, target: string, details: Record<string, unknown> = {}) {
    db.audit.push({ id: crypto.randomUUID(), actorId, action, target, details, createdAt: this.iso() });
  }

  private activeTableOf(db: DemoDb, userId: string): TableRow | undefined {
    const rows = db.participants.filter((p) => p.userId === userId && !p.leftAt);
    for (const r of rows) {
      const t = db.tables.find((x) => x.id === r.tableId);
      if (t && ACTIVE.includes(t.status)) return t;
    }
    return undefined;
  }

  // ------------------------------------------------------------------ seed demo

  private seedDb(): DemoDb {
    const db = this.emptyDb();
    const mk = (username: string, displayName: string, role: Role, avatar: string, color: string, bio: string) =>
      this.createUser(db, `${username}@demo.party`, DEMO_PASSWORD, username, displayName, { role, avatar, color, bio });
    const staff = mk('admin', 'Staff Casinò', 'staff', '🎩', '#d4af37', 'Lo staff che veglia sulla sala.');
    const gm = mk('mazziere', 'Il Mazziere', 'game_master', '🃏', '#e0115f', 'Croupier autorizzato. Il banco vince (quasi) sempre.');
    const luca = mk('luca', 'Luca', 'player', '🦊', '#ff7a18', 'Sempre all-in.');
    const giulia = mk('giulia', 'Giulia', 'player', '💎', '#1fb6ff', 'Regina del 31.');
    const marco = mk('marco', 'Marco', 'player', '🐯', '#2ecc71', '');
    const sofia = mk('sofia', 'Sofia', 'player', '🦄', '#9b59ff', 'Voglio diventare croupier!');
    mk('ale', 'Ale', 'player', '🚀', '#ff2bd6', '');

    db.gmRequests.push({
      id: crypto.randomUUID(),
      userId: sofia.id,
      motivation: 'Ho fatto la mazziera a tutte le feste di Natale, sono affidabile!',
      status: 'pending',
      reviewNote: '',
      reviewedBy: null,
      createdAt: this.iso(),
      reviewedAt: null,
    });

    // Storico: qualche tavolo già concluso, per avere statistiche e classifiche popolate.
    const play = (input: CreateTableInput, players: Profile[], rounds: (t: TableRow) => void) => {
      const tableId = this.opCreateTable(db, gm, input);
      const table = this.table(db, tableId);
      for (const p of players) this.opAddParticipant(db, table, p, 'nfc_pass');
      this.opStart(db, table, this.game(db, table.gameId));
      rounds(table);
      this.opClose(db, table, this.game(db, table.gameId), gm.id);
    };
    const bj: CreateTableInput = {
      gameId: 'blackjack', name: 'Blackjack di benvenuto', settlement: 'live', masterPlays: false,
      startingLives: 0, targetPoints: 0, minBet: 5, maxBet: 500, useTeams: false,
    };
    play(bj, [luca, giulia, marco], (t) => {
      const game = this.game(db, t.gameId);
      this.opChipsRound(db, gm, t, game, [
        { userId: luca.id, bet: 100, outcomeKey: 'blackjack' },
        { userId: giulia.id, bet: 50, outcomeKey: 'lose' },
        { userId: marco.id, bet: 25, outcomeKey: 'win' },
      ]);
      this.opChipsRound(db, gm, t, game, [
        { userId: luca.id, bet: 100, outcomeKey: 'double_win' },
        { userId: giulia.id, bet: 50, outcomeKey: 'win' },
        { userId: marco.id, bet: 25, outcomeKey: 'lose' },
      ]);
    });
    play(
      { gameId: 'trentuno', name: 'Trentuno della mezzanotte', settlement: 'live', masterPlays: true,
        startingLives: 3, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false },
      [luca, giulia, marco],
      (t) => {
        const game = this.game(db, t.gameId);
        this.opLivesRound(db, t, game, [{ userId: luca.id, delta: -1 }]);
        this.opLivesRound(db, t, game, [{ userId: marco.id, delta: -1 }, { userId: luca.id, delta: -1 }]);
        this.opLivesRound(db, t, game, [{ userId: luca.id, delta: -1 }, { userId: gm.id, delta: -2 }]);
        this.opLivesRound(db, t, game, [{ userId: marco.id, delta: -2 }, { userId: gm.id, delta: -1 }]);
      },
    );
    play(
      { gameId: 'scopa', name: 'Scopa d’assi', settlement: 'live', masterPlays: true,
        startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: false },
      [marco],
      (t) => {
        const game = this.game(db, t.gameId);
        this.opPointsRound(db, t, game, [{ userId: marco.id, points: 6 }, { userId: gm.id, points: 4 }]);
        this.opPointsRound(db, t, game, [{ userId: marco.id, points: 5 }, { userId: gm.id, points: 3 }]);
      },
    );
    // un bonus già ritirato ieri da Giulia per mostrare la serie
    const yesterday = new Date(this.now().getTime() - 86_400_000);
    giulia.lastBonusDate = dayInTimezone(yesterday, db.settings.timezone);
    giulia.bonusStreak = 3;
    this.audit(db, staff.id, 'seed', 'demo', { note: 'Dati dimostrativi creati' });
    return db;
  }

  // ------------------------------------------------------------------ autenticazione

  private createUser(
    db: DemoDb,
    email: string,
    password: string,
    username: string,
    displayName: string,
    extra: Partial<Pick<Profile, 'role' | 'avatar' | 'color' | 'bio'>> = {},
  ): Profile {
    const id = crypto.randomUUID();
    const profile: Profile = {
      id,
      username,
      displayName,
      avatar: extra.avatar ?? '🎲',
      color: extra.color ?? '#d4af37',
      bio: extra.bio ?? '',
      role: extra.role ?? 'player',
      chips: 0,
      banned: false,
      createdAt: this.iso(),
      lastBonusDate: null,
      bonusStreak: 0,
    };
    db.profiles.push(profile);
    db.credentials.push({ userId: id, email: email.toLowerCase(), password });
    db.passes.push({ userId: id, token: generateToken(20) });
    this.ledger(db, id, db.settings.startingChips, 'signup', 'Fiches di benvenuto', null, null);
    return profile;
  }

  async currentUser(): Promise<Profile | null> {
    const id = this.sessionUserId();
    if (!id) return null;
    return this.read((db) => db.profiles.find((p) => p.id === id) ?? null);
  }

  async signIn(identifier: string, password: string): Promise<Profile> {
    const id = identifier.trim().toLowerCase();
    const profile = this.read((db) => {
      const byName = db.profiles.find((p) => p.username === normalizeUsername(id));
      const cred = byName
        ? db.credentials.find((c) => c.userId === byName.id)
        : db.credentials.find((c) => c.email === id);
      if (!cred || cred.password !== password) fail('auth', 'Credenziali non valide.');
      return this.profile(db, cred.userId);
    });
    this.session.setItem(SESSION_KEY, profile.id);
    this.authListeners.forEach((l) => l());
    return profile;
  }

  async signUp(input: SignUpInput): Promise<Profile> {
    const username = normalizeUsername(input.username);
    if (!isValidUsername(username)) fail('username', 'Username: 3-20 caratteri tra lettere minuscole, numeri, _ e .');
    if (input.password.length < 6) fail('password', 'La password deve avere almeno 6 caratteri.');
    if (!/^\S+@\S+\.\S+$/.test(input.email)) fail('email', 'Email non valida.');
    const profile = this.mutate((db) => {
      if (db.profiles.some((p) => p.username === username)) fail('username', 'Username già in uso.');
      if (db.credentials.some((c) => c.email === input.email.toLowerCase())) fail('email', 'Email già registrata.');
      const p = this.createUser(db, input.email, input.password, username, input.displayName.trim() || username);
      this.audit(db, p.id, 'signup', username);
      return p;
    });
    this.session.setItem(SESSION_KEY, profile.id);
    this.authListeners.forEach((l) => l());
    return profile;
  }

  async signOut(): Promise<void> {
    this.session.removeItem(SESSION_KEY);
    this.authListeners.forEach((l) => l());
  }

  onAuthChange(cb: () => void): Unsubscribe {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  async demoAccounts(): Promise<DemoAccount[]> {
    return this.read((db) =>
      db.profiles
        .filter((p) => db.credentials.find((c) => c.userId === p.id)?.password === DEMO_PASSWORD)
        .map((p) => ({ username: p.username, displayName: p.displayName, role: p.role, avatar: p.avatar })),
    );
  }

  // ------------------------------------------------------------------ profili e statistiche

  async getProfile(userId: string): Promise<Profile> {
    return this.read((db) => ({ ...this.profile(db, userId) }));
  }

  async findProfileByUsername(username: string): Promise<Profile | null> {
    const u = normalizeUsername(username);
    return this.read((db) => db.profiles.find((p) => p.username === u) ?? null);
  }

  async updateMyProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatar' | 'color' | 'bio'>>): Promise<Profile> {
    return this.mutate((db) => {
      const me = this.me(db);
      if (patch.displayName !== undefined) {
        const name = patch.displayName.trim();
        if (name.length < 1 || name.length > 30) fail('name', 'Il nome deve avere tra 1 e 30 caratteri.');
        me.displayName = name;
      }
      if (patch.avatar !== undefined) me.avatar = patch.avatar.slice(0, 8);
      if (patch.color !== undefined) me.color = patch.color;
      if (patch.bio !== undefined) me.bio = patch.bio.slice(0, 160);
      return { ...me };
    });
  }

  private computeStats(db: DemoDb, userId: string): PlayerStats {
    const closed = new Map(db.tables.filter((t) => t.status === 'closed').map((t) => [t.id, t]));
    const modeOf = (gameId: string): GameMode => db.games.find((g) => g.id === gameId)?.mode ?? 'points';
    const stats: PlayerStats = {
      userId,
      gamesPlayed: 0,
      wins: 0,
      chipsWon: 0,
      chipsLost: 0,
      biggestWin: 0,
      tablesMastered: 0,
      winsByMode: { chips: 0, lives: 0, points: 0 },
      byGame: [],
      recent: [],
    };
    const byGame = new Map<string, { played: number; wins: number; net: number }>();
    for (const p of db.participants) {
      if (p.userId !== userId) continue;
      const t = closed.get(p.tableId);
      if (!t) continue;
      const mode = modeOf(t.gameId);
      if (p.isMaster) stats.tablesMastered++;
      const won = p.isPlaying && isWin(mode, p.placement, p.netDelta);
      if (p.isPlaying) {
        stats.gamesPlayed++;
        if (won) {
          stats.wins++;
          stats.winsByMode[mode]++;
        }
        if (p.netDelta > 0) stats.chipsWon += p.netDelta;
        if (p.netDelta < 0) stats.chipsLost += -p.netDelta;
        stats.biggestWin = Math.max(stats.biggestWin, p.netDelta);
        const g = byGame.get(t.gameId) ?? { played: 0, wins: 0, net: 0 };
        g.played++;
        if (won) g.wins++;
        g.net += p.netDelta;
        byGame.set(t.gameId, g);
      }
      stats.recent.push({
        tableId: t.id,
        tableName: t.name,
        gameId: t.gameId,
        mode,
        closedAt: t.closedAt ?? t.createdAt,
        placement: p.placement,
        netDelta: p.netDelta,
        wasMaster: p.isMaster && !p.isPlaying,
        won,
      });
    }
    stats.byGame = [...byGame.entries()]
      .map(([gameId, v]) => ({ gameId, ...v }))
      .sort((a, b) => b.played - a.played);
    stats.recent.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    stats.recent = stats.recent.slice(0, 12);
    return stats;
  }

  async getStats(userId: string): Promise<PlayerStats> {
    return this.read((db) => this.computeStats(db, userId));
  }

  async leaderboard(kind: LeaderKind): Promise<LeaderRow[]> {
    return this.read((db) => {
      const rows = db.profiles
        .filter((p) => !p.banned)
        .map((p) => {
          let value = p.chips;
          if (kind !== 'chips') {
            const s = this.computeStats(db, p.id);
            value = kind === 'wins' ? s.wins : s.gamesPlayed;
          }
          return { profile: toLite(p), value };
        });
      return rows.sort((a, b) => b.value - a.value || a.profile.username.localeCompare(b.profile.username)).slice(0, 50);
    });
  }

  async myLedger(limit = 30): Promise<LedgerEntry[]> {
    return this.read((db) => {
      const me = this.me(db);
      return db.ledger.filter((l) => l.userId === me.id).reverse().slice(0, limit);
    });
  }

  // ------------------------------------------------------------------ bonus giornaliero

  async getSettings(): Promise<Settings> {
    return this.read((db) => ({ ...db.settings }));
  }

  async claimDailyBonus(): Promise<BonusResult> {
    return this.mutate((db) => {
      const me = this.meActive(db);
      const today = dayInTimezone(this.now(), db.settings.timezone);
      const bonus = computeDailyBonus(db.settings, me.lastBonusDate, me.bonusStreak, today, this.random());
      if (!bonus) fail('bonus', 'Hai già ritirato il bonus di oggi. Torna domani!');
      me.lastBonusDate = today;
      me.bonusStreak = bonus.streak;
      this.ledger(db, me.id, bonus.amount, 'daily_bonus', `Bonus giornaliero x${bonus.multiplier} (serie ${bonus.streak})`, null, null);
      return { ...bonus, balance: me.chips };
    });
  }

  // ------------------------------------------------------------------ pass NFC

  async getMyPassToken(): Promise<string> {
    return this.read((db) => {
      const me = this.me(db);
      return db.passes.find((p) => p.userId === me.id)!.token;
    });
  }

  async rotateMyPassToken(): Promise<string> {
    return this.mutate((db) => {
      const me = this.me(db);
      const pass = db.passes.find((p) => p.userId === me.id)!;
      pass.token = generateToken(20);
      this.audit(db, me.id, 'pass_rotate', me.username);
      return pass.token;
    });
  }

  // ------------------------------------------------------------------ richieste GM

  async requestGameMaster(motivation: string): Promise<GmRequest> {
    return this.mutate((db) => {
      const me = this.meActive(db);
      if (me.role !== 'player') fail('gm', 'Sei già autorizzato a condurre tavoli.');
      if (db.gmRequests.some((r) => r.userId === me.id && r.status === 'pending')) {
        fail('gm', 'Hai già una richiesta in attesa.');
      }
      const text = motivation.trim();
      if (text.length < 10) fail('gm', 'Scrivi almeno due righe di motivazione (10 caratteri).');
      const req: StoredGmRequest = {
        id: crypto.randomUUID(),
        userId: me.id,
        motivation: text.slice(0, 500),
        status: 'pending',
        reviewNote: '',
        reviewedBy: null,
        createdAt: this.iso(),
        reviewedAt: null,
      };
      db.gmRequests.push(req);
      this.audit(db, me.id, 'gm_request', me.username);
      return { ...req, profile: toLite(me) };
    });
  }

  async myGmRequest(): Promise<GmRequest | null> {
    return this.read((db) => {
      const me = this.me(db);
      const mine = db.gmRequests.filter((r) => r.userId === me.id);
      const last = mine[mine.length - 1];
      return last ? { ...last, profile: toLite(me) } : null;
    });
  }

  // ------------------------------------------------------------------ tavoli: lettura

  async listGames(): Promise<GameDef[]> {
    return this.read((db) => [...db.games].sort((a, b) => a.sort - b.sort));
  }

  private summary(db: DemoDb, t: TableRow): TableSummary {
    return {
      table: { ...t },
      game: this.game(db, t.gameId),
      master: toLite(this.profile(db, t.masterId)),
      participantCount: db.participants.filter((p) => p.tableId === t.id && !p.leftAt).length,
    };
  }

  async listActiveTables(): Promise<TableSummary[]> {
    return this.read((db) =>
      db.tables
        .filter((t) => ACTIVE.includes(t.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => this.summary(db, t)),
    );
  }

  async myActiveTableId(): Promise<string | null> {
    return this.read((db) => {
      const id = this.sessionUserId();
      if (!id) return null;
      return this.activeTableOf(db, id)?.id ?? null;
    });
  }

  async getTable(tableId: string): Promise<TableState> {
    return this.read((db) => {
      const table = this.table(db, tableId);
      return {
        table: { ...table },
        game: this.game(db, table.gameId),
        master: toLite(this.profile(db, table.masterId)),
        participants: this.participantsOf(db, tableId).sort(
          (a, b) => Number(b.isMaster) - Number(a.isMaster) || a.joinedAt.localeCompare(b.joinedAt),
        ),
        rounds: db.rounds.filter((r) => r.tableId === tableId).sort((a, b) => b.number - a.number).slice(0, 60),
      };
    });
  }

  subscribeLobby(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  subscribeTable(_tableId: string, cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ------------------------------------------------------------------ tavoli: operazioni

  private opCreateTable(db: DemoDb, actor: Profile, input: CreateTableInput): string {
    if (!canOpenTables(actor.role)) fail('forbidden', 'Solo i game master autorizzati dallo staff possono aprire un tavolo.');
    const busy = this.activeTableOf(db, actor.id);
    if (busy) fail('busy', `Sei già al tavolo "${busy.name}". Chiudilo o lascialo prima di aprirne un altro.`);
    const game = this.game(db, input.gameId);
    if (!game.enabled) fail('game', 'Questo gioco è disattivato dallo staff.');
    if (input.minBet < 0 || input.maxBet < 0) fail('bet', 'Limiti di puntata non validi.');
    if (input.maxBet > 0 && input.maxBet < input.minBet) fail('bet', 'La puntata massima deve superare la minima.');
    if (game.mode === 'lives' && (input.startingLives < 1 || input.startingLives > 20)) {
      fail('lives', 'Le vite iniziali devono essere tra 1 e 20.');
    }
    if (game.mode === 'points' && input.targetPoints < 1) fail('points', 'Imposta un punteggio obiettivo.');
    let code = generateTableCode();
    while (db.tables.some((t) => t.code === code && ACTIVE.includes(t.status))) code = generateTableCode();
    const table: TableRow = {
      id: crypto.randomUUID(),
      code,
      name: input.name.trim().slice(0, 40) || `${game.name} · ${actor.displayName}`.slice(0, 40),
      gameId: game.id,
      masterId: actor.id,
      status: 'lobby',
      settlement: game.mode === 'chips' ? input.settlement : 'live',
      masterPlays: game.mode === 'chips' ? false : input.masterPlays,
      startingLives: game.mode === 'lives' ? input.startingLives : 0,
      targetPoints: game.mode === 'points' ? input.targetPoints : 0,
      minBet: game.mode === 'chips' ? input.minBet : 0,
      maxBet: game.mode === 'chips' ? input.maxBet : 0,
      useTeams: game.allowTeams && input.useTeams,
      roundCount: 0,
      createdAt: this.iso(),
      startedAt: null,
      closedAt: null,
    };
    db.tables.push(table);
    db.participants.push(this.newParticipant(table, actor.id, 'master', true, table.masterPlays));
    this.audit(db, actor.id, 'table_open', table.code, { game: game.id, name: table.name });
    return table.id;
  }

  private newParticipant(t: TableRow, userId: string, via: JoinMethod, isMaster: boolean, isPlaying: boolean): StoredParticipant {
    return {
      tableId: t.id,
      userId,
      isMaster,
      isPlaying,
      joinedVia: via,
      lives: t.startingLives,
      score: 0,
      team: null,
      pendingDelta: 0,
      netDelta: 0,
      eliminatedAt: null,
      eliminationOrder: null,
      placement: null,
      joinedAt: this.iso(),
      leftAt: null,
    };
  }

  private opAddParticipant(db: DemoDb, table: TableRow, user: Profile, via: JoinMethod) {
    if (user.banned) fail('banned', `${user.displayName} è sospeso e non può giocare.`);
    const existing = this.storedParticipant(db, table.id, user.id);
    if (existing && !existing.leftAt) return;
    if (existing?.leftAt) fail('left', `${user.displayName} ha già lasciato questo tavolo.`);
    const busy = this.activeTableOf(db, user.id);
    if (busy) fail('busy', `${user.displayName} è già seduto al tavolo "${busy.name}".`);
    const game = this.game(db, table.gameId);
    const err = canJoin(game, table, this.participantsOf(db, table.id));
    if (err) fail('join', err);
    db.participants.push(this.newParticipant(table, user.id, via, false, true));
  }

  private opStart(db: DemoDb, table: TableRow, game: GameDef) {
    if (table.status !== 'lobby') fail('status', 'Il tavolo è già avviato o chiuso.');
    const err = validateStart(game, table, this.participantsOf(db, table.id));
    if (err) fail('start', err);
    table.status = 'playing';
    table.startedAt = this.iso();
    for (const p of db.participants.filter((x) => x.tableId === table.id)) {
      p.lives = table.startingLives;
      p.score = 0;
    }
  }

  private requirePlaying(table: TableRow, game: GameDef, mode: GameMode) {
    if (table.status !== 'playing') fail('status', 'Il tavolo non è in gioco.');
    if (game.mode !== mode) fail('mode', 'Operazione non valida per questo gioco.');
  }

  private pushRound(db: DemoDb, table: TableRow, by: string, effects: RoundEffect[]) {
    if (!effects.length) fail('round', 'Nessuna variazione da registrare.');
    table.roundCount += 1;
    db.rounds.push({
      id: crypto.randomUUID(),
      tableId: table.id,
      number: table.roundCount,
      createdAt: this.iso(),
      createdBy: by,
      effects,
      undone: false,
    });
  }

  private playingParticipant(db: DemoDb, table: TableRow, userId: string): StoredParticipant {
    const p = this.storedParticipant(db, table.id, userId);
    if (!p || p.leftAt || !p.isPlaying) fail('participant', 'Giocatore non presente al tavolo.');
    return p;
  }

  private opChipsRound(db: DemoDb, actor: Profile, table: TableRow, game: GameDef, entries: ChipsEntry[]) {
    this.requirePlaying(table, game, 'chips');
    const seen = new Set<string>();
    const effects: RoundEffect[] = [];
    for (const e of entries) {
      if (seen.has(e.userId)) fail('round', 'Ogni giocatore può comparire una sola volta per mano.');
      seen.add(e.userId);
      const p = this.playingParticipant(db, table, e.userId);
      const prof = this.profile(db, e.userId);
      let delta: number;
      let outcome: string;
      if (e.outcomeKey) {
        const o = game.outcomes.find((x) => x.key === e.outcomeKey);
        if (!o) fail('outcome', 'Esito non valido.');
        const betErr = validateBet(table, e.bet);
        if (betErr) fail('bet', `${prof.displayName}: ${betErr}`);
        delta = chipDelta(e.bet, o);
        outcome = o.key;
      } else {
        if (!game.allowCustomDelta) fail('outcome', 'Seleziona un esito.');
        if (e.customDelta === undefined || !Number.isInteger(e.customDelta)) fail('outcome', 'Importo non valido.');
        delta = e.customDelta;
        outcome = 'custom';
      }
      const available = prof.chips + (table.settlement === 'on_close' ? p.pendingDelta : 0);
      if (delta < 0 && available + delta < 0) {
        fail('chips', `${prof.displayName} non ha abbastanza fiches (disponibili ${available}).`);
      }
      if (table.settlement === 'live') {
        if (delta !== 0) this.ledger(db, prof.id, delta, 'table_round', `${table.name} · mano ${table.roundCount + 1}`, table.id, actor.id);
      } else {
        p.pendingDelta += delta;
      }
      p.netDelta += delta;
      effects.push({ userId: p.userId, chips: delta, bet: e.bet, outcome });
    }
    this.pushRound(db, table, actor.id, effects);
  }

  private opLivesRound(db: DemoDb, table: TableRow, game: GameDef, changes: LivesChange[], by?: string) {
    this.requirePlaying(table, game, 'lives');
    const roundNo = table.roundCount + 1;
    const effects: RoundEffect[] = [];
    const seen = new Set<string>();
    for (const c of changes) {
      if (!Number.isInteger(c.delta) || c.delta === 0) continue;
      if (seen.has(c.userId)) fail('round', 'Giocatore duplicato.');
      seen.add(c.userId);
      const p = this.playingParticipant(db, table, c.userId);
      const before = p.lives;
      const after = Math.max(0, Math.min(99, before + c.delta));
      if (after === before) continue;
      const eff: RoundEffect = { userId: p.userId, lives: after - before };
      if (after === 0 && before > 0) {
        p.eliminatedAt = this.iso();
        p.eliminationOrder = roundNo;
        eff.eliminated = true;
      }
      if (before === 0 && after > 0) {
        eff.prevOrder = p.eliminationOrder;
        p.eliminatedAt = null;
        p.eliminationOrder = null;
      }
      p.lives = after;
      effects.push(eff);
    }
    this.pushRound(db, table, by ?? table.masterId, effects);
  }

  private opPointsRound(db: DemoDb, table: TableRow, game: GameDef, changes: PointsChange[], by?: string) {
    this.requirePlaying(table, game, 'points');
    const effects = new Map<string, RoundEffect>();
    for (const c of changes) {
      if (!Number.isInteger(c.points) || c.points === 0) continue;
      let targets: StoredParticipant[];
      if (table.useTeams) {
        if (!c.team) fail('team', 'Indica la squadra.');
        targets = db.participants.filter((p) => p.tableId === table.id && p.isPlaying && !p.leftAt && p.team === c.team);
      } else {
        if (!c.userId) fail('round', 'Indica il giocatore.');
        targets = [this.playingParticipant(db, table, c.userId)];
      }
      for (const p of targets) {
        if (effects.has(p.userId)) fail('round', 'Giocatore duplicato.');
        p.score += c.points;
        effects.set(p.userId, { userId: p.userId, points: c.points });
      }
    }
    this.pushRound(db, table, by ?? table.masterId, [...effects.values()]);
  }

  private opSettlePending(db: DemoDb, table: TableRow, p: StoredParticipant, by: string | null) {
    if (p.pendingDelta === 0) return;
    const prof = this.profile(db, p.userId);
    const delta = Math.max(p.pendingDelta, -prof.chips);
    if (delta !== 0) this.ledger(db, p.userId, delta, 'table_settlement', `${table.name} · chiusura conto`, table.id, by);
    p.pendingDelta = 0;
  }

  private opClose(db: DemoDb, table: TableRow, game: GameDef, by: string) {
    if (!ACTIVE.includes(table.status)) fail('status', 'Il tavolo è già chiuso.');
    if (table.status === 'lobby') {
      table.status = 'cancelled';
      table.closedAt = this.iso();
      return;
    }
    const rows = db.participants.filter((p) => p.tableId === table.id);
    for (const p of rows) this.opSettlePending(db, table, p, by);
    const placements = computePlacements(game.mode, this.participantsOf(db, table.id));
    for (const p of rows) p.placement = placements.get(p.userId) ?? null;
    table.status = 'closed';
    table.closedAt = this.iso();
    this.audit(db, by, 'table_close', table.code, { rounds: table.roundCount });
  }

  private opRemove(db: DemoDb, table: TableRow, game: GameDef, userId: string, by: string) {
    const p = this.storedParticipant(db, table.id, userId);
    if (!p || p.leftAt) fail('participant', 'Il giocatore non è al tavolo.');
    if (p.isMaster) fail('master', 'Il game master non può lasciare il tavolo: chiudilo.');
    if (table.status === 'lobby') {
      db.participants = db.participants.filter((x) => x !== p);
      return;
    }
    if (table.status !== 'playing') fail('status', 'Il tavolo è chiuso.');
    this.opSettlePending(db, table, p, by);
    if (game.mode === 'lives' && p.lives > 0) {
      p.lives = 0;
      p.eliminatedAt = this.iso();
      p.eliminationOrder = table.roundCount;
    }
    p.leftAt = this.iso();
  }

  async createTable(input: CreateTableInput): Promise<string> {
    return this.mutate((db) => this.opCreateTable(db, this.meActive(db), input));
  }

  async issueJoinToken(tableId: string, kind: JoinTokenKind): Promise<JoinToken> {
    return this.mutate((db) => {
      const { table } = this.requireMaster(db, tableId);
      if (!ACTIVE.includes(table.status)) fail('status', 'Il tavolo è chiuso.');
      if (kind === 'qr' && !db.settings.allowQrFallback) fail('qr', 'Lo staff ha disattivato l’ingresso con QR/PIN: usa l’NFC.');
      const ttl = db.settings.joinTokenTtlSeconds;
      const token: JoinToken = {
        token: kind === 'qr' ? generatePin() : generateToken(16),
        kind,
        expiresAt: kind === 'static' || ttl <= 0 ? null : new Date(this.now().getTime() + ttl * 1000).toISOString(),
      };
      db.joinTokens = db.joinTokens.filter((t) => !(t.tableId === tableId && t.kind === kind));
      db.joinTokens.push({ tableId, ...token });
      return token;
    });
  }

  async joinWithToken(code: string, token: string, via: JoinMethod): Promise<string> {
    return this.mutate((db) => {
      const me = this.meActive(db);
      const table = db.tables.find((t) => t.code === code.trim().toUpperCase() && ACTIVE.includes(t.status));
      if (!table) fail('not_found', 'Tavolo non trovato o già chiuso.');
      const now = this.now().getTime();
      const match = db.joinTokens.find(
        (t) => t.tableId === table.id && t.token === token.trim() && (!t.expiresAt || Date.parse(t.expiresAt) > now),
      );
      if (!match) fail('token', 'Codice scaduto o non valido: avvicina di nuovo il telefono al tavolo.');
      if (match.kind === 'qr' && !db.settings.allowQrFallback) fail('qr', 'Ingresso con QR/PIN disattivato.');
      this.opAddParticipant(db, table, me, via);
      this.audit(db, me.id, 'table_join', table.code, { via });
      return table.id;
    });
  }

  async addPlayerByPass(tableId: string, passToken: string): Promise<ProfileLite> {
    return this.mutate((db) => {
      const { table, actor } = this.requireMaster(db, tableId);
      const pass = db.passes.find((p) => p.token === passToken.trim());
      if (!pass) fail('pass', 'Pass non riconosciuto.');
      const user = this.profile(db, pass.userId);
      this.opAddParticipant(db, table, user, 'nfc_pass');
      this.audit(db, actor.id, 'table_add_pass', table.code, { user: user.username });
      return toLite(user);
    });
  }

  async leaveTable(tableId: string): Promise<void> {
    this.mutate((db) => {
      const me = this.meActive(db);
      const table = this.table(db, tableId);
      this.opRemove(db, table, this.game(db, table.gameId), me.id, me.id);
    });
  }

  async kick(tableId: string, userId: string): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opRemove(db, table, game, userId, actor.id);
    });
  }

  async setTeam(tableId: string, userId: string, team: Team | null): Promise<void> {
    this.mutate((db) => {
      const { table } = this.requireMaster(db, tableId);
      if (table.status !== 'lobby') fail('status', 'Le squadre si decidono prima di iniziare.');
      if (!table.useTeams) fail('team', 'Questo tavolo non prevede squadre.');
      const p = this.storedParticipant(db, tableId, userId);
      if (!p) fail('participant', 'Giocatore non presente.');
      p.team = team;
    });
  }

  async startTable(tableId: string): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opStart(db, table, game);
      this.audit(db, actor.id, 'table_start', table.code);
    });
  }

  async recordChipsRound(tableId: string, entries: ChipsEntry[]): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opChipsRound(db, actor, table, game, entries);
    });
  }

  async recordLivesRound(tableId: string, changes: LivesChange[]): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opLivesRound(db, table, game, changes, actor.id);
    });
  }

  async recordPointsRound(tableId: string, changes: PointsChange[]): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opPointsRound(db, table, game, changes, actor.id);
    });
  }

  async undoLastRound(tableId: string): Promise<void> {
    this.mutate((db) => {
      const { table, actor } = this.requireMaster(db, tableId);
      if (table.status !== 'playing') fail('status', 'Il tavolo non è in gioco.');
      const last = db.rounds
        .filter((r) => r.tableId === tableId && !r.undone)
        .sort((a, b) => b.number - a.number)[0];
      if (!last) fail('undo', 'Nessuna mano da annullare.');
      for (const e of last.effects) {
        const p = this.storedParticipant(db, tableId, e.userId);
        if (!p) continue;
        if (e.chips) {
          if (table.settlement === 'live') {
            const prof = this.profile(db, e.userId);
            const delta = Math.max(-e.chips, -prof.chips);
            if (delta !== 0) this.ledger(db, e.userId, delta, 'undo', `${table.name} · annullata mano ${last.number}`, tableId, actor.id);
          } else {
            p.pendingDelta -= e.chips;
          }
          p.netDelta -= e.chips;
        }
        if (e.lives) {
          p.lives = Math.max(0, p.lives - e.lives);
          if (e.eliminated) {
            p.eliminatedAt = null;
            p.eliminationOrder = null;
          }
          if (e.prevOrder !== undefined && p.lives === 0) {
            p.eliminationOrder = e.prevOrder;
            p.eliminatedAt = this.iso();
          }
        }
        if (e.points) p.score -= e.points;
      }
      last.undone = true;
    });
  }

  async closeTable(tableId: string): Promise<void> {
    this.mutate((db) => {
      const { table, game, actor } = this.requireMaster(db, tableId);
      this.opClose(db, table, game, actor.id);
    });
  }

  async cancelTable(tableId: string): Promise<void> {
    this.mutate((db) => {
      const { table, actor } = this.requireMaster(db, tableId);
      if (!ACTIVE.includes(table.status)) fail('status', 'Il tavolo è già chiuso.');
      const played = db.rounds.some((r) => r.tableId === tableId && !r.undone);
      if (played && actor.role !== 'staff') {
        fail('cancel', 'Ci sono mani registrate: chiudi il tavolo oppure chiedi allo staff di annullarlo.');
      }
      for (const p of db.participants.filter((x) => x.tableId === tableId)) p.pendingDelta = 0;
      table.status = 'cancelled';
      table.closedAt = this.iso();
      this.audit(db, actor.id, 'table_cancel', table.code);
    });
  }

  // ------------------------------------------------------------------ amministrazione

  async adminOverview(): Promise<AdminOverview> {
    return this.read((db) => {
      this.staff(db);
      const today = dayInTimezone(this.now(), db.settings.timezone);
      return {
        users: db.profiles.length,
        activeTables: db.tables.filter((t) => ACTIVE.includes(t.status)).length,
        chipsInCirculation: db.profiles.reduce((s, p) => s + p.chips, 0),
        pendingGmRequests: db.gmRequests.filter((r) => r.status === 'pending').length,
        tablesToday: db.tables.filter((t) => dayInTimezone(new Date(t.createdAt), db.settings.timezone) === today).length,
        bannedUsers: db.profiles.filter((p) => p.banned).length,
      };
    });
  }

  async adminListUsers(query = ''): Promise<Profile[]> {
    return this.read((db) => {
      this.staff(db);
      const q = query.trim().toLowerCase();
      return db.profiles
        .filter((p) => !q || p.username.includes(q) || p.displayName.toLowerCase().includes(q))
        .sort((a, b) => a.username.localeCompare(b.username));
    });
  }

  async adminSetRole(userId: string, role: Role): Promise<void> {
    this.mutate((db) => {
      const actor = this.staff(db);
      if (userId === actor.id && role !== 'staff') fail('self', 'Non puoi rimuovere il tuo ruolo staff.');
      const p = this.profile(db, userId);
      const from = p.role;
      p.role = role;
      this.audit(db, actor.id, 'set_role', p.username, { from, to: role });
    });
  }

  async adminSetBanned(userId: string, banned: boolean): Promise<void> {
    this.mutate((db) => {
      const actor = this.staff(db);
      if (userId === actor.id) fail('self', 'Non puoi sospendere te stesso.');
      const p = this.profile(db, userId);
      p.banned = banned;
      this.audit(db, actor.id, banned ? 'ban' : 'unban', p.username);
    });
  }

  async adminAdjustChips(userId: string, delta: number, reason: string): Promise<void> {
    this.mutate((db) => {
      const actor = this.staff(db);
      if (!Number.isInteger(delta) || delta === 0) fail('delta', 'Importo non valido.');
      if (reason.trim().length < 3) fail('reason', 'Indica il motivo della rettifica.');
      const p = this.profile(db, userId);
      this.ledger(db, userId, delta, 'admin_adjust', reason.trim(), null, actor.id);
      this.audit(db, actor.id, 'adjust_chips', p.username, { delta, reason: reason.trim() });
    });
  }

  async adminListGmRequests(status?: GmRequestStatus): Promise<GmRequest[]> {
    return this.read((db) => {
      this.staff(db);
      return db.gmRequests
        .filter((r) => !status || r.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, profile: toLite(this.profile(db, r.userId)) }));
    });
  }

  async adminReviewGmRequest(id: string, approve: boolean, note = ''): Promise<void> {
    this.mutate((db) => {
      const actor = this.staff(db);
      const req = db.gmRequests.find((r) => r.id === id);
      if (!req) fail('not_found', 'Richiesta non trovata.');
      if (req.status !== 'pending') fail('status', 'Richiesta già gestita.');
      req.status = approve ? 'approved' : 'rejected';
      req.reviewNote = note.trim();
      req.reviewedBy = actor.id;
      req.reviewedAt = this.iso();
      const user = this.profile(db, req.userId);
      if (approve && user.role === 'player') user.role = 'game_master';
      this.audit(db, actor.id, approve ? 'gm_approve' : 'gm_reject', user.username, { note: req.reviewNote });
    });
  }

  async adminListTables(statuses?: TableStatus[]): Promise<TableSummary[]> {
    return this.read((db) => {
      this.staff(db);
      return db.tables
        .filter((t) => !statuses || statuses.includes(t.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map((t) => this.summary(db, t));
    });
  }

  async adminUpsertGame(game: GameDef): Promise<void> {
    this.mutate((db) => {
      const actor = this.staff(db);
      if (!/^[a-z0-9_]{2,30}$/.test(game.id)) fail('game', 'ID gioco non valido (minuscole, numeri, _).');
      if (game.minParticipants < 2) fail('game', 'Minimo 2 partecipanti.');
      if (game.maxParticipants < game.minParticipants) fail('game', 'Il massimo deve essere ≥ al minimo.');
      if (!game.name.trim()) fail('game', 'Nome obbligatorio.');
      const idx = db.games.findIndex((g) => g.id === game.id);
      if (idx >= 0) db.games[idx] = { ...game };
      else db.games.push({ ...game });
      this.audit(db, actor.id, idx >= 0 ? 'game_update' : 'game_create', game.id);
    });
  }

  async adminUpdateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.mutate((db) => {
      const actor = this.staff(db);
      const next = { ...db.settings, ...patch };
      if (next.dailyBonusBase < 0 || next.startingChips < 0) fail('settings', 'Valori non validi.');
      if (!next.wheel.length || next.wheel.some((m) => !(m > 0))) fail('settings', 'Spicchi della ruota non validi.');
      if (next.maxStreak < 1) fail('settings', 'La serie massima deve essere almeno 1.');
      db.settings = next;
      this.audit(db, actor.id, 'settings_update', 'settings', patch as Record<string, unknown>);
      return { ...next };
    });
  }

  async adminLedger(opts: { userId?: string; limit?: number } = {}): Promise<LedgerEntry[]> {
    return this.read((db) => {
      this.staff(db);
      return db.ledger
        .filter((l) => !opts.userId || l.userId === opts.userId)
        .slice()
        .reverse()
        .slice(0, opts.limit ?? 100);
    });
  }

  async adminAudit(limit = 100): Promise<AuditEntry[]> {
    return this.read((db) => {
      this.staff(db);
      return db.audit
        .slice()
        .reverse()
        .slice(0, limit)
        .map((a) => ({
          ...a,
          actorName: a.actorId ? (db.profiles.find((p) => p.id === a.actorId)?.username ?? '?') : 'sistema',
        }));
    });
  }

  /** Solo demo: azzera i dati e ricrea quelli di esempio. */
  resetDemo() {
    this.storage.removeItem(DB_KEY);
    this.session.removeItem(SESSION_KEY);
    this.save(this.seedDb());
    this.listeners.forEach((l) => l());
    this.authListeners.forEach((l) => l());
    this.channel?.postMessage({ type: 'changed' });
  }
}
