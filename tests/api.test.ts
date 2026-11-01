// Test d'integrazione: server PHP reale (php -S) + SQLite temporaneo, pilotato dal client ApiBackend.
// Ogni "telefono" è un ApiBackend con il proprio barattolo di cookie (sessione PHP separata).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GAMES } from '../src/core/games';
import { ApiBackend } from '../src/data/api/ApiBackend';

const hasPhp = spawnSync('php', ['-v']).status === 0;
const PORT = 18000 + Math.floor(Math.random() * 1000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
let dataDir = '';
let clock = Date.parse('2026-11-01T20:00:00Z');

function device() {
  const jar = new Map<string, string>();
  const f = async (input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    headers.set('X-Test-Now', String(clock));
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/expires=Thu, 01 Jan 1970|Max-Age=0/i.test(c) || v === '' || v === 'deleted') jar.delete(k);
      else jar.set(k, v);
    }
    return res;
  };
  return new ApiBackend({ baseUrl: `${ORIGIN}/api`, fetch: f, fastPollMs: 80, slowPollMs: 80 });
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${ORIGIN}/api/health`);
      if (r.ok) return;
    } catch {
      // non ancora pronto
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server PHP non avviato');
}

describe.skipIf(!hasPhp)('API PHP + SQLite (server reale)', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'party-casino-api-'));
    server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', 'server', 'server/dev-router.php'], {
      env: { ...process.env, PC_DATA_DIR: dataDir, PC_TESTING: '1' },
      stdio: 'ignore',
    });
    await waitForServer();
  });

  afterAll(() => {
    server?.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const admin = device();
  const gm = device();
  const luca = device();
  const giulia = device();
  const marco = device();
  const ids: Record<string, string> = {};

  it('diagnostica, registrazione (il primo utente è staff) e accesso', async () => {
    const health = await (await fetch(`${ORIGIN}/api/health`)).json();
    expect(health.data.pdoSqlite).toBe(true);
    const a = await admin.signUp({ username: 'admin', displayName: 'Staff', password: 'segreto1' });
    expect(a.role).toBe('staff');
    expect(a.chips).toBe(1000);
    for (const [dev, u] of [[gm, 'mazziere'], [luca, 'luca'], [giulia, 'giulia'], [marco, 'marco']] as const) {
      const p = await dev.signUp({ username: u, displayName: u[0].toUpperCase() + u.slice(1), password: 'segreto1' });
      expect(p.role).toBe('player');
      ids[u] = p.id;
    }
    ids.admin = a.id;
    await expect(device().signUp({ username: 'luca', displayName: 'X', password: 'segreto1' })).rejects.toThrow(/già in uso/);
    await expect(device().signUp({ username: 'A!', displayName: 'X', password: 'segreto1' })).rejects.toThrow(/3-20/);
    await expect(device().signIn('luca', 'sbagliata')).rejects.toThrow(/Credenziali/);
    const other = device();
    await other.signIn('luca', 'segreto1');
    expect((await other.currentUser())?.username).toBe('luca');
    await other.signOut();
    expect(await other.currentUser()).toBeNull();
  });

  it('il catalogo giochi del server coincide con quello del client', async () => {
    const games = await admin.listGames();
    const strip = (g: (typeof DEFAULT_GAMES)[number]) => JSON.parse(JSON.stringify(g));
    expect(games.map(strip)).toEqual([...DEFAULT_GAMES].sort((a, b) => a.sort - b.sort).map(strip));
  });

  it('protezione CSRF e dati non esposti', async () => {
    const r = await fetch(`${ORIGIN}/api/me/bonus`, { method: 'POST' });
    expect(r.status).toBe(403);
    const db = await fetch(`${ORIGIN}/api/data/party-casino.sqlite`);
    expect(await db.text()).not.toContain('SQLite format');
    await expect(luca.adminOverview()).rejects.toThrow(/staff/);
  });

  it('richiesta game master approvata dallo staff', async () => {
    await expect(
      gm.createTable({ gameId: 'blackjack', name: '', settlement: 'live', masterPlays: false, startingLives: 0, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false }),
    ).rejects.toThrow(/game master/);
    await gm.requestGameMaster('Faccio il mazziere da anni, sono affidabile');
    await expect(gm.requestGameMaster('Ancora una richiesta')).rejects.toThrow(/attesa/);
    const [req] = await admin.adminListGmRequests('pending');
    expect(req.profile?.username).toBe('mazziere');
    await admin.adminReviewGmRequest(req.id, true, 'Ok');
    expect((await gm.currentUser())?.role).toBe('game_master');
    expect((await gm.myGmRequest())?.status).toBe('approved');
  });

  it('blackjack: adesivo NFC, braccialetto pass, mani, annullo, chiusura, statistiche', async () => {
    const tableId = await gm.createTable({
      gameId: 'blackjack', name: 'Tavolo 1', settlement: 'live', masterPlays: false, startingLives: 0, targetPoints: 0, minBet: 10, maxBet: 0, useTeams: false,
    });
    const { table } = await gm.getTable(tableId);
    const sticker = await gm.issueJoinToken(tableId, 'static');
    expect(sticker.expiresAt).toBeNull();
    await expect(luca.joinWithToken(table.code, 'sbagliato', 'nfc_table')).rejects.toThrow(/non valido/);
    expect(await luca.joinWithToken(table.code, sticker.token, 'nfc_table')).toBe(tableId);
    await expect(gm.startTable(tableId)).rejects.toThrow(/almeno 3/);
    const added = await gm.addPlayerByPass(tableId, await giulia.getMyPassToken());
    expect(added.username).toBe('giulia');

    // aggiornamento "in tempo reale" via polling: Luca riceve la notifica dell'avvio
    let notified = 0;
    const stop = luca.subscribeTable(tableId, () => notified++);
    await new Promise((r) => setTimeout(r, 200));
    await gm.startTable(tableId);
    await new Promise((r) => setTimeout(r, 400));
    stop();
    expect(notified).toBeGreaterThan(0);

    await gm.recordChipsRound(tableId, [
      { userId: ids.luca, bet: 100, outcomeKey: 'blackjack' },
      { userId: ids.giulia, bet: 40, outcomeKey: 'lose' },
    ]);
    expect((await luca.currentUser())!.chips).toBe(1150);
    expect((await giulia.currentUser())!.chips).toBe(960);
    await expect(gm.recordChipsRound(tableId, [{ userId: ids.luca, bet: 5, outcomeKey: 'win' }])).rejects.toThrow(/minima/);
    await expect(gm.recordChipsRound(tableId, [{ userId: ids.giulia, bet: 100000, outcomeKey: 'lose' }])).rejects.toThrow(/abbastanza/);
    await expect(luca.recordChipsRound(tableId, [{ userId: ids.luca, bet: 100, outcomeKey: 'win' }])).rejects.toThrow(/game master/);
    await gm.undoLastRound(tableId);
    expect((await luca.currentUser())!.chips).toBe(1000);
    await gm.recordChipsRound(tableId, [
      { userId: ids.luca, bet: 25, outcomeKey: 'surrender' },
      { userId: ids.giulia, bet: 30, outcomeKey: 'win' },
    ]);
    expect((await luca.currentUser())!.chips).toBe(987);
    await gm.closeTable(tableId);
    const st = await gm.getTable(tableId);
    expect(st.table.status).toBe('closed');
    expect(st.participants.find((p) => p.userId === ids.giulia)!.placement).toBe(1);
    expect(st.rounds[0].undone).toBe(false);
    expect(st.rounds[1].undone).toBe(true);
    const stats = await luca.getStats(ids.giulia);
    expect(stats.wins).toBe(1);
    expect(stats.byGame[0]).toMatchObject({ gameId: 'blackjack', played: 1, wins: 1, net: 30 });
    expect((await luca.getStats(ids.luca)).chipsLost).toBe(13);
    expect(await luca.myActiveTableId()).toBeNull();
  });

  it('blackjack a chiusura: le fiches si applicano solo alla fine', async () => {
    const tableId = await gm.createTable({
      gameId: 'blackjack', name: '', settlement: 'on_close', masterPlays: false, startingLives: 0, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false,
    });
    await gm.addPlayerByPass(tableId, await marco.getMyPassToken());
    await gm.addPlayerByPass(tableId, await luca.getMyPassToken());
    await gm.startTable(tableId);
    await gm.recordChipsRound(tableId, [{ userId: ids.marco, bet: 100, outcomeKey: 'lose' }]);
    expect((await marco.currentUser())!.chips).toBe(1000);
    expect((await gm.getTable(tableId)).participants.find((p) => p.userId === ids.marco)!.pendingDelta).toBe(-100);
    await gm.closeTable(tableId);
    expect((await marco.currentUser())!.chips).toBe(900);
  });

  it('trentuno a vite con PIN manuale, un tavolo alla volta, annullo eliminazione', async () => {
    const tableId = await gm.createTable({
      gameId: 'trentuno', name: '', settlement: 'live', masterPlays: true, startingLives: 2, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false,
    });
    const { table } = await gm.getTable(tableId);
    const pin = await gm.issueJoinToken(tableId, 'qr');
    expect(pin.token).toMatch(/^\d{6}$/);
    await luca.joinWithToken(table.code.toLowerCase(), pin.token, 'code');
    await giulia.joinWithToken(table.code, pin.token, 'code');

    const t2 = await admin.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true, startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: true,
    });
    const code2 = (await admin.getTable(t2)).table.code;
    const pin2 = await admin.issueJoinToken(t2, 'qr');
    await expect(luca.joinWithToken(code2, pin2.token, 'code')).rejects.toThrow(/già seduto/);

    await gm.startTable(tableId);
    await gm.recordLivesRound(tableId, [{ userId: ids.luca, delta: -2 }]);
    let st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids.luca)!.eliminationOrder).toBe(1);
    await gm.undoLastRound(tableId);
    st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids.luca)).toMatchObject({ lives: 2, eliminationOrder: null });
    await gm.recordLivesRound(tableId, [{ userId: ids.luca, delta: -2 }]);
    await gm.recordLivesRound(tableId, [{ userId: ids.mazziere, delta: -5 }]);
    await gm.closeTable(tableId);
    st = await gm.getTable(tableId);
    const order = st.participants
      .filter((p) => p.isPlaying)
      .sort((a, b) => a.placement! - b.placement!)
      .map((p) => `${p.profile.username}:${p.placement}`);
    expect(order).toEqual(['giulia:1', 'mazziere:2', 'luca:3']);
    expect((await luca.getStats(ids.giulia)).winsByMode.lives).toBe(1);

    // scopa a coppie sul tavolo dello staff
    await admin.addPlayerByPass(t2, await gm.getMyPassToken());
    await admin.addPlayerByPass(t2, await luca.getMyPassToken());
    await admin.addPlayerByPass(t2, await giulia.getMyPassToken());
    await expect(admin.startTable(t2)).rejects.toThrow(/squadra/);
    await admin.setTeam(t2, ids.admin, 'A');
    await admin.setTeam(t2, ids.mazziere, 'A');
    await admin.setTeam(t2, ids.luca, 'B');
    await admin.setTeam(t2, ids.giulia, 'B');
    await admin.startTable(t2);
    await admin.recordPointsRound(t2, [{ team: 'A', points: 7 }, { team: 'B', points: 4 }]);
    await admin.recordPointsRound(t2, [{ team: 'B', points: 8 }]);
    st = await admin.getTable(t2);
    expect(st.participants.find((p) => p.userId === ids.mazziere)!.score).toBe(7);
    await admin.closeTable(t2);
    st = await admin.getTable(t2);
    expect(st.participants.find((p) => p.userId === ids.giulia)!.placement).toBe(1);
    expect((await luca.leaderboard('wins'))[0].profile.username).toBe('giulia');
  });

  it('codici a scadenza e bonus giornaliero una volta al giorno', async () => {
    const tableId = await gm.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true, startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: false,
    });
    const code = (await gm.getTable(tableId)).table.code;
    const pin = await gm.issueJoinToken(tableId, 'qr');
    clock += 10 * 60 * 1000;
    await expect(marco.joinWithToken(code, pin.token, 'code')).rejects.toThrow(/scaduto/);
    await marco.joinWithToken(code, (await gm.issueJoinToken(tableId, 'qr')).token, 'code');
    await gm.cancelTable(tableId);

    const r = await marco.claimDailyBonus();
    expect(r.amount).toBeGreaterThan(0);
    expect(r.balance).toBe(900 + r.amount);
    await expect(marco.claimDailyBonus()).rejects.toThrow(/già ritirato/);
    clock += 24 * 3600 * 1000;
    expect((await marco.claimDailyBonus()).streak).toBe(2);
  });

  it('amministrazione: rettifiche, pass, impostazioni, registro coerente', async () => {
    await admin.adminAdjustChips(ids.marco, 500, 'Premio torneo');
    await expect(admin.adminAdjustChips(ids.marco, -1_000_000, 'errore')).rejects.toThrow(/abbastanza/);
    await expect(admin.adminSetBanned(ids.admin, true)).rejects.toThrow(/te stesso/);
    expect((await admin.adminAudit())[0].action).toBe('adjust_chips');
    expect(await admin.adminUserPassToken(ids.luca)).toBe(await luca.getMyPassToken());

    await expect(admin.adminUpdateSettings({ wheel: [1, 0] })).rejects.toThrow(/ruota/);
    const s = await admin.adminUpdateSettings({ dailyBonusBase: 250, wheel: [1, 2, 10], allowManualCode: false });
    expect(s).toMatchObject({ dailyBonusBase: 250, wheel: [1, 2, 10], allowManualCode: false });
    const t = await gm.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true, startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: false,
    });
    await expect(gm.issueJoinToken(t, 'qr')).rejects.toThrow(/disattivato/);
    await gm.cancelTable(t);

    await admin.adminUpsertGame({ ...DEFAULT_GAMES[0], id: 'tombola', name: 'Tombola', mode: 'points', room: 'arcade', outcomes: [], targetPoints: 5, minParticipants: 2, maxParticipants: 30 });
    expect((await admin.listGames()).some((g) => g.id === 'tombola')).toBe(true);

    await admin.adminSetBanned(ids.marco, true);
    await expect(marco.claimDailyBonus()).rejects.toThrow(/sospeso/);
    await admin.adminSetBanned(ids.marco, false);

    const overview = await admin.adminOverview();
    expect(overview.users).toBe(5);
    for (const u of await admin.adminListUsers()) {
      const ledger = await admin.adminLedger({ userId: u.id, limit: 500 });
      expect(ledger.reduce((sum, l) => sum + l.delta, 0)).toBe(u.chips);
      expect(ledger[0].balanceAfter).toBe(u.chips);
    }
  });

  it('blocca i tentativi di accesso ripetuti', async () => {
    const d = device();
    for (let i = 0; i < 10; i++) await expect(d.signIn('luca', 'no')).rejects.toThrow(/Credenziali|Troppi/);
    await expect(d.signIn('luca', 'segreto1')).rejects.toThrow(/Troppi tentativi/);
    clock += 16 * 60 * 1000;
    await expect(d.signIn('luca', 'segreto1')).resolves.toMatchObject({ username: 'luca' });
  });
});
