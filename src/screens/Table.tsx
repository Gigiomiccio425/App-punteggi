import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { useTable } from '../app/hooks';
import { activeParticipants, validateStart } from '../core/rules';
import type { Participant, TableState } from '../core/types';
import { errMsg, MODE_LABEL, signed } from '../lib/format';
import { sfx } from '../lib/sfx';
import { Celebration, FloatingDelta } from '../ui/effects';
import { Avatar, Confirm, Empty, Hearts, NeonTitle, Panel, Spinner, StatusPill } from '../ui/kit';
import { JoinManager } from './table/JoinManager';
import { ChipsConsole, LivesConsole, PointsConsole } from './table/consoles';
import { MySituation, ParticipantsPanel, RoundFeed, Scoreboard } from './table/parts';

function Results({ st }: { st: TableState }) {
  const me = useMe();
  const { game } = st;
  const ranked = st.participants.filter((p) => p.isPlaying && p.placement !== null).sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean) as Participant[];
  const value = (p: Participant) =>
    game.mode === 'chips' ? signed(p.netDelta) : game.mode === 'points' ? `${p.score} pt` : p.lives > 0 ? `${p.lives} ❤` : 'eliminato';
  const iWon = ranked.some((p) => p.userId === me.id && p.placement === 1 && (game.mode !== 'chips' || p.netDelta > 0));
  return (
    <div className="stack">
      <Celebration burst={iWon ? 1 : 0} kind={game.mode === 'chips' ? 'chips' : 'confetti'} count={80} />
      <NeonTitle color="gold" className="center">
        {st.table.status === 'cancelled' ? 'Tavolo annullato' : iWon ? 'Hai vinto!' : 'Partita conclusa'}
      </NeonTitle>
      {st.table.status === 'closed' && podium.length > 0 && (
        <div className="podium">
          {podium.map((p) => (
            <div key={p.userId} className={`podium-step place-${p.placement}`}>
              <Avatar p={p.profile} size={p.placement === 1 ? 64 : 48} />
              <span className="podium-name">{p.profile.displayName}</span>
              <span className="podium-val">{value(p)}</span>
              <span className="podium-block">{p.placement}</span>
            </div>
          ))}
        </div>
      )}
      {st.table.status === 'closed' && (
        <Panel title="Classifica finale" tone="dark">
          <ol className="final-list">
            {ranked.map((p) => (
              <li key={p.userId} className={p.userId === me.id ? 'me' : ''}>
                <span className="final-pos">{p.placement}°</span>
                <Avatar p={p.profile} size={28} />
                <Link to={`/giocatore/${p.profile.username}`}>{p.profile.displayName}</Link>
                <span className={`final-val ${game.mode === 'chips' ? (p.netDelta > 0 ? 'pos' : p.netDelta < 0 ? 'neg' : '') : ''}`}>{value(p)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <Link to="/" className="btn btn-gold btn-big">
        Torna alla sala
      </Link>
    </div>
  );
}

export function TableScreen() {
  const { id } = useParams();
  const me = useMe();
  const { backend, fail, toast, refreshMe } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: st, error, loading } = useTable(id);
  const [confirm, setConfirm] = useState<'close' | 'cancel' | 'leave' | null>(null);
  const [burst, setBurst] = useState(location.state?.joined ? 1 : 0);
  const [deltaTrigger, setDeltaTrigger] = useState(0);
  const [lastDelta, setLastDelta] = useState(0);
  const prevMine = useRef<Participant | null>(null);

  const mine = st?.participants.find((p) => p.userId === me.id && !p.leftAt) ?? null;

  // feedback quando cambia la mia situazione (mano registrata dal master)
  useEffect(() => {
    const prev = prevMine.current;
    prevMine.current = mine;
    if (!prev || !mine || !st) return;
    if (st.game.mode === 'chips' && mine.netDelta !== prev.netDelta) {
      const d = mine.netDelta - prev.netDelta;
      setLastDelta(d);
      setDeltaTrigger((t) => t + 1);
      if (d > 0) {
        sfx.win();
        if (d >= 100) setBurst((b) => b + 1);
      } else sfx.lose();
      void refreshMe();
    }
    if (st.game.mode === 'lives' && mine.lives < prev.lives) {
      sfx.lose();
      if (mine.lives === 0) toast('Hai perso tutte le vite: GAME OVER', 'info');
    }
  }, [mine, st, refreshMe, toast]);

  if (loading && !st) return <Spinner />;
  if (error || !st) return <Empty icon="⚠️">{error ? errMsg(error) : 'Tavolo non trovato.'}</Empty>;

  const { table, game } = st;
  const isMaster = table.masterId === me.id || me.role === 'staff';
  const isOwnMaster = table.masterId === me.id;
  const startError = validateStart(game, table, st.participants);
  const present = activeParticipants(st.participants).length;
  const hasRounds = st.rounds.some((r) => !r.undone);

  const act = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (e) {
      fail(e);
    }
  };

  const header = (
    <header className={`table-header room-${game.room}`}>
      <span className="table-header-icon">{game.icon}</span>
      <div className="table-header-text">
        <h1>{table.name}</h1>
        <p className="small">
          {game.name} · {MODE_LABEL[game.mode]}
          {game.mode === 'chips' && ` · ${table.settlement === 'live' ? 'aggiornamento a ogni mano' : 'saldo alla chiusura'}`}
          {game.mode === 'lives' && ` · ${table.startingLives} vite`}
          {game.mode === 'points' && ` · a ${table.targetPoints}${table.useTeams ? ' · a coppie' : ''}`}
        </p>
        <p className="small muted">
          <Avatar p={st.master} size={18} ring={false} /> Master: {st.master.displayName} · codice <strong>{table.code}</strong>
        </p>
      </div>
      <StatusPill status={table.status} />
    </header>
  );

  if (table.status === 'closed' || table.status === 'cancelled') {
    return (
      <div className={`table-screen room-${game.room} stack`}>
        {header}
        <Results st={st} />
      </div>
    );
  }

  return (
    <div className={`table-screen room-${game.room} stack`}>
      <Celebration burst={burst} kind={game.mode === 'chips' ? 'chips' : 'confetti'} count={40} />
      {header}

      {table.status === 'lobby' && isMaster && <JoinManager st={st} />}
      {table.status === 'playing' && isMaster && game.mode === 'chips' && game.allowLateJoin && (
        <details className="late-join">
          <summary>Fai sedere altri giocatori</summary>
          <JoinManager st={st} />
        </details>
      )}

      {table.status === 'lobby' && !isMaster && (
        <Panel tone="dark" className="waiting">
          <p className="center">
            {mine ? 'Sei seduto! In attesa che il master avvii la partita…' : 'Stai guardando questo tavolo. Per entrare avvicina il telefono al master.'}
          </p>
          {!mine && (
            <Link to="/entra" className="btn btn-gold">
              Entra con l’NFC
            </Link>
          )}
        </Panel>
      )}

      {table.status === 'playing' && (
        <div className="my-wrap">
          <MySituation st={st} />
          <FloatingDelta value={lastDelta} trigger={deltaTrigger} />
        </div>
      )}

      {table.status === 'playing' && isMaster && game.mode === 'chips' && <ChipsConsole st={st} onRecorded={() => undefined} />}
      {table.status === 'playing' && isMaster && game.mode === 'lives' && <LivesConsole st={st} />}
      {table.status === 'playing' && isMaster && game.mode === 'points' && <PointsConsole st={st} />}

      {table.status === 'playing' && !isMaster && <Scoreboard st={st} />}
      {table.status === 'playing' && isMaster && game.mode === 'lives' && (
        <Panel tone="dark" title="Vite in sala">
          <div className="lives-overview">
            {st.participants
              .filter((p) => p.isPlaying)
              .map((p) => (
                <span key={p.userId} className={`lives-chip ${p.lives === 0 ? 'out' : ''}`}>
                  <Avatar p={p.profile} size={22} ring={false} /> <Hearts lives={p.lives} max={table.startingLives} size={12} />
                </span>
              ))}
          </div>
        </Panel>
      )}

      <ParticipantsPanel st={st} isMaster={isMaster} />
      <RoundFeed st={st} />

      <div className="table-actions">
        {isMaster && table.status === 'lobby' && (
          <>
            <button type="button" className="btn btn-gold btn-big btn-shine" disabled={!!startError} onClick={() => act(() => backend.startTable(table.id), 'Si gioca! Buona fortuna a tutti.')}>
              Avvia la partita ({present}/{game.minParticipants})
            </button>
            {startError && <p className="small muted center">{startError}</p>}
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm('cancel')}>
              Annulla tavolo
            </button>
          </>
        )}
        {isMaster && table.status === 'playing' && (
          <>
            <button type="button" className="btn btn-ghost" disabled={!hasRounds} onClick={() => act(() => backend.undoLastRound(table.id), 'Ultima mano annullata')}>
              ↶ Annulla ultima mano
            </button>
            <button type="button" className="btn btn-red" onClick={() => setConfirm('close')}>
              Chiudi tavolo e assegna
            </button>
            {me.role === 'staff' && !isOwnMaster && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm('cancel')}>
                Annulla tavolo (staff)
              </button>
            )}
          </>
        )}
        {mine && !mine.isMaster && (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirm('leave')}>
            Lascia il tavolo
          </button>
        )}
      </div>

      <Confirm
        open={confirm === 'close'}
        title="Chiudere il tavolo?"
        confirmLabel="Chiudi e assegna"
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          act(async () => {
            await backend.closeTable(table.id);
            sfx.win();
            await refreshMe();
          }, 'Tavolo chiuso: statistiche aggiornate')
        }
      >
        <p>
          Verranno calcolati i piazzamenti
          {game.mode === 'chips' && table.settlement === 'on_close' ? ' e applicate le fiches maturate a ogni giocatore' : ''}. Non si potrà più modificare.
        </p>
      </Confirm>
      <Confirm
        open={confirm === 'cancel'}
        title="Annullare il tavolo?"
        danger
        confirmLabel="Annulla tavolo"
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => backend.cancelTable(table.id), 'Tavolo annullato').then(() => navigate('/'))}
      >
        <p>Nessun risultato verrà assegnato. Le mani già applicate (modalità a ogni mano) restano valide.</p>
      </Confirm>
      <Confirm
        open={confirm === 'leave'}
        title="Lasciare il tavolo?"
        danger
        confirmLabel="Lascia"
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => backend.leaveTable(table.id), 'Hai lasciato il tavolo').then(() => navigate('/'))}
      >
        <p>{table.status === 'playing' && game.mode === 'lives' ? 'Verrai considerato eliminato.' : 'Potrai rientrare solo se la partita non è ancora iniziata.'}</p>
      </Confirm>
    </div>
  );
}
