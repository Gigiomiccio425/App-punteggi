import { useState } from 'react';
import { useApp } from '../../app/context';
import { CHIP_DENOMINATIONS, chipDelta } from '../../core/rules';
import type { ChipsEntry, Participant, TableState, Team } from '../../core/types';
import { fmt, signed } from '../../lib/format';
import { sfx } from '../../lib/sfx';
import { Avatar, Chip, Hearts, Panel } from '../../ui/kit';

interface BetState {
  bet: number;
  outcome: string | null;
  custom: string;
  useCustom: boolean;
}

function playing(st: TableState): Participant[] {
  return st.participants.filter((p) => p.isPlaying && !p.leftAt);
}

// ---------------------------------------------------------------- fiches

export function ChipsConsole({ st, onRecorded }: { st: TableState; onRecorded: (myDelta: Map<string, number>) => void }) {
  const { backend, fail, toast } = useApp();
  const { game, table } = st;
  const players = playing(st);
  const onlyCustom = game.outcomes.length === 0;
  const [bets, setBets] = useState<Record<string, BetState>>({});
  const [busy, setBusy] = useState(false);
  const get = (id: string): BetState => bets[id] ?? { bet: 0, outcome: null, custom: '', useCustom: onlyCustom };
  const set = (id: string, patch: Partial<BetState>) => setBets((b) => ({ ...b, [id]: { ...get(id), ...patch } }));

  const deltaOf = (id: string): number | null => {
    const b = get(id);
    if (b.useCustom) {
      const n = Number(b.custom.replace(',', '.'));
      return b.custom.trim() && Number.isInteger(n) ? n : null;
    }
    const o = game.outcomes.find((x) => x.key === b.outcome);
    return o && b.bet > 0 ? chipDelta(b.bet, o) : null;
  };
  const ready = players.filter((p) => deltaOf(p.userId) !== null);
  const houseNet = -ready.reduce((s, p) => s + (deltaOf(p.userId) ?? 0), 0);

  const record = async () => {
    const entries: ChipsEntry[] = ready.map((p) => {
      const b = get(p.userId);
      return b.useCustom
        ? { userId: p.userId, bet: b.bet, customDelta: deltaOf(p.userId)! }
        : { userId: p.userId, bet: b.bet, outcomeKey: b.outcome! };
    });
    if (onlyCustom && houseNet !== 0) {
      toast(`Attenzione: la somma della mano non è zero (${signed(-houseNet)}).`, 'info');
    }
    setBusy(true);
    try {
      await backend.recordChipsRound(table.id, entries);
      const deltas = new Map(ready.map((p) => [p.userId, deltaOf(p.userId)!]));
      onRecorded(deltas);
      setBets((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { ...v, outcome: null, custom: '' }])));
      sfx.coin();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Console del banco" tone="felt" className="console console-chips">
      {players.map((p) => {
        const b = get(p.userId);
        const d = deltaOf(p.userId);
        const available = p.profile.chips + (table.settlement === 'on_close' ? p.pendingDelta : 0);
        return (
          <div key={p.userId} className={`bet-row ${d !== null ? 'ready' : ''}`}>
            <div className="bet-row-head">
              <Avatar p={p.profile} size={32} />
              <span className="bet-name">{p.profile.displayName}</span>
              <span className="bet-avail" title="Fiches disponibili">
                {fmt(available)}
              </span>
              {d !== null && <span className={`bet-preview ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{signed(d)}</span>}
            </div>
            {!b.useCustom && (
              <div className="bet-row-sub">
                <span className="small muted">Puntata{table.minBet > 0 ? ` (min ${table.minBet})` : ''}</span>
                <span className="bet-stake">
                  <span className="bet-amount arcade-num">{fmt(b.bet)}</span>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => set(p.userId, { bet: 0 })} aria-label="Azzera puntata">
                    ⟲
                  </button>
                </span>
              </div>
            )}
            {!b.useCustom && (
              <>
                <div className="bet-chips">
                  {CHIP_DENOMINATIONS.filter((v) => !table.maxBet || v <= table.maxBet).map((v) => (
                    <Chip
                      key={v}
                      value={v}
                      size={38}
                      onClick={() => {
                        sfx.chip();
                        set(p.userId, { bet: b.bet + v });
                      }}
                      disabled={b.bet + v > available || (table.maxBet > 0 && b.bet + v > table.maxBet)}
                      title={`Aggiungi ${v}`}
                    />
                  ))}
                </div>
                <div className="outcomes">
                  {game.outcomes.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className={`outcome ${o.mult > 0 ? 'win' : o.mult < 0 ? 'lose' : 'push'} ${b.outcome === o.key ? 'active' : ''}`}
                      onClick={() => set(p.userId, { outcome: b.outcome === o.key ? null : o.key })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {(game.allowCustomDelta || onlyCustom) && (
              <div className="custom-delta">
                {!onlyCustom && (
                  <label className="mini-toggle">
                    <input type="checkbox" checked={b.useCustom} onChange={(e) => set(p.userId, { useCustom: e.target.checked })} /> importo libero
                  </label>
                )}
                {b.useCustom && (
                  <input
                    className="input-delta"
                    inputMode="numeric"
                    placeholder="es. 120 o -80"
                    value={b.custom}
                    onChange={(e) => set(p.userId, { custom: e.target.value.replace(/[^\d-]/g, '') })}
                    aria-label={`Risultato di ${p.profile.displayName}`}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="console-bar">
        <span className="small">
          Banco: <strong className={houseNet > 0 ? 'pos' : houseNet < 0 ? 'neg' : ''}>{signed(houseNet)}</strong>
        </span>
        <button type="button" className="btn btn-gold btn-shine" onClick={record} disabled={busy || !ready.length}>
          Registra mano ({ready.length})
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- vite

export function LivesConsole({ st }: { st: TableState }) {
  const { backend, fail } = useApp();
  const { table } = st;
  const players = playing(st);
  const [staged, setStaged] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const changes = Object.entries(staged).filter(([, d]) => d !== 0);
  const alive = players.filter((p) => p.lives > 0);

  const confirm = async () => {
    setBusy(true);
    try {
      await backend.recordLivesRound(table.id, changes.map(([userId, delta]) => ({ userId, delta })));
      const lost = changes.some(([, d]) => d < 0);
      if (lost) sfx.lose();
      else sfx.coin();
      setStaged({});
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Tabella delle vite" tone="neon" className="console console-lives">
      {alive.length <= 1 && players.length > 1 && (
        <div className="winner-banner pop-in">🏆 {alive[0] ? `${alive[0].profile.displayName} è l’ultimo in vita!` : 'Tutti eliminati!'} Chiudi il tavolo per assegnare la vittoria.</div>
      )}
      {players.map((p) => {
        const d = staged[p.userId] ?? 0;
        const preview = Math.max(0, p.lives + d);
        return (
          <div key={p.userId} className={`life-row ${p.lives === 0 ? 'out' : ''} ${d ? 'changed' : ''}`}>
            <Avatar p={p.profile} size={34} />
            <span className="life-main">
              <span className="life-name">{p.profile.displayName}</span>
              <Hearts lives={preview} max={table.startingLives} size={16} />
            </span>
            {d !== 0 && <span className={`life-delta ${d < 0 ? 'neg' : 'pos'}`}>{d > 0 ? `+${d}` : d}</span>}
            <span className="life-btns">
              <button type="button" className="btn btn-round btn-red" onClick={() => setStaged((s) => ({ ...s, [p.userId]: Math.max(-p.lives, d - 1) }))} disabled={preview === 0} aria-label={`Togli una vita a ${p.profile.displayName}`}>
                −
              </button>
              <button type="button" className="btn btn-round btn-felt" onClick={() => setStaged((s) => ({ ...s, [p.userId]: d + 1 }))} aria-label={`Ridai una vita a ${p.profile.displayName}`}>
                +
              </button>
            </span>
          </div>
        );
      })}
      <div className="console-bar">
        <span className="small">{alive.length} ancora in gioco</span>
        <button type="button" className="btn btn-neon" onClick={confirm} disabled={busy || !changes.length}>
          Conferma round
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- punti

export function PointsConsole({ st }: { st: TableState }) {
  const { backend, fail } = useApp();
  const { table } = st;
  const players = playing(st);
  const [staged, setStaged] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const rows: { key: string; label: string; score: number; avatars: Participant[] }[] = table.useTeams
    ? (['A', 'B'] as Team[]).map((t) => {
        const members = players.filter((p) => p.team === t);
        return { key: t, label: `Squadra ${t}`, score: members[0]?.score ?? 0, avatars: members };
      })
    : players.map((p) => ({ key: p.userId, label: p.profile.displayName, score: p.score, avatars: [p] }));
  const changes = Object.entries(staged).filter(([, d]) => d !== 0);
  const reached = rows.filter((r) => r.score >= table.targetPoints);

  const confirm = async () => {
    setBusy(true);
    try {
      await backend.recordPointsRound(
        table.id,
        changes.map(([key, points]) => (table.useTeams ? { team: key as Team, points } : { userId: key, points })),
      );
      sfx.coin();
      setStaged({});
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`Segnapunti · si gioca a ${table.targetPoints}`} tone="neon" className="console console-points">
      {reached.length > 0 && <div className="winner-banner pop-in">🏆 {reached.map((r) => r.label).join(' e ')} ha raggiunto {table.targetPoints}! Chiudi il tavolo per assegnare la vittoria.</div>}
      {rows.map((r) => {
        const d = staged[r.key] ?? 0;
        return (
          <div key={r.key} className={`points-row ${d ? 'changed' : ''}`}>
            <span className="points-who">
              {r.avatars.map((a) => (
                <Avatar key={a.userId} p={a.profile} size={30} />
              ))}
              <span>{r.label}</span>
            </span>
            <span className="led small-led">{r.score + d}</span>
            {d !== 0 && <span className={`life-delta ${d < 0 ? 'neg' : 'pos'}`}>{signed(d)}</span>}
            <span className="points-btns">
              {[1, 2, 5].map((v) => (
                <button key={v} type="button" className="btn btn-small btn-felt" onClick={() => setStaged((s) => ({ ...s, [r.key]: d + v }))}>
                  +{v}
                </button>
              ))}
              {table.targetPoints >= 100 && (
                <button type="button" className="btn btn-small btn-felt" onClick={() => setStaged((s) => ({ ...s, [r.key]: d + 100 }))}>
                  +100
                </button>
              )}
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setStaged((s) => ({ ...s, [r.key]: d - 1 }))}>
                −1
              </button>
            </span>
          </div>
        );
      })}
      <div className="console-bar">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setStaged({})} disabled={!changes.length}>
          Azzera
        </button>
        <button type="button" className="btn btn-neon" onClick={confirm} disabled={busy || !changes.length}>
          Conferma punti
        </button>
      </div>
    </Panel>
  );
}
