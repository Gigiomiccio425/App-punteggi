import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend, MemoryStore, DEMO_PASSWORD } from './LocalBackend';

/** Simula più telefoni: stesso "server" (storage condiviso), sessioni separate. */
function devices() {
  const storage = new MemoryStore();
  let clock = new Date('2026-11-01T20:00:00Z');
  const mk = () =>
    new LocalBackend({ storage, session: new MemoryStore(), channel: null, now: () => clock, random: () => 0.1 });
  return {
    mk,
    tick(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('LocalBackend: flusso completo', () => {
  let d: ReturnType<typeof devices>;
  beforeEach(() => {
    d = devices();
  });

  it('i dati demo popolano statistiche e classifica', async () => {
    const b = d.mk();
    await b.signIn('luca', DEMO_PASSWORD);
    const me = (await b.currentUser())!;
    const stats = await b.getStats(me.id);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.wins).toBe(1);
    expect(me.chips).toBe(1350);
    const giulia = (await b.findProfileByUsername('giulia'))!;
    expect((await b.getStats(giulia.id)).winsByMode.lives).toBe(1);
    const lb = await b.leaderboard('chips');
    expect(lb[0].profile.username).toBe('luca');
  });

  it('solo i GM autorizzati aprono tavoli; lo staff approva le richieste', async () => {
    const sofia = d.mk();
    await sofia.signIn('sofia', DEMO_PASSWORD);
    await expect(
      sofia.createTable({ gameId: 'blackjack', name: '', settlement: 'live', masterPlays: false, startingLives: 0, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false }),
    ).rejects.toThrow(/game master/);
    const admin = d.mk();
    await admin.signIn('admin', DEMO_PASSWORD);
    const [req] = await admin.adminListGmRequests('pending');
    expect(req.profile?.username).toBe('sofia');
    await admin.adminReviewGmRequest(req.id, true, 'Ok!');
    expect((await sofia.currentUser())!.role).toBe('game_master');
  });

  it('blackjack: ingresso via token NFC, mani live, annullo, chiusura', async () => {
    const gm = d.mk();
    await gm.signIn('mazziere', DEMO_PASSWORD);
    const tableId = await gm.createTable({
      gameId: 'blackjack', name: 'Tavolo 1', settlement: 'live', masterPlays: false,
      startingLives: 0, targetPoints: 0, minBet: 10, maxBet: 0, useTeams: false,
    });
    const { table } = await gm.getTable(tableId);
    const nfc = await gm.issueJoinToken(tableId, 'nfc');

    const luca = d.mk();
    await luca.signIn('luca', DEMO_PASSWORD);
    await expect(luca.joinWithToken(table.code, 'sbagliato', 'nfc_table')).rejects.toThrow(/non valido/);
    expect(await luca.joinWithToken(table.code, nfc.token, 'nfc_table')).toBe(tableId);

    await expect(gm.startTable(tableId)).rejects.toThrow(/almeno 3/);

    // Giulia entra tramite il suo pass letto dal telefono del master
    const giulia = d.mk();
    await giulia.signIn('giulia', DEMO_PASSWORD);
    const pass = await giulia.getMyPassToken();
    const added = await gm.addPlayerByPass(tableId, pass);
    expect(added.username).toBe('giulia');
    await gm.startTable(tableId);

    const lucaId = (await luca.currentUser())!.id;
    const giuliaId = (await giulia.currentUser())!.id;
    const before = (await luca.currentUser())!.chips;
    await gm.recordChipsRound(tableId, [
      { userId: lucaId, bet: 100, outcomeKey: 'blackjack' },
      { userId: giuliaId, bet: 40, outcomeKey: 'lose' },
    ]);
    expect((await luca.currentUser())!.chips).toBe(before + 150);
    await expect(gm.recordChipsRound(tableId, [{ userId: lucaId, bet: 5, outcomeKey: 'win' }])).rejects.toThrow(/minima/);
    await expect(
      gm.recordChipsRound(tableId, [{ userId: giuliaId, bet: 100000, outcomeKey: 'lose' }]),
    ).rejects.toThrow(/abbastanza/);

    await gm.undoLastRound(tableId);
    expect((await luca.currentUser())!.chips).toBe(before);

    await gm.recordChipsRound(tableId, [{ userId: lucaId, bet: 50, outcomeKey: 'win' }]);
    await gm.closeTable(tableId);
    const state = await gm.getTable(tableId);
    expect(state.table.status).toBe('closed');
    expect(state.participants.find((p) => p.userId === lucaId)!.placement).toBe(1);
    expect(await luca.myActiveTableId()).toBeNull();
  });

  it('modalità a chiusura: le fiches si applicano solo alla fine', async () => {
    const gm = d.mk();
    await gm.signIn('mazziere', DEMO_PASSWORD);
    const tableId = await gm.createTable({
      gameId: 'blackjack', name: '', settlement: 'on_close', masterPlays: false,
      startingLives: 0, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false,
    });
    const players = ['luca', 'marco'];
    for (const u of players) {
      const dev = d.mk();
      await dev.signIn(u, DEMO_PASSWORD);
      await gm.addPlayerByPass(tableId, await dev.getMyPassToken());
    }
    await gm.startTable(tableId);
    const marco = (await gm.findProfileByUsername('marco'))!;
    const start = marco.chips;
    await gm.recordChipsRound(tableId, [{ userId: marco.id, bet: 100, outcomeKey: 'lose' }]);
    expect((await gm.getProfile(marco.id)).chips).toBe(start);
    const st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === marco.id)!.pendingDelta).toBe(-100);
    await gm.closeTable(tableId);
    expect((await gm.getProfile(marco.id)).chips).toBe(start - 100);
  });

  it('trentuno: vite, eliminazioni, un tavolo alla volta', async () => {
    const gm = d.mk();
    await gm.signIn('mazziere', DEMO_PASSWORD);
    const tableId = await gm.createTable({
      gameId: 'trentuno', name: '', settlement: 'live', masterPlays: true,
      startingLives: 2, targetPoints: 0, minBet: 0, maxBet: 0, useTeams: false,
    });
    const { table } = await gm.getTable(tableId);
    const qr = await gm.issueJoinToken(tableId, 'qr');
    expect(qr.token).toMatch(/^\d{6}$/);
    const ids: string[] = [];
    for (const u of ['luca', 'giulia']) {
      const dev = d.mk();
      await dev.signIn(u, DEMO_PASSWORD);
      await dev.joinWithToken(table.code, qr.token, 'qr');
      ids.push((await dev.currentUser())!.id);
    }
    // un giocatore non può sedersi a due tavoli
    const admin = d.mk();
    await admin.signIn('admin', DEMO_PASSWORD);
    const t2 = await admin.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true,
      startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: false,
    });
    const tok2 = await admin.issueJoinToken(t2, 'nfc');
    const luca = d.mk();
    await luca.signIn('luca', DEMO_PASSWORD);
    await expect(luca.joinWithToken((await admin.getTable(t2)).table.code, tok2.token, 'nfc_table')).rejects.toThrow(/già seduto/);

    await gm.startTable(tableId);
    await gm.recordLivesRound(tableId, [{ userId: ids[0], delta: -2 }]);
    let st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids[0])!.eliminationOrder).toBe(1);
    await gm.undoLastRound(tableId);
    st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids[0])!.lives).toBe(2);
    await gm.recordLivesRound(tableId, [{ userId: ids[0], delta: -2 }]);
    const gmId = (await gm.currentUser())!.id;
    await gm.recordLivesRound(tableId, [{ userId: gmId, delta: -2 }]);
    await gm.closeTable(tableId);
    st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids[1])!.placement).toBe(1);
    expect(st.participants.find((p) => p.userId === gmId)!.placement).toBe(2);
  });

  it('i token NFC scadono e il bonus giornaliero si ritira una volta al giorno', async () => {
    const gm = d.mk();
    await gm.signIn('mazziere', DEMO_PASSWORD);
    const tableId = await gm.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true,
      startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: true,
    });
    const tok = await gm.issueJoinToken(tableId, 'nfc');
    const code = (await gm.getTable(tableId)).table.code;
    d.tick(10 * 60 * 1000);
    const marco = d.mk();
    await marco.signIn('marco', DEMO_PASSWORD);
    await expect(marco.joinWithToken(code, tok.token, 'nfc_table')).rejects.toThrow(/scaduto/);
    const stat = await gm.issueJoinToken(tableId, 'static');
    expect(stat.expiresAt).toBeNull();
    await marco.joinWithToken(code, stat.token, 'nfc_table');

    const r = await marco.claimDailyBonus();
    expect(r.amount).toBeGreaterThan(0);
    await expect(marco.claimDailyBonus()).rejects.toThrow(/già ritirato/);
    d.tick(24 * 3600 * 1000);
    const r2 = await marco.claimDailyBonus();
    expect(r2.streak).toBe(2);
  });

  it('scopa a coppie: i punti vanno a tutta la squadra', async () => {
    const gm = d.mk();
    await gm.signIn('mazziere', DEMO_PASSWORD);
    const tableId = await gm.createTable({
      gameId: 'scopa', name: '', settlement: 'live', masterPlays: true,
      startingLives: 0, targetPoints: 11, minBet: 0, maxBet: 0, useTeams: true,
    });
    const ids: string[] = [(await gm.currentUser())!.id];
    for (const u of ['luca', 'giulia', 'marco']) {
      const dev = d.mk();
      await dev.signIn(u, DEMO_PASSWORD);
      await gm.addPlayerByPass(tableId, await dev.getMyPassToken());
      ids.push((await dev.currentUser())!.id);
    }
    await expect(gm.startTable(tableId)).rejects.toThrow(/squadra/);
    await gm.setTeam(tableId, ids[0], 'A');
    await gm.setTeam(tableId, ids[1], 'A');
    await gm.setTeam(tableId, ids[2], 'B');
    await gm.setTeam(tableId, ids[3], 'B');
    await gm.startTable(tableId);
    await gm.recordPointsRound(tableId, [{ team: 'A', points: 7 }, { team: 'B', points: 4 }]);
    const st = await gm.getTable(tableId);
    expect(st.participants.find((p) => p.userId === ids[1])!.score).toBe(7);
    expect(st.participants.find((p) => p.userId === ids[3])!.score).toBe(4);
  });

  it('admin: rettifiche fiches tracciate e niente auto-sospensione', async () => {
    const admin = d.mk();
    await admin.signIn('admin', DEMO_PASSWORD);
    const me = (await admin.currentUser())!;
    const marco = (await admin.findProfileByUsername('marco'))!;
    await admin.adminAdjustChips(marco.id, 500, 'Premio torneo');
    expect((await admin.getProfile(marco.id)).chips).toBe(marco.chips + 500);
    await expect(admin.adminAdjustChips(marco.id, -1_000_000, 'errore')).rejects.toThrow(/abbastanza/);
    await expect(admin.adminSetBanned(me.id, true)).rejects.toThrow(/te stesso/);
    const log = await admin.adminAudit();
    expect(log[0].action).toBe('adjust_chips');
    const luca = d.mk();
    await luca.signIn('luca', DEMO_PASSWORD);
    await expect(luca.adminOverview()).rejects.toThrow(/staff/);
  });
});
