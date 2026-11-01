import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeUsername } from '../../core/rules';
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
  type Participant,
  type PlayerStats,
  type PointsChange,
  type Profile,
  type ProfileLite,
  type Role,
  type Round,
  type Settings,
  type TableRow,
  type TableState,
  type TableStatus,
  type TableSummary,
  type Team,
} from '../../core/types';
import type { Backend, SignUpInput, Unsubscribe } from '../backend';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const PROFILE_COLS = 'id,username,display_name,avatar,color,role,chips,bio,banned,created_at,last_bonus_date,bonus_streak';

function toAppError(e: PostgrestError | { message: string; code?: string; hint?: string | null }): AppError {
  return new AppError(e.hint || e.code || 'error', e.message);
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function mapLite(r: Row): ProfileLite {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    color: r.color,
    role: r.role as Role,
    chips: num(r.chips),
  };
}

function mapProfile(r: Row): Profile {
  return {
    ...mapLite(r),
    bio: r.bio ?? '',
    banned: !!r.banned,
    createdAt: r.created_at,
    lastBonusDate: r.last_bonus_date ?? null,
    bonusStreak: num(r.bonus_streak),
  };
}

function mapGame(r: Row): GameDef {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    room: r.room,
    icon: r.icon,
    description: r.description,
    minParticipants: r.min_participants,
    maxParticipants: r.max_participants,
    defaultLives: r.default_lives,
    targetPoints: r.target_points,
    masterPlaysDefault: r.master_plays_default,
    allowTeams: r.allow_teams,
    allowLateJoin: r.allow_late_join,
    outcomes: (r.outcomes ?? []).map((o: Row) => ({ key: o.key, label: o.label, mult: Number(o.mult) })),
    allowCustomDelta: r.allow_custom_delta,
    enabled: r.enabled,
    sort: r.sort,
  };
}

function mapTable(r: Row): TableRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    gameId: r.game_id,
    masterId: r.master_id,
    status: r.status,
    settlement: r.settlement,
    masterPlays: r.master_plays,
    startingLives: r.starting_lives,
    targetPoints: r.target_points,
    minBet: r.min_bet,
    maxBet: r.max_bet,
    useTeams: r.use_teams,
    roundCount: r.round_count,
    createdAt: r.created_at,
    startedAt: r.started_at,
    closedAt: r.closed_at,
  };
}

function mapParticipant(r: Row): Participant {
  return {
    tableId: r.table_id,
    userId: r.user_id,
    isMaster: r.is_master,
    isPlaying: r.is_playing,
    joinedVia: r.joined_via,
    lives: r.lives,
    score: r.score,
    team: r.team,
    pendingDelta: num(r.pending_delta),
    netDelta: num(r.net_delta),
    eliminatedAt: r.eliminated_at,
    eliminationOrder: r.elimination_order,
    placement: r.placement,
    joinedAt: r.joined_at,
    leftAt: r.left_at,
    profile: mapLite(r.profile),
  };
}

function mapRound(r: Row): Round {
  return {
    id: r.id,
    tableId: r.table_id,
    number: r.number,
    createdAt: r.created_at,
    createdBy: r.created_by,
    effects: r.effects ?? [],
    undone: r.undone,
  };
}

function mapLedger(r: Row): LedgerEntry {
  return {
    id: String(r.id),
    userId: r.user_id,
    delta: num(r.delta),
    balanceAfter: num(r.balance_after),
    kind: r.kind,
    tableId: r.table_id,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function mapGmRequest(r: Row): GmRequest {
  return {
    id: r.id,
    userId: r.user_id,
    motivation: r.motivation,
    status: r.status,
    reviewNote: r.review_note ?? '',
    reviewedBy: r.reviewed_by,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    profile: r.profile ? mapLite(r.profile) : undefined,
  };
}

function mapSettings(r: Row): Settings {
  return {
    dailyBonusBase: r.daily_bonus_base,
    startingChips: r.starting_chips,
    wheel: (r.wheel ?? []).map(Number),
    streakBonusPct: r.streak_bonus_pct,
    maxStreak: r.max_streak,
    joinTokenTtlSeconds: r.join_token_ttl_seconds,
    allowQrFallback: r.allow_qr_fallback,
    timezone: r.timezone,
  };
}

const TABLE_SUMMARY_SELECT = `*, game:games(*), master:profiles!game_tables_master_fk(${PROFILE_COLS}), participants:table_participants(user_id,left_at)`;

function mapSummary(r: Row): TableSummary {
  return {
    table: mapTable(r),
    game: mapGame(r.game),
    master: mapLite(r.master),
    participantCount: (r.participants ?? []).filter((p: Row) => !p.left_at).length,
  };
}

function debounce(fn: () => void, ms = 120) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  private async rpc<T>(fn: string, args?: Row): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw toAppError(error);
    return data as T;
  }

  private async q<T>(p: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
    const { data, error } = await p;
    if (error) throw toAppError(error);
    return data as T;
  }

  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new AppError('auth', 'Devi accedere per continuare.');
    return id;
  }

  // ------------------------------------------------------------------ autenticazione

  async currentUser(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return null;
    const row = await this.q<Row | null>(this.sb.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle());
    return row ? mapProfile(row) : null;
  }

  async signIn(identifier: string, password: string): Promise<Profile> {
    const email = identifier.trim();
    if (!email.includes('@')) throw new AppError('auth', 'Accedi con l’indirizzo email del tuo account.');
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new AppError('auth', error.message === 'Invalid login credentials' ? 'Credenziali non valide.' : error.message);
    const me = await this.currentUser();
    if (!me) throw new AppError('auth', 'Profilo non trovato.');
    return me;
  }

  async signUp(input: SignUpInput): Promise<Profile> {
    const username = normalizeUsername(input.username);
    const free = await this.rpc<boolean>('username_available', { p_username: username });
    if (!free) throw new AppError('username', 'Username non valido o già in uso.');
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { username, display_name: input.displayName.trim() } },
    });
    if (error) throw new AppError('signup', error.message);
    if (!data.session) {
      throw new AppError('confirm', 'Registrazione completata! Conferma l’email dal link che ti abbiamo inviato, poi accedi.');
    }
    const me = await this.currentUser();
    if (!me) throw new AppError('signup', 'Profilo non creato, riprova.');
    return me;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  onAuthChange(cb: () => void): Unsubscribe {
    const { data } = this.sb.auth.onAuthStateChange(() => cb());
    return () => data.subscription.unsubscribe();
  }

  // ------------------------------------------------------------------ profili

  async getProfile(userId: string): Promise<Profile> {
    return mapProfile(await this.q<Row>(this.sb.from('profiles').select(PROFILE_COLS).eq('id', userId).single()));
  }

  async findProfileByUsername(username: string): Promise<Profile | null> {
    const row = await this.q<Row | null>(
      this.sb.from('profiles').select(PROFILE_COLS).eq('username', normalizeUsername(username)).maybeSingle(),
    );
    return row ? mapProfile(row) : null;
  }

  async updateMyProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatar' | 'color' | 'bio'>>): Promise<Profile> {
    const row = await this.rpc<Row>('update_my_profile', {
      p_display_name: patch.displayName ?? null,
      p_avatar: patch.avatar ?? null,
      p_color: patch.color ?? null,
      p_bio: patch.bio ?? null,
    });
    return mapProfile(row);
  }

  async getStats(userId: string): Promise<PlayerStats> {
    return this.rpc<PlayerStats>('get_player_stats', { p_user: userId });
  }

  async leaderboard(kind: LeaderKind): Promise<LeaderRow[]> {
    const rows = await this.rpc<Row[]>('leaderboard', { p_kind: kind, p_limit: 50 });
    return rows.map((r) => ({ profile: mapLite(r), value: num(r.value) }));
  }

  async myLedger(limit = 30): Promise<LedgerEntry[]> {
    const uid = await this.uid();
    const rows = await this.q<Row[]>(
      this.sb.from('chip_ledger').select('*').eq('user_id', uid).order('id', { ascending: false }).limit(limit),
    );
    return rows.map(mapLedger);
  }

  // ------------------------------------------------------------------ bonus e pass

  async getSettings(): Promise<Settings> {
    return mapSettings(await this.q<Row>(this.sb.from('app_settings').select('*').eq('id', 1).single()));
  }

  async claimDailyBonus(): Promise<BonusResult> {
    const r = await this.rpc<Row>('claim_daily_bonus');
    return {
      amount: num(r.amount),
      multiplier: num(r.multiplier),
      segment: num(r.segment),
      streak: num(r.streak),
      balance: num(r.balance),
    };
  }

  getMyPassToken(): Promise<string> {
    return this.rpc<string>('get_my_pass');
  }

  rotateMyPassToken(): Promise<string> {
    return this.rpc<string>('rotate_my_pass');
  }

  // ------------------------------------------------------------------ GM

  async requestGameMaster(motivation: string): Promise<GmRequest> {
    return mapGmRequest(await this.rpc<Row>('request_game_master', { p_motivation: motivation }));
  }

  async myGmRequest(): Promise<GmRequest | null> {
    const uid = await this.uid();
    const row = await this.q<Row | null>(
      this.sb.from('gm_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    );
    return row ? mapGmRequest(row) : null;
  }

  // ------------------------------------------------------------------ tavoli

  async listGames(): Promise<GameDef[]> {
    const rows = await this.q<Row[]>(this.sb.from('games').select('*').order('sort'));
    return rows.map(mapGame);
  }

  async listActiveTables(): Promise<TableSummary[]> {
    const rows = await this.q<Row[]>(
      this.sb.from('game_tables').select(TABLE_SUMMARY_SELECT).in('status', ['lobby', 'playing']).order('created_at', { ascending: false }),
    );
    return rows.map(mapSummary);
  }

  async myActiveTableId(): Promise<string | null> {
    const { data } = await this.sb.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return null;
    const rows = await this.q<Row[]>(
      this.sb
        .from('table_participants')
        .select('table_id, game_tables!inner(status)')
        .eq('user_id', uid)
        .is('left_at', null)
        .in('game_tables.status', ['lobby', 'playing'])
        .limit(1),
    );
    return rows[0]?.table_id ?? null;
  }

  async getTable(tableId: string): Promise<TableState> {
    const [t, parts, rounds] = await Promise.all([
      this.q<Row>(
        this.sb
          .from('game_tables')
          .select(`*, game:games(*), master:profiles!game_tables_master_fk(${PROFILE_COLS})`)
          .eq('id', tableId)
          .single(),
      ),
      this.q<Row[]>(
        this.sb
          .from('table_participants')
          .select(`*, profile:profiles!table_participants_user_fk(${PROFILE_COLS})`)
          .eq('table_id', tableId)
          .order('joined_at'),
      ),
      this.q<Row[]>(this.sb.from('rounds').select('*').eq('table_id', tableId).order('number', { ascending: false }).limit(60)),
    ]);
    return {
      table: mapTable(t),
      game: mapGame(t.game),
      master: mapLite(t.master),
      participants: parts.map(mapParticipant).sort((a, b) => Number(b.isMaster) - Number(a.isMaster)),
      rounds: rounds.map(mapRound),
    };
  }

  subscribeLobby(cb: () => void): Unsubscribe {
    const fire = debounce(cb);
    const ch = this.sb
      .channel(`lobby-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables' }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_participants' }, fire)
      .subscribe();
    return () => {
      void this.sb.removeChannel(ch);
    };
  }

  subscribeTable(tableId: string, cb: () => void): Unsubscribe {
    const fire = debounce(cb);
    const ch = this.sb
      .channel(`table-${tableId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables', filter: `id=eq.${tableId}` }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_participants', filter: `table_id=eq.${tableId}` }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `table_id=eq.${tableId}` }, fire)
      .subscribe();
    return () => {
      void this.sb.removeChannel(ch);
    };
  }

  createTable(i: CreateTableInput): Promise<string> {
    return this.rpc<string>('create_table', {
      p_game_id: i.gameId,
      p_name: i.name,
      p_settlement: i.settlement,
      p_master_plays: i.masterPlays,
      p_starting_lives: i.startingLives,
      p_target_points: i.targetPoints,
      p_min_bet: i.minBet,
      p_max_bet: i.maxBet,
      p_use_teams: i.useTeams,
    });
  }

  async issueJoinToken(tableId: string, kind: JoinTokenKind): Promise<JoinToken> {
    const r = await this.rpc<Row>('issue_join_token', { p_table: tableId, p_kind: kind });
    return { token: r.token, kind: r.kind, expiresAt: r.expires_at };
  }

  joinWithToken(code: string, token: string, via: JoinMethod): Promise<string> {
    return this.rpc<string>('join_with_token', { p_code: code, p_token: token, p_via: via });
  }

  async addPlayerByPass(tableId: string, passToken: string): Promise<ProfileLite> {
    return mapLite(await this.rpc<Row>('add_player_by_pass', { p_table: tableId, p_pass: passToken }));
  }

  async leaveTable(tableId: string): Promise<void> {
    await this.rpc('leave_table', { p_table: tableId });
  }

  async kick(tableId: string, userId: string): Promise<void> {
    await this.rpc('kick_participant', { p_table: tableId, p_user: userId });
  }

  async setTeam(tableId: string, userId: string, team: Team | null): Promise<void> {
    await this.rpc('set_team', { p_table: tableId, p_user: userId, p_team: team });
  }

  async startTable(tableId: string): Promise<void> {
    await this.rpc('start_table', { p_table: tableId });
  }

  async recordChipsRound(tableId: string, entries: ChipsEntry[]): Promise<void> {
    await this.rpc('record_chips_round', { p_table: tableId, p_entries: entries });
  }

  async recordLivesRound(tableId: string, changes: LivesChange[]): Promise<void> {
    await this.rpc('record_lives_round', { p_table: tableId, p_changes: changes });
  }

  async recordPointsRound(tableId: string, changes: PointsChange[]): Promise<void> {
    await this.rpc('record_points_round', { p_table: tableId, p_changes: changes });
  }

  async undoLastRound(tableId: string): Promise<void> {
    await this.rpc('undo_last_round', { p_table: tableId });
  }

  async closeTable(tableId: string): Promise<void> {
    await this.rpc('close_table', { p_table: tableId });
  }

  async cancelTable(tableId: string): Promise<void> {
    await this.rpc('cancel_table', { p_table: tableId });
  }

  // ------------------------------------------------------------------ admin

  adminOverview(): Promise<AdminOverview> {
    return this.rpc<AdminOverview>('admin_overview');
  }

  async adminListUsers(query = ''): Promise<Profile[]> {
    let req = this.sb.from('profiles').select(PROFILE_COLS).order('username').limit(200);
    const q = query.replace(/[%,()*]/g, '').trim();
    if (q) req = req.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
    return (await this.q<Row[]>(req)).map(mapProfile);
  }

  async adminSetRole(userId: string, role: Role): Promise<void> {
    await this.rpc('admin_set_role', { p_user: userId, p_role: role });
  }

  async adminSetBanned(userId: string, banned: boolean): Promise<void> {
    await this.rpc('admin_set_banned', { p_user: userId, p_banned: banned });
  }

  async adminAdjustChips(userId: string, delta: number, reason: string): Promise<void> {
    await this.rpc('admin_adjust_chips', { p_user: userId, p_delta: delta, p_reason: reason });
  }

  async adminListGmRequests(status?: GmRequestStatus): Promise<GmRequest[]> {
    let req = this.sb
      .from('gm_requests')
      .select(`*, profile:profiles!gm_requests_user_fk(${PROFILE_COLS})`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) req = req.eq('status', status);
    return (await this.q<Row[]>(req)).map(mapGmRequest);
  }

  async adminReviewGmRequest(id: string, approve: boolean, note = ''): Promise<void> {
    await this.rpc('admin_review_gm_request', { p_request: id, p_approve: approve, p_note: note });
  }

  async adminListTables(statuses?: TableStatus[]): Promise<TableSummary[]> {
    let req = this.sb.from('game_tables').select(TABLE_SUMMARY_SELECT).order('created_at', { ascending: false }).limit(100);
    if (statuses?.length) req = req.in('status', statuses);
    return (await this.q<Row[]>(req)).map(mapSummary);
  }

  async adminUpsertGame(game: GameDef): Promise<void> {
    await this.rpc('admin_upsert_game', { p_game: game });
  }

  async adminUpdateSettings(patch: Partial<Settings>): Promise<Settings> {
    return mapSettings(await this.rpc<Row>('admin_update_settings', { p_patch: patch }));
  }

  async adminLedger(opts: { userId?: string; limit?: number } = {}): Promise<LedgerEntry[]> {
    let req = this.sb.from('chip_ledger').select('*').order('id', { ascending: false }).limit(opts.limit ?? 100);
    if (opts.userId) req = req.eq('user_id', opts.userId);
    return (await this.q<Row[]>(req)).map(mapLedger);
  }

  async adminAudit(limit = 100): Promise<AuditEntry[]> {
    const rows = await this.q<Row[]>(
      this.sb.from('audit_log').select('*, actor:profiles!audit_log_actor_fk(username)').order('id', { ascending: false }).limit(limit),
    );
    return rows.map((r) => ({
      id: String(r.id),
      actorId: r.actor_id,
      actorName: r.actor?.username ?? 'sistema',
      action: r.action,
      target: r.target,
      details: r.details ?? {},
      createdAt: r.created_at,
    }));
  }
}
