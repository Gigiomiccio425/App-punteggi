import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { canOpenTables } from '../core/rules';
import type { GameDef, Settlement } from '../core/types';
import { MODE_LABEL } from '../lib/format';
import { sfx } from '../lib/sfx';
import { Divider, Hearts, NeonTitle, Panel, Segmented, Stepper, Toggle } from '../ui/kit';

export function CreateTable() {
  const me = useMe();
  const { games, backend, fail, toast } = useApp();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameDef | null>(null);
  const [name, setName] = useState('');
  const [settlement, setSettlement] = useState<Settlement>('live');
  const [lives, setLives] = useState(3);
  const [target, setTarget] = useState(11);
  const [minBet, setMinBet] = useState(5);
  const [maxBet, setMaxBet] = useState(500);
  const [masterPlays, setMasterPlays] = useState(true);
  const [useTeams, setUseTeams] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canOpenTables(me.role)) return <Navigate to="/profilo#gm" replace />;

  const pick = (g: GameDef) => {
    sfx.chip();
    setGame(g);
    setLives(g.defaultLives || 3);
    setTarget(g.targetPoints || 11);
    setMasterPlays(g.masterPlaysDefault);
    setUseTeams(false);
    setName('');
  };

  const open = async () => {
    if (!game) return;
    setBusy(true);
    try {
      const id = await backend.createTable({
        gameId: game.id,
        name,
        settlement,
        masterPlays,
        startingLives: lives,
        targetPoints: target,
        minBet,
        maxBet,
        useTeams,
      });
      sfx.win();
      toast('Tavolo aperto! Fai entrare i giocatori con l’NFC.', 'success');
      navigate(`/tavolo/${id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const enabled = games.filter((g) => g.enabled);
  const rooms: { id: 'casino' | 'arcade'; title: string }[] = [
    { id: 'casino', title: 'Casinò · si gioca a fiches' },
    { id: 'arcade', title: 'Sala giochi · vite e punti' },
  ];

  return (
    <div className="stack">
      <h1 className="screen-title">Apri un tavolo</h1>
      {rooms.map((r) => (
        <section key={r.id}>
          <NeonTitle as="h2" color={r.id === 'casino' ? 'gold' : 'cyan'} className="room-title">
            {r.title}
          </NeonTitle>
          <div className="game-grid">
            {enabled
              .filter((g) => g.room === r.id)
              .map((g) => (
                <button key={g.id} type="button" className={`game-tile room-${g.room} ${game?.id === g.id ? 'selected' : ''}`} onClick={() => pick(g)}>
                  <span className="game-tile-icon">{g.icon}</span>
                  <span className="game-tile-name">{g.name}</span>
                  <span className="game-tile-meta">
                    {MODE_LABEL[g.mode]} · {g.minParticipants}-{g.maxParticipants}
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}

      {game && (
        <Panel title={`${game.icon} ${game.name}`} tone={game.room === 'casino' ? 'felt' : 'neon'} className="pop-in">
          <p className="small muted">{game.description}</p>
          <p className="small">
            Per iniziare servono almeno <strong>{game.minParticipants}</strong> partecipanti (te compreso), massimo {game.maxParticipants}.
          </p>
          <label className="field">
            <span>Nome del tavolo</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${game.name} · ${me.displayName}`} maxLength={40} />
          </label>

          {game.mode === 'chips' && (
            <>
              <div className="field">
                <span>Quando si aggiornano le fiches?</span>
                <Segmented
                  value={settlement}
                  onChange={setSettlement}
                  options={[
                    { value: 'live', label: 'A ogni mano' },
                    { value: 'on_close', label: 'Alla chiusura' },
                  ]}
                />
                <small className="muted">
                  {settlement === 'live'
                    ? 'Il saldo dei giocatori cambia subito dopo ogni mano registrata.'
                    : 'Le vincite si accumulano al tavolo e il saldo si aggiorna quando chiudi.'}
                </small>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Puntata minima</span>
                  <input type="number" min={0} value={minBet} onChange={(e) => setMinBet(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>Puntata massima (0 = libera)</span>
                  <input type="number" min={0} value={maxBet} onChange={(e) => setMaxBet(Number(e.target.value))} />
                </label>
              </div>
              <p className="small muted">Tu fai da banco/croupier: non punti fiches a questo tavolo.</p>
            </>
          )}

          {game.mode === 'lives' && (
            <div className="field">
              <span>Vite per giocatore</span>
              <div className="row">
                <Stepper value={lives} onChange={setLives} min={1} max={20} label="Vite" />
                <Hearts lives={lives} max={lives} />
              </div>
            </div>
          )}

          {game.mode === 'points' && (
            <div className="field">
              <span>Punteggio da raggiungere</span>
              <Stepper value={target} onChange={setTarget} min={1} max={10000} step={target >= 100 ? 50 : 1} label="Obiettivo" />
            </div>
          )}

          {game.mode !== 'chips' && <Toggle checked={masterPlays} onChange={setMasterPlays} label="Gioco anche io" hint="Il master tiene la tabella e partecipa alla partita" />}
          {game.allowTeams && <Toggle checked={useTeams} onChange={setUseTeams} label="Gioco a coppie (squadre A e B)" hint="I punti di ogni mano vanno a tutta la squadra" />}

          <Divider />
          <button type="button" className="btn btn-gold btn-big btn-shine" onClick={open} disabled={busy}>
            Apri il tavolo
          </button>
        </Panel>
      )}
    </div>
  );
}
