import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { useAsync } from '../app/hooks';
import { bonusAvailable, canOpenTables } from '../core/rules';
import type { TableSummary } from '../core/types';
import { fmt, MODE_LABEL } from '../lib/format';
import { BonusWheel } from '../ui/BonusWheel';
import { Avatar, ChipCount, Divider, Empty, Marquee, Modal, NeonTitle, Panel, RoleBadge, Spinner, StatusPill } from '../ui/kit';

function DailyBonus() {
  const me = useMe();
  const { settings } = useApp();
  const [open, setOpen] = useState(false);
  if (!settings) return null;
  const available = bonusAvailable(me, settings);
  return (
    <>
      {available ? (
        <button type="button" className="bonus-card" onClick={() => setOpen(true)}>
          <Marquee bulbs={20} className="bonus-marquee">
            <span className="bonus-card-title neon neon-gold">Bonus giornaliero</span>
            <span className="bonus-card-sub">Gira la ruota e vinci fino a ×{Math.max(...settings.wheel)} fiches!</span>
          </Marquee>
        </button>
      ) : (
        <div className="bonus-card bonus-claimed">
          <span>🎡 Bonus di oggi ritirato</span>
          <span className="muted">serie 🔥 {me.bonusStreak} · torna domani</span>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Ruota della fortuna">
        <BonusWheel
          wheel={settings.wheel}
          base={settings.dailyBonusBase}
          streakPct={settings.streakBonusPct}
          streak={me.bonusStreak}
          onDone={() => undefined}
        />
      </Modal>
    </>
  );
}

function TableCard({ s }: { s: TableSummary }) {
  const full = s.participantCount >= s.game.maxParticipants;
  return (
    <Link to={`/tavolo/${s.table.id}`} className={`table-card room-${s.game.room}`}>
      <span className="table-card-icon">{s.game.icon}</span>
      <span className="table-card-body">
        <span className="table-card-name">{s.table.name}</span>
        <span className="table-card-meta">
          {s.game.name} · {MODE_LABEL[s.game.mode]} · <Avatar p={s.master} size={18} ring={false} /> {s.master.displayName}
        </span>
      </span>
      <span className="table-card-side">
        <StatusPill status={s.table.status} />
        <span className={`seats ${full ? 'seats-full' : ''}`}>
          {s.participantCount}/{s.game.maxParticipants}
        </span>
      </span>
    </Link>
  );
}

export function Lobby() {
  const me = useMe();
  const { backend } = useApp();
  const tables = useAsync(() => backend.listActiveTables(), [backend]);
  const mine = useAsync(() => backend.myActiveTableId(), [backend]);
  const { reload } = tables;
  const reloadMine = mine.reload;
  useEffect(
    () =>
      backend.subscribeLobby(() => {
        void reload();
        void reloadMine();
      }),
    [backend, reload, reloadMine],
  );
  const casino = (tables.data ?? []).filter((t) => t.game.room === 'casino');
  const arcade = (tables.data ?? []).filter((t) => t.game.room === 'arcade');

  return (
    <div className="lobby stack">
      <section className="hello">
        <Avatar p={me} size={58} />
        <div>
          <p className="muted small">Bentornato al Party Casinò</p>
          <h1 className="hello-name">
            {me.displayName} <RoleBadge role={me.role} />
          </h1>
        </div>
        <ChipCount value={me.chips} big className="hello-chips" />
      </section>

      <DailyBonus />

      {mine.data && (
        <Link to={`/tavolo/${mine.data}`} className="btn btn-red btn-big btn-shine">
          🃏 Torna al tuo tavolo
        </Link>
      )}

      <div className="quick-actions">
        {!mine.data && (
          <Link to="/entra" className="action-tile action-nfc">
            <span className="action-ico">📲</span>
            <span className="action-title">Entra al tavolo</span>
            <span className="action-sub">Avvicina il telefono</span>
          </Link>
        )}
        {canOpenTables(me.role) ? (
          !mine.data && (
            <Link to="/apri" className="action-tile action-gold">
              <span className="action-ico">🎩</span>
              <span className="action-title">Apri un tavolo</span>
              <span className="action-sub">Sei game master</span>
            </Link>
          )
        ) : (
          <Link to="/profilo#gm" className="action-tile action-ghost">
            <span className="action-ico">🎩</span>
            <span className="action-title">Diventa game master</span>
            <span className="action-sub">Richiesta allo staff</span>
          </Link>
        )}
      </div>

      <Divider label="Tavoli aperti" />

      {tables.loading && !tables.data ? (
        <Spinner />
      ) : !tables.data?.length ? (
        <Empty icon="🂠">Nessun tavolo aperto. {canOpenTables(me.role) ? 'Aprine uno tu!' : 'Chiedi a un game master di aprirne uno.'}</Empty>
      ) : (
        <>
          {casino.length > 0 && (
            <Panel title={<NeonTitle as="div" color="gold">Casinò · fiches</NeonTitle>} tone="felt">
              <div className="table-list">
                {casino.map((s) => (
                  <TableCard key={s.table.id} s={s} />
                ))}
              </div>
            </Panel>
          )}
          {arcade.length > 0 && (
            <Panel title={<NeonTitle as="div" color="cyan">Sala giochi · vite e punti</NeonTitle>} tone="neon">
              <div className="table-list">
                {arcade.map((s) => (
                  <TableCard key={s.table.id} s={s} />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
      <p className="disclaimer center">Fiches virtuali senza valore economico · {fmt((tables.data ?? []).length)} tavoli attivi</p>
    </div>
  );
}
