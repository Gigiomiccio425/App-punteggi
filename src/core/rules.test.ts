import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMES } from './games';
import {
  DEFAULT_SETTINGS,
  chipDelta,
  computeDailyBonus,
  computePlacements,
  dayInTimezone,
  isWin,
  levelFor,
  previousDay,
  validateBet,
  validateStart,
} from './rules';
import type { Participant, TableRow } from './types';

const game = (id: string) => DEFAULT_GAMES.find((g) => g.id === id)!;

function part(userId: string, over: Partial<Participant> = {}): Participant {
  return {
    tableId: 't',
    userId,
    isMaster: false,
    isPlaying: true,
    joinedVia: 'nfc_table',
    lives: 3,
    score: 0,
    team: null,
    pendingDelta: 0,
    netDelta: 0,
    eliminatedAt: null,
    eliminationOrder: null,
    placement: null,
    joinedAt: '2026-01-01T00:00:00Z',
    leftAt: null,
    profile: { id: userId, username: userId, displayName: userId, avatar: '', color: '', role: 'player', chips: 100 },
    ...over,
  };
}

const table: TableRow = {
  id: 't', code: 'ABCDE', name: 'T', gameId: 'blackjack', masterId: 'm', status: 'lobby', settlement: 'live',
  masterPlays: false, startingLives: 3, targetPoints: 0, minBet: 10, maxBet: 200, useTeams: false, roundCount: 0,
  createdAt: '', startedAt: null, closedAt: null,
};

describe('chipDelta', () => {
  it('paga il blackjack 3:2 arrotondando a favore del banco', () => {
    const bj = game('blackjack').outcomes.find((o) => o.key === 'blackjack')!;
    expect(chipDelta(25, bj)).toBe(37);
    const surrender = game('blackjack').outcomes.find((o) => o.key === 'surrender')!;
    expect(chipDelta(25, surrender)).toBe(-13);
    expect(chipDelta(100, { key: 'x', label: '', mult: -2 })).toBe(-200);
  });
});

describe('validateBet', () => {
  it('rispetta i limiti del tavolo', () => {
    expect(validateBet(table, 5)).toMatch(/minima/);
    expect(validateBet(table, 500)).toMatch(/massima/);
    expect(validateBet(table, 2.5)).toMatch(/intero/);
    expect(validateBet(table, 50)).toBeNull();
  });
});

describe('validateStart', () => {
  it('richiede 3 partecipanti master incluso per blackjack e trentuno', () => {
    const master = part('m', { isMaster: true, isPlaying: false });
    expect(validateStart(game('blackjack'), table, [master, part('a')])).toMatch(/almeno 3/);
    expect(validateStart(game('blackjack'), table, [master, part('a'), part('b')])).toBeNull();
    const t31 = { ...table, gameId: 'trentuno' };
    expect(validateStart(game('trentuno'), t31, [part('m', { isMaster: true }), part('a')])).toMatch(/almeno 3/);
  });
  it('per la scopa bastano 2', () => {
    const t = { ...table, gameId: 'scopa' };
    expect(validateStart(game('scopa'), t, [part('m', { isMaster: true }), part('a')])).toBeNull();
  });
  it('a squadre tutti devono avere una squadra', () => {
    const t = { ...table, gameId: 'scopa', useTeams: true };
    const ps = [part('m', { isMaster: true, team: 'A' }), part('a', { team: 'B' }), part('b'), part('c', { team: 'B' })];
    expect(validateStart(game('scopa'), t, ps)).toMatch(/squadra/);
    ps[2].team = 'A';
    expect(validateStart(game('scopa'), t, ps)).toBeNull();
  });
});

describe('computePlacements', () => {
  it('vite: vince chi resta, poi chi è stato eliminato più tardi; pari merito condiviso', () => {
    const ps = [
      part('a', { lives: 0, eliminationOrder: 2 }),
      part('b', { lives: 2 }),
      part('c', { lives: 0, eliminationOrder: 5 }),
      part('d', { lives: 0, eliminationOrder: 5 }),
      part('m', { isMaster: true, isPlaying: false }),
    ];
    const r = computePlacements('lives', ps);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
    expect(r.get('d')).toBe(2);
    expect(r.get('a')).toBe(4);
    expect(r.has('m')).toBe(false);
  });
  it('fiches: ordina per guadagno netto', () => {
    const r = computePlacements('chips', [part('a', { netDelta: -50 }), part('b', { netDelta: 120 })]);
    expect(r.get('b')).toBe(1);
    expect(isWin('chips', 1, 120)).toBe(true);
    expect(isWin('chips', 1, 0)).toBe(false);
  });
});

describe('bonus giornaliero', () => {
  it('calcola la serie e il moltiplicatore della ruota', () => {
    const s = { ...DEFAULT_SETTINGS, wheel: [1, 2], dailyBonusBase: 100, streakBonusPct: 10, maxStreak: 3 };
    expect(computeDailyBonus(s, '2026-11-01', 1, '2026-11-01', 0)).toBeNull();
    expect(computeDailyBonus(s, null, 0, '2026-11-01', 0)).toEqual({ amount: 100, multiplier: 1, segment: 0, streak: 1 });
    expect(computeDailyBonus(s, '2026-10-31', 1, '2026-11-01', 0.99)).toEqual({ amount: 220, multiplier: 2, segment: 1, streak: 2 });
    expect(computeDailyBonus(s, '2026-10-31', 3, '2026-11-01', 0)!.streak).toBe(3);
    expect(computeDailyBonus(s, '2026-10-20', 3, '2026-11-01', 0)!.streak).toBe(1);
  });
  it('usa il fuso orario configurato', () => {
    expect(dayInTimezone(new Date('2026-11-01T23:30:00Z'), 'Europe/Rome')).toBe('2026-11-02');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
  });
});

describe('livelli', () => {
  it('cresce con partite e vittorie', () => {
    expect(levelFor({ gamesPlayed: 0, wins: 0 }).title).toBe('Matricola');
    expect(levelFor({ gamesPlayed: 10, wins: 3 }).title).toBe('Giocatore di sala');
  });
});
