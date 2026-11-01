import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useApp, useMe } from '../../app/context';
import { useAsync } from '../../app/hooks';
import type { GameDef, GmRequestStatus, Outcome, Profile, Role, Settings, TableStatus } from '../../core/types';
import { dateTime, fmt, LEDGER_LABEL, MODE_LABEL, ROLE_LABEL, signed } from '../../lib/format';
import { Avatar, Confirm, Empty, Modal, Panel, RoleBadge, Segmented, Spinner, StatusPill, Toggle } from '../../ui/kit';
import { NfcWriteButton, useNfcCaps } from '../../ui/nfc-ui';
import { passUrl } from '../../nfc/payload';

export function Admin() {
  return (
    <div className="admin stack">
      <h1 className="screen-title">★ Pannello staff</h1>
      <nav className="admin-nav">
        <NavLink to="/admin" end>Panoramica</NavLink>
        <NavLink to="/admin/richieste">Richieste GM</NavLink>
        <NavLink to="/admin/utenti">Utenti</NavLink>
        <NavLink to="/admin/tavoli">Tavoli</NavLink>
        <NavLink to="/admin/giochi">Giochi</NavLink>
        <NavLink to="/admin/impostazioni">Impostazioni</NavLink>
        <NavLink to="/admin/registro">Registro</NavLink>
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="richieste" element={<GmRequests />} />
        <Route path="utenti" element={<Users />} />
        <Route path="tavoli" element={<Tables />} />
        <Route path="giochi" element={<GamesAdmin />} />
        <Route path="impostazioni" element={<SettingsAdmin />} />
        <Route path="registro" element={<Logs />} />
      </Routes>
    </div>
  );
}

function Overview() {
  const { backend } = useApp();
  const o = useAsync(() => backend.adminOverview(), [backend]);
  if (!o.data) return <Spinner />;
  const tiles = [
    { l: 'Utenti', v: fmt(o.data.users), to: '/admin/utenti', ico: '👥' },
    { l: 'Tavoli attivi', v: fmt(o.data.activeTables), to: '/admin/tavoli', ico: '🃏' },
    { l: 'Fiches in circolazione', v: fmt(o.data.chipsInCirculation), to: '/admin/registro', ico: '💰' },
    { l: 'Richieste GM in attesa', v: fmt(o.data.pendingGmRequests), to: '/admin/richieste', ico: '🎩', hot: o.data.pendingGmRequests > 0 },
    { l: 'Tavoli aperti oggi', v: fmt(o.data.tablesToday), to: '/admin/tavoli', ico: '📅' },
    { l: 'Utenti sospesi', v: fmt(o.data.bannedUsers), to: '/admin/utenti', ico: '⛔' },
  ];
  return (
    <div className="admin-tiles">
      {tiles.map((t) => (
        <Link key={t.l} to={t.to} className={`admin-tile ${t.hot ? 'hot' : ''}`}>
          <span className="admin-tile-ico">{t.ico}</span>
          <span className="admin-tile-v">{t.v}</span>
          <span className="admin-tile-l">{t.l}</span>
        </Link>
      ))}
    </div>
  );
}

function GmRequests() {
  const { backend, fail, toast } = useApp();
  const [status, setStatus] = useState<GmRequestStatus | 'all'>('pending');
  const list = useAsync(() => backend.adminListGmRequests(status === 'all' ? undefined : status), [backend, status]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = async (id: string, approve: boolean) => {
    try {
      await backend.adminReviewGmRequest(id, approve, notes[id] ?? '');
      toast(approve ? 'Game master autorizzato' : 'Richiesta rifiutata', 'success');
      await list.reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="stack">
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: 'In attesa' },
          { value: 'approved', label: 'Approvate' },
          { value: 'rejected', label: 'Rifiutate' },
          { value: 'all', label: 'Tutte' },
        ]}
      />
      {!list.data ? (
        <Spinner />
      ) : !list.data.length ? (
        <Empty icon="🎩">Nessuna richiesta.</Empty>
      ) : (
        list.data.map((r) => (
          <Panel key={r.id} tone="dark" className="gm-req">
            <div className="row">
              {r.profile && <Avatar p={r.profile} size={40} />}
              <div className="grow">
                <strong>{r.profile?.displayName}</strong> <span className="muted">@{r.profile?.username}</span>
                <p className="small muted">{dateTime(r.createdAt)}</p>
              </div>
              <span className={`pill pill-${r.status === 'pending' ? 'lobby' : r.status === 'approved' ? 'playing' : 'cancelled'}`}>{r.status === 'pending' ? 'In attesa' : r.status === 'approved' ? 'Approvata' : 'Rifiutata'}</span>
            </div>
            <blockquote>{r.motivation}</blockquote>
            {r.status === 'pending' ? (
              <>
                <input className="input" placeholder="Nota per il giocatore (facoltativa)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <div className="row-end">
                  <button type="button" className="btn btn-ghost" onClick={() => review(r.id, false)}>
                    Rifiuta
                  </button>
                  <button type="button" className="btn btn-gold" onClick={() => review(r.id, true)}>
                    Autorizza GM
                  </button>
                </div>
              </>
            ) : (
              r.reviewNote && <p className="small muted">Nota: {r.reviewNote}</p>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}

function Users() {
  const me = useMe();
  const { backend, fail, toast } = useApp();
  const [q, setQ] = useState('');
  const list = useAsync(() => backend.adminListUsers(q), [backend, q]);
  const [adjust, setAdjust] = useState<Profile | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [ban, setBan] = useState<Profile | null>(null);
  const caps = useNfcCaps();
  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      await list.reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="stack">
      <input className="input" placeholder="Cerca per username o nome…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data ? (
        <Spinner />
      ) : (
        <div className="admin-list">
          {list.data.map((u) => (
            <div key={u.id} className={`admin-user ${u.banned ? 'banned' : ''}`}>
              <Link to={`/giocatore/${u.username}`} className="row">
                <Avatar p={u} size={36} />
                <span>
                  <strong>{u.displayName}</strong> <RoleBadge role={u.role} />
                  <br />
                  <small className="muted">@{u.username}</small>
                </span>
              </Link>
              <span className="admin-user-chips">{fmt(u.chips)}</span>
              <span className="admin-user-actions">
              <select value={u.role} disabled={u.id === me.id} onChange={(e) => act(() => backend.adminSetRole(u.id, e.target.value as Role), 'Ruolo aggiornato')} aria-label="Ruolo">
                {(['player', 'game_master', 'staff'] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-small btn-felt" onClick={() => setAdjust(u)}>
                ± Fiches
              </button>
              {caps.data?.canWrite && (
                <NfcWriteButton
                  label="🎫 Pass"
                  done={`Braccialetto di ${u.displayName} scritto`}
                  tagLabel={`Braccialetto di @${u.username}`}
                  getUrl={async () => passUrl(await backend.adminUserPassToken(u.id))}
                  className="btn btn-small btn-ghost"
                />
              )}
              <button type="button" className={`btn btn-small ${u.banned ? 'btn-ghost' : 'btn-red'}`} disabled={u.id === me.id} onClick={() => setBan(u)}>
                {u.banned ? 'Riattiva' : 'Sospendi'}
              </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Rettifica fiches · ${adjust?.displayName ?? ''}`}>
        <p className="small muted">Saldo attuale: {fmt(adjust?.chips ?? 0)}. Usa un numero negativo per togliere. Ogni rettifica resta nel registro.</p>
        <label className="field">
          <span>Importo</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="es. 500 o -200" />
        </label>
        <label className="field">
          <span>Motivo</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Premio torneo, correzione errore…" />
        </label>
        <div className="row-end">
          <button
            type="button"
            className="btn btn-gold"
            onClick={() =>
              adjust &&
              act(async () => {
                await backend.adminAdjustChips(adjust.id, Number(amount), reason);
                setAdjust(null);
                setAmount('');
                setReason('');
              }, 'Fiches rettificate')
            }
          >
            Applica
          </button>
        </div>
      </Modal>
      <Confirm
        open={!!ban}
        title={ban?.banned ? 'Riattivare l’utente?' : 'Sospendere l’utente?'}
        danger={!ban?.banned}
        onClose={() => setBan(null)}
        onConfirm={() => (ban ? act(() => backend.adminSetBanned(ban.id, !ban.banned), ban.banned ? 'Utente riattivato' : 'Utente sospeso') : undefined)}
      >
        <p>{ban?.banned ? `${ban.displayName} potrà di nuovo giocare.` : `${ban?.displayName} non potrà più sedersi ai tavoli né ritirare bonus.`}</p>
      </Confirm>
    </div>
  );
}

function Tables() {
  const { backend, fail, toast } = useApp();
  const [filter, setFilter] = useState<'active' | 'closed' | 'all'>('active');
  const statuses: TableStatus[] | undefined = filter === 'active' ? ['lobby', 'playing'] : filter === 'closed' ? ['closed', 'cancelled'] : undefined;
  const list = useAsync(() => backend.adminListTables(statuses), [backend, filter]);
  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      await list.reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="stack">
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: 'Attivi' },
          { value: 'closed', label: 'Chiusi' },
          { value: 'all', label: 'Tutti' },
        ]}
      />
      {!list.data ? (
        <Spinner />
      ) : !list.data.length ? (
        <Empty>Nessun tavolo.</Empty>
      ) : (
        <div className="admin-list">
          {list.data.map((s) => (
            <div key={s.table.id} className="admin-table-row">
              <Link to={`/tavolo/${s.table.id}`} className="row grow">
                <span className="table-card-icon">{s.game.icon}</span>
                <span>
                  <strong>{s.table.name}</strong>
                  <br />
                  <small className="muted">
                    {s.game.name} · {s.master.displayName} · {s.participantCount} giocatori · {dateTime(s.table.createdAt)} · {s.table.code}
                  </small>
                </span>
              </Link>
              <StatusPill status={s.table.status} />
              {['lobby', 'playing'].includes(s.table.status) && (
                <>
                  <button type="button" className="btn btn-small btn-felt" onClick={() => act(() => backend.closeTable(s.table.id), 'Tavolo chiuso')}>
                    Chiudi
                  </button>
                  <button type="button" className="btn btn-small btn-red" onClick={() => act(() => backend.cancelTable(s.table.id), 'Tavolo annullato')}>
                    Annulla
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_GAME: GameDef = {
  id: '',
  name: '',
  mode: 'lives',
  room: 'arcade',
  icon: '🎲',
  description: '',
  minParticipants: 3,
  maxParticipants: 10,
  defaultLives: 3,
  targetPoints: 0,
  masterPlaysDefault: true,
  allowTeams: false,
  allowLateJoin: false,
  outcomes: [],
  allowCustomDelta: false,
  enabled: true,
  sort: 300,
};

function GamesAdmin() {
  const { backend, fail, toast, reloadCatalog } = useApp();
  const list = useAsync(() => backend.listGames(), [backend]);
  const [edit, setEdit] = useState<GameDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const save = async (g: GameDef) => {
    try {
      await backend.adminUpsertGame(g);
      toast('Gioco salvato', 'success');
      setEdit(null);
      await list.reload();
      await reloadCatalog();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="stack">
      <button type="button" className="btn btn-gold" onClick={() => { setIsNew(true); setEdit({ ...EMPTY_GAME }); }}>
        + Nuovo gioco
      </button>
      {!list.data ? (
        <Spinner />
      ) : (
        <div className="admin-list">
          {list.data.map((g) => (
            <div key={g.id} className={`admin-game ${g.enabled ? '' : 'disabled'}`}>
              <span className="table-card-icon">{g.icon}</span>
              <span className="grow">
                <strong>{g.name}</strong>
                <br />
                <small className="muted">
                  {MODE_LABEL[g.mode]} · {g.minParticipants}-{g.maxParticipants} partecipanti
                  {g.mode === 'lives' ? ` · ${g.defaultLives} vite` : ''}
                  {g.mode === 'points' ? ` · a ${g.targetPoints}` : ''}
                </small>
              </span>
              <Toggle checked={g.enabled} onChange={(v) => void save({ ...g, enabled: v })} label="" />
              <button type="button" className="btn btn-small btn-ghost" onClick={() => { setIsNew(false); setEdit({ ...g, outcomes: g.outcomes.map((o) => ({ ...o })) }); }}>
                Modifica
              </button>
            </div>
          ))}
        </div>
      )}
      {edit && <GameEditor game={edit} isNew={isNew} onCancel={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function GameEditor({ game, isNew, onCancel, onSave }: { game: GameDef; isNew: boolean; onCancel: () => void; onSave: (g: GameDef) => void }) {
  const [g, setG] = useState<GameDef>(game);
  const set = (patch: Partial<GameDef>) => setG((x) => ({ ...x, ...patch }));
  const setOutcome = (i: number, patch: Partial<Outcome>) => set({ outcomes: g.outcomes.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <Modal open onClose={onCancel} title={isNew ? 'Nuovo gioco' : `Modifica ${game.name}`} wide>
      <div className="field-row">
        <label className="field">
          <span>ID</span>
          <input value={g.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="es. tombola" />
        </label>
        <label className="field">
          <span>Icona</span>
          <input value={g.icon} onChange={(e) => set({ icon: e.target.value })} maxLength={4} />
        </label>
      </div>
      <label className="field">
        <span>Nome</span>
        <input value={g.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
      </label>
      <label className="field">
        <span>Regole in breve</span>
        <textarea className="textarea" rows={3} value={g.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="field">
        <span>Modalità</span>
        <Segmented
          value={g.mode}
          onChange={(mode) => set({ mode, room: mode === 'chips' ? 'casino' : 'arcade' })}
          options={[
            { value: 'chips', label: 'Fiches' },
            { value: 'lives', label: 'Vite' },
            { value: 'points', label: 'Punti' },
          ]}
        />
      </div>
      <div className="field-row">
        <label className="field">
          <span>Min partecipanti (master incluso)</span>
          <input type="number" min={2} value={g.minParticipants} onChange={(e) => set({ minParticipants: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Max partecipanti</span>
          <input type="number" min={2} value={g.maxParticipants} onChange={(e) => set({ maxParticipants: Number(e.target.value) })} />
        </label>
      </div>
      {g.mode === 'lives' && (
        <label className="field">
          <span>Vite predefinite</span>
          <input type="number" min={1} max={20} value={g.defaultLives} onChange={(e) => set({ defaultLives: Number(e.target.value) })} />
        </label>
      )}
      {g.mode === 'points' && (
        <label className="field">
          <span>Punteggio obiettivo predefinito</span>
          <input type="number" min={1} value={g.targetPoints} onChange={(e) => set({ targetPoints: Number(e.target.value) })} />
        </label>
      )}
      {g.mode !== 'chips' && <Toggle checked={g.masterPlaysDefault} onChange={(v) => set({ masterPlaysDefault: v })} label="Il master gioca (predefinito)" />}
      {g.mode === 'points' && <Toggle checked={g.allowTeams} onChange={(v) => set({ allowTeams: v })} label="Consenti gioco a coppie" />}
      {g.mode === 'chips' && (
        <>
          <Toggle checked={g.allowLateJoin} onChange={(v) => set({ allowLateJoin: v })} label="Ingresso a partita iniziata" />
          <Toggle checked={g.allowCustomDelta} onChange={(v) => set({ allowCustomDelta: v })} label="Consenti importo libero" />
          <div className="field">
            <span>Esiti (moltiplicatore della puntata)</span>
            {g.outcomes.map((o, i) => (
              <div key={i} className="outcome-edit">
                <input value={o.label} onChange={(e) => setOutcome(i, { label: e.target.value, key: o.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} placeholder="Etichetta" />
                <input type="number" step="0.05" value={o.mult} onChange={(e) => setOutcome(i, { mult: Number(e.target.value) })} aria-label="Moltiplicatore" />
                <button type="button" className="btn btn-small btn-ghost" onClick={() => set({ outcomes: g.outcomes.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-small btn-felt" onClick={() => set({ outcomes: [...g.outcomes, { key: `esito_${g.outcomes.length + 1}`, label: '', mult: 1 }] })}>
              + Esito
            </button>
          </div>
        </>
      )}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annulla
        </button>
        <button type="button" className="btn btn-gold" onClick={() => onSave(g)}>
          Salva
        </button>
      </div>
    </Modal>
  );
}

function SettingsAdmin() {
  const { backend, fail, toast, reloadCatalog } = useApp();
  const s = useAsync(() => backend.getSettings(), [backend]);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [wheel, setWheel] = useState('');
  const cur = draft ?? s.data;
  if (!cur) return <Spinner />;
  const set = (patch: Partial<Settings>) => setDraft({ ...cur, ...patch });
  const wheelText = wheel || cur.wheel.join(', ');
  const save = async () => {
    try {
      const parsed = wheelText.split(/[,;\s]+/).filter(Boolean).map((x) => Number(x.replace(',', '.')));
      await backend.adminUpdateSettings({ ...cur, wheel: parsed });
      await s.reload();
      await reloadCatalog();
      setDraft(null);
      setWheel('');
      toast('Impostazioni salvate', 'success');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Panel title="Impostazioni della sala" tone="dark">
      <div className="field-row">
        <label className="field">
          <span>Bonus giornaliero base</span>
          <input type="number" min={0} value={cur.dailyBonusBase} onChange={(e) => set({ dailyBonusBase: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Fiches di benvenuto</span>
          <input type="number" min={0} value={cur.startingChips} onChange={(e) => set({ startingChips: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field">
        <span>Spicchi della ruota (moltiplicatori)</span>
        <input value={wheelText} onChange={(e) => setWheel(e.target.value)} />
        <small className="muted">Separati da virgola. Ogni spicchio ha la stessa probabilità.</small>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Bonus serie (% al giorno)</span>
          <input type="number" min={0} value={cur.streakBonusPct} onChange={(e) => set({ streakBonusPct: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Serie massima (giorni)</span>
          <input type="number" min={1} value={cur.maxStreak} onChange={(e) => set({ maxStreak: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field">
        <span>Validità codici NFC/QR (secondi, 0 = senza scadenza)</span>
        <input type="number" min={0} value={cur.joinTokenTtlSeconds} onChange={(e) => set({ joinTokenTtlSeconds: Number(e.target.value) })} />
      </label>
      <Toggle
        checked={cur.allowManualCode}
        onChange={(v) => set({ allowManualCode: v })}
        label="Consenti ingresso con codice tavolo + PIN (e QR)"
        hint="Indispensabile per chi usa iPhone. Se disattivato si entra solo con l’NFC (adesivo o braccialetto, letti da Android)."
      />
      <label className="field">
        <span>Fuso orario (cambio giorno del bonus)</span>
        <input value={cur.timezone} onChange={(e) => set({ timezone: e.target.value })} />
      </label>
      <button type="button" className="btn btn-gold" onClick={save}>
        Salva impostazioni
      </button>
    </Panel>
  );
}

function Logs() {
  const { backend } = useApp();
  const [tab, setTab] = useState<'ledger' | 'audit'>('ledger');
  const ledger = useAsync(() => backend.adminLedger({ limit: 150 }), [backend]);
  const audit = useAsync(() => backend.adminAudit(150), [backend]);
  const users = useAsync(() => backend.adminListUsers(''), [backend]);
  const name = (id: string | null) => users.data?.find((u) => u.id === id)?.username ?? '—';
  return (
    <div className="stack">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ledger', label: 'Movimenti fiches' },
          { value: 'audit', label: 'Azioni (audit)' },
        ]}
      />
      {tab === 'ledger' ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Utente</th>
                <th>Tipo</th>
                <th>Nota</th>
                <th>Δ</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {(ledger.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{dateTime(l.createdAt)}</td>
                  <td>@{name(l.userId)}</td>
                  <td>{LEDGER_LABEL[l.kind] ?? l.kind}</td>
                  <td className="small">{l.note}</td>
                  <td className={l.delta > 0 ? 'pos' : 'neg'}>{signed(l.delta)}</td>
                  <td>{fmt(l.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Chi</th>
                <th>Azione</th>
                <th>Oggetto</th>
                <th>Dettagli</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{dateTime(a.createdAt)}</td>
                  <td>@{a.actorName}</td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                  <td className="small mono">{Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
