import { useState } from 'react';
import { useApp, useMe } from '../../app/context';
import { activeParticipants } from '../../core/rules';
import type { Participant, Round, TableState, Team } from '../../core/types';
import { ago, signed } from '../../lib/format';
import { Avatar, Confirm, Hearts, Panel, PlayerLink } from '../../ui/kit';

const VIA_ICON: Record<string, string> = { nfc_table: '📲', nfc_pass: '🎫', qr: '🔳', code: '🔢', master: '🎩' };

export function ParticipantsPanel({ st, isMaster }: { st: TableState; isMaster: boolean }) {
  const { backend, fail } = useApp();
  const [kick, setKick] = useState<Participant | null>(null);
  const present = activeParticipants(st.participants);
  const { table, game } = st;
  return (
    <Panel
      title={`Al tavolo (${present.length}/${game.maxParticipants})`}
      tone={game.room === 'casino' ? 'felt' : 'neon'}
      actions={<span className="small muted">min. {game.minParticipants} per iniziare</span>}
    >
      <ul className="participants">
        {present.map((p) => (
          <li key={p.userId} className={`participant ${p.isMaster ? 'is-master' : ''}`}>
            <PlayerLink p={p.profile} />
            <span className="participant-tags">
              {p.isMaster && <span className="tag tag-gold">{p.isPlaying ? 'Master · gioca' : 'Banco'}</span>}
              <span className="tag" title="Modalità di ingresso">
                {VIA_ICON[p.joinedVia]}
              </span>
            </span>
            {table.useTeams && p.isPlaying && (
              <span className="team-switch">
                {(['A', 'B'] as Team[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`team-btn team-${t} ${p.team === t ? 'active' : ''}`}
                    disabled={!isMaster || table.status !== 'lobby'}
                    onClick={() => backend.setTeam(table.id, p.userId, p.team === t ? null : t).catch(fail)}
                  >
                    {t}
                  </button>
                ))}
              </span>
            )}
            {isMaster && !p.isMaster && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setKick(p)} aria-label={`Allontana ${p.profile.displayName}`}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <Confirm
        open={!!kick}
        title="Allontanare il giocatore?"
        danger
        confirmLabel="Allontana"
        onClose={() => setKick(null)}
        onConfirm={async () => {
          if (kick) await backend.kick(table.id, kick.userId).catch(fail);
        }}
      >
        <p>
          {kick?.profile.displayName} lascerà il tavolo.
          {table.status === 'playing' && game.mode === 'chips' && table.settlement === 'on_close' && ' Le sue fiches maturate verranno saldate subito.'}
          {table.status === 'playing' && game.mode === 'lives' && ' Verrà considerato eliminato.'}
        </p>
      </Confirm>
    </Panel>
  );
}

function effectText(st: TableState, r: Round) {
  const name = (id: string) => st.participants.find((p) => p.userId === id)?.profile.displayName ?? '?';
  const outcome = (k?: string) => st.game.outcomes.find((o) => o.key === k)?.label ?? (k === 'custom' ? 'importo libero' : k);
  return r.effects.map((e) => {
    if (e.chips !== undefined) return `${name(e.userId)} ${signed(e.chips)}${e.outcome ? ` (${outcome(e.outcome)})` : ''}`;
    if (e.lives !== undefined) return `${name(e.userId)} ${e.lives > 0 ? `+${e.lives}` : e.lives} ❤${e.eliminated ? ' · eliminato!' : ''}`;
    if (e.points !== undefined) return `${name(e.userId)} ${signed(e.points)} pt`;
    return name(e.userId);
  });
}

export function RoundFeed({ st }: { st: TableState }) {
  if (!st.rounds.length) return null;
  return (
    <Panel title="Ultime mani" tone="dark" className="round-feed">
      <ol>
        {st.rounds.slice(0, 12).map((r) => (
          <li key={r.id} className={r.undone ? 'undone' : ''}>
            <span className="round-no">#{r.number}</span>
            <span className="round-text">{effectText(st, r).join(' · ')}</span>
            <span className="round-time">{r.undone ? 'annullata' : ago(r.createdAt)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** Vista del giocatore: in primo piano la propria situazione, poi quella degli altri. */
export function MySituation({ st }: { st: TableState }) {
  const me = useMe();
  const mine = st.participants.find((p) => p.userId === me.id && !p.leftAt);
  const { game, table } = st;
  if (!mine || !mine.isPlaying) return null;
  return (
    <section className={`my-situation room-${game.room}`}>
      <span className="my-label">La tua situazione</span>
      {game.mode === 'chips' && (
        <div className="my-chips">
          <div>
            <span className="muted small">Saldo</span>
            <span className="my-big">{(me.chips + mine.pendingDelta).toLocaleString('it-IT')}</span>
          </div>
          <div>
            <span className="muted small">A questo tavolo</span>
            <span className={`my-big ${mine.netDelta > 0 ? 'pos' : mine.netDelta < 0 ? 'neg' : ''}`}>{signed(mine.netDelta)}</span>
          </div>
          {table.settlement === 'on_close' && <p className="small muted">Le fiches si aggiornano alla chiusura del tavolo.</p>}
        </div>
      )}
      {game.mode === 'lives' && (
        <div className="my-lives">
          {mine.lives > 0 ? <Hearts lives={mine.lives} max={table.startingLives} size={40} /> : <span className="game-over neon neon-pink">GAME OVER</span>}
          <span className="arcade-num">{mine.lives} {mine.lives === 1 ? 'vita' : 'vite'}</span>
        </div>
      )}
      {game.mode === 'points' && (
        <div className="my-points">
          <span className="led">{String(mine.score).padStart(2, '0')}</span>
          <div className="progress">
            <span style={{ width: `${Math.min(100, (mine.score / Math.max(1, table.targetPoints)) * 100)}%` }} />
          </div>
          <span className="small muted">
            obiettivo {table.targetPoints}
            {table.useTeams && mine.team ? ` · squadra ${mine.team}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}

export function Scoreboard({ st }: { st: TableState }) {
  const me = useMe();
  const { game, table } = st;
  const players = st.participants.filter((p) => p.isPlaying);
  const sorted = [...players].sort((a, b) =>
    game.mode === 'chips' ? b.netDelta - a.netDelta : game.mode === 'points' ? b.score - a.score : b.lives - a.lives,
  );
  if (table.useTeams) {
    const teams = (['A', 'B'] as Team[]).map((t) => ({
      team: t,
      members: players.filter((p) => p.team === t),
      score: players.find((p) => p.team === t)?.score ?? 0,
    }));
    return (
      <Panel title="Tabellone" tone="neon" className="scoreboard">
        <div className="teams-board">
          {teams.map((t) => (
            <div key={t.team} className={`team-col team-${t.team}`}>
              <span className="team-name">Squadra {t.team}</span>
              <span className="led">{String(t.score).padStart(2, '0')}</span>
              <span className="team-members">
                {t.members.map((m) => (
                  <Avatar key={m.userId} p={m.profile} size={28} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Tabellone" tone={game.room === 'casino' ? 'felt' : 'neon'} className="scoreboard">
      <ul className="board">
        {sorted.map((p) => (
          <li key={p.userId} className={`${p.userId === me.id ? 'me' : ''} ${p.leftAt ? 'left' : ''} ${game.mode === 'lives' && p.lives === 0 ? 'out' : ''}`}>
            <Avatar p={p.profile} size={30} />
            <span className="board-name">{p.profile.displayName}</span>
            {game.mode === 'chips' && <span className={`board-val ${p.netDelta > 0 ? 'pos' : p.netDelta < 0 ? 'neg' : ''}`}>{signed(p.netDelta)}</span>}
            {game.mode === 'lives' && <Hearts lives={p.lives} max={table.startingLives} size={16} />}
            {game.mode === 'points' && <span className="board-val arcade-num">{p.score}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
