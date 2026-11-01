import {
  AppError,
  type AdminOverview,
  type AuditEntry,
  type BonusResult,
  type ChipsEntry,
  type CreateTableInput,
  type GameDef,
  type GmRequest,
  type GmRequestStatus,
  type JoinMethod,
  type JoinToken,
  type JoinTokenKind,
  type LeaderKind,
  type LeaderRow,
  type LedgerEntry,
  type LivesChange,
  type PlayerStats,
  type PointsChange,
  type Profile,
  type ProfileLite,
  type Role,
  type Settings,
  type TableState,
  type TableStatus,
  type TableSummary,
  type Team,
} from '../../core/types';
import type { Backend, SignUpInput, Unsubscribe } from '../backend';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiBackendOptions {
  /** URL base dell'API, predefinito: <base dell'app>/api */
  baseUrl?: string;
  fetch?: FetchLike;
  /** intervallo di polling con un tavolo aperto / altrove (ms) */
  fastPollMs?: number;
  slowPollMs?: number;
}

interface Sub {
  cb: () => void;
  fast: boolean;
}

/**
 * Client dell'API PHP (server/api). Gli aggiornamenti "in tempo reale" arrivano con un polling
 * leggerissimo su /api/version: quando il numero cambia, chi è in ascolto ricarica i dati.
 * Su hosting condiviso (Aruba Linux Basic) non sono disponibili WebSocket.
 */
export class ApiBackend implements Backend {
  readonly mode = 'server' as const;
  private base: string;
  private fetchImpl: FetchLike;
  private fastMs: number;
  private slowMs: number;
  private subs = new Set<Sub>();
  private authSubs = new Set<() => void>();
  private version = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;

  constructor(opts: ApiBackendOptions = {}) {
    const appBase = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
    this.base = (opts.baseUrl ?? `${appBase.replace(/\/$/, '')}/api`).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.fastMs = opts.fastPollMs ?? 2000;
    this.slowMs = opts.slowPollMs ?? 6000;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.hidden()) this.pokeSoon();
      });
    }
  }

  // ------------------------------------------------------------------ trasporto

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    let url = this.base + path;
    if (query) {
      const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'party-casino', Accept: 'application/json' },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      });
    } catch {
      throw new AppError('network', 'Connessione assente: controlla la rete e riprova.');
    }
    let json: { data?: T; error?: { code: string; message: string } } | null = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.error) {
      throw new AppError(json?.error?.code ?? 'http', json?.error?.message ?? `Errore del server (${res.status}).`);
    }
    if (method === 'POST') this.pokeSoon();
    return json.data as T;
  }

  private get = <T>(path: string, query?: Record<string, string | number | undefined>) => this.req<T>('GET', path, undefined, query);
  private post = <T>(path: string, body?: unknown) => this.req<T>('POST', path, body);

  // ------------------------------------------------------------------ polling

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.subs.size) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private nextDelay(): number {
    if (this.hidden()) return 20000;
    return [...this.subs].some((s) => s.fast) ? this.fastMs : this.slowMs;
  }

  private async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      const { v } = await this.get<{ v: number }>('/version');
      if (this.version !== -1 && v !== this.version) this.subs.forEach((s) => s.cb());
      this.version = v;
    } catch {
      // rete assente: si riprova al giro successivo
    } finally {
      this.polling = false;
      this.schedule(this.nextDelay());
    }
  }

  /** Dopo una nostra modifica controlliamo subito la versione. */
  private pokeSoon() {
    if (this.subs.size) this.schedule(50);
  }

  private subscribe(cb: () => void, fast: boolean): Unsubscribe {
    const sub = { cb, fast };
    this.subs.add(sub);
    if (!this.timer && !this.polling) this.schedule(0);
    return () => {
      this.subs.delete(sub);
      if (!this.subs.size && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }

  subscribeLobby(cb: () => void): Unsubscribe {
    return this.subscribe(cb, false);
  }

  subscribeTable(_tableId: string, cb: () => void): Unsubscribe {
    return this.subscribe(cb, true);
  }

  // ------------------------------------------------------------------ autenticazione

  currentUser(): Promise<Profile | null> {
    return this.get<Profile | null>('/auth/me');
  }

  async signIn(identifier: string, password: string): Promise<Profile> {
    const p = await this.post<Profile>('/auth/login', { identifier, password });
    this.authSubs.forEach((l) => l());
    return p;
  }

  async signUp(input: SignUpInput): Promise<Profile> {
    const p = await this.post<Profile>('/auth/register', { username: input.username, displayName: input.displayName, password: input.password });
    this.authSubs.forEach((l) => l());
    return p;
  }

  async signOut(): Promise<void> {
    await this.post('/auth/logout');
    this.authSubs.forEach((l) => l());
  }

  async changePassword(current: string, next: string): Promise<void> {
    await this.post('/auth/password', { current, next });
  }

  onAuthChange(cb: () => void): Unsubscribe {
    this.authSubs.add(cb);
    return () => this.authSubs.delete(cb);
  }

  // ------------------------------------------------------------------ profili

  getProfile(userId: string): Promise<Profile> {
    return this.get(`/profiles/${userId}`);
  }

  findProfileByUsername(username: string): Promise<Profile | null> {
    return this.get(`/profiles/by-username/${encodeURIComponent(username)}`);
  }

  updateMyProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatar' | 'color' | 'bio'>>): Promise<Profile> {
    return this.post('/me/profile', patch);
  }

  getStats(userId: string): Promise<PlayerStats> {
    return this.get(`/stats/${userId}`);
  }

  leaderboard(kind: LeaderKind): Promise<LeaderRow[]> {
    return this.get('/leaderboard', { kind });
  }

  myLedger(limit = 30): Promise<LedgerEntry[]> {
    return this.get('/me/ledger', { limit });
  }

  getSettings(): Promise<Settings> {
    return this.get('/settings');
  }

  claimDailyBonus(): Promise<BonusResult> {
    return this.post('/me/bonus');
  }

  getMyPassToken(): Promise<string> {
    return this.get('/me/pass');
  }

  rotateMyPassToken(): Promise<string> {
    return this.post('/me/pass/rotate');
  }

  requestGameMaster(motivation: string): Promise<GmRequest> {
    return this.post('/gm-requests', { motivation });
  }

  myGmRequest(): Promise<GmRequest | null> {
    return this.get('/me/gm-request');
  }

  // ------------------------------------------------------------------ tavoli

  listGames(): Promise<GameDef[]> {
    return this.get('/games');
  }

  listActiveTables(): Promise<TableSummary[]> {
    return this.get('/tables/active');
  }

  myActiveTableId(): Promise<string | null> {
    return this.get('/me/active-table');
  }

  getTable(tableId: string): Promise<TableState> {
    return this.get(`/tables/${tableId}`);
  }

  createTable(input: CreateTableInput): Promise<string> {
    return this.post('/tables', input);
  }

  issueJoinToken(tableId: string, kind: JoinTokenKind): Promise<JoinToken> {
    return this.post(`/tables/${tableId}/token`, { kind });
  }

  joinWithToken(code: string, token: string, via: JoinMethod): Promise<string> {
    return this.post('/join', { code, token, via });
  }

  addPlayerByPass(tableId: string, passToken: string): Promise<ProfileLite> {
    return this.post(`/tables/${tableId}/add-pass`, { pass: passToken });
  }

  async leaveTable(tableId: string): Promise<void> {
    await this.post(`/tables/${tableId}/leave`);
  }

  async kick(tableId: string, userId: string): Promise<void> {
    await this.post(`/tables/${tableId}/kick`, { userId });
  }

  async setTeam(tableId: string, userId: string, team: Team | null): Promise<void> {
    await this.post(`/tables/${tableId}/team`, { userId, team });
  }

  async startTable(tableId: string): Promise<void> {
    await this.post(`/tables/${tableId}/start`);
  }

  async recordChipsRound(tableId: string, entries: ChipsEntry[]): Promise<void> {
    await this.post(`/tables/${tableId}/rounds/chips`, { entries });
  }

  async recordLivesRound(tableId: string, changes: LivesChange[]): Promise<void> {
    await this.post(`/tables/${tableId}/rounds/lives`, { changes });
  }

  async recordPointsRound(tableId: string, changes: PointsChange[]): Promise<void> {
    await this.post(`/tables/${tableId}/rounds/points`, { changes });
  }

  async undoLastRound(tableId: string): Promise<void> {
    await this.post(`/tables/${tableId}/undo`);
  }

  async closeTable(tableId: string): Promise<void> {
    await this.post(`/tables/${tableId}/close`);
  }

  async cancelTable(tableId: string): Promise<void> {
    await this.post(`/tables/${tableId}/cancel`);
  }

  // ------------------------------------------------------------------ admin

  adminOverview(): Promise<AdminOverview> {
    return this.get('/admin/overview');
  }

  adminListUsers(query = ''): Promise<Profile[]> {
    return this.get('/admin/users', { q: query });
  }

  async adminSetRole(userId: string, role: Role): Promise<void> {
    await this.post(`/admin/users/${userId}/role`, { role });
  }

  async adminSetBanned(userId: string, banned: boolean): Promise<void> {
    await this.post(`/admin/users/${userId}/ban`, { banned });
  }

  async adminAdjustChips(userId: string, delta: number, reason: string): Promise<void> {
    await this.post(`/admin/users/${userId}/chips`, { delta, reason });
  }

  adminUserPassToken(userId: string): Promise<string> {
    return this.post(`/admin/users/${userId}/pass`);
  }

  adminListGmRequests(status?: GmRequestStatus): Promise<GmRequest[]> {
    return this.get('/admin/gm-requests', { status });
  }

  async adminReviewGmRequest(id: string, approve: boolean, note = ''): Promise<void> {
    await this.post(`/admin/gm-requests/${id}/review`, { approve, note });
  }

  adminListTables(statuses?: TableStatus[]): Promise<TableSummary[]> {
    return this.get('/admin/tables', { status: statuses?.join(',') });
  }

  async adminUpsertGame(game: GameDef): Promise<void> {
    await this.post('/admin/games', { game });
  }

  adminUpdateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.post('/admin/settings', { patch });
  }

  adminLedger(opts: { userId?: string; limit?: number } = {}): Promise<LedgerEntry[]> {
    return this.get('/admin/ledger', { userId: opts.userId, limit: opts.limit ?? 100 });
  }

  adminAudit(limit = 100): Promise<AuditEntry[]> {
    return this.get('/admin/audit', { limit });
  }
}
