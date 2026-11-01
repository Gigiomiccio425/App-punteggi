import { useApp } from '../app/context';
import { MODE_LABEL } from '../lib/format';
import { NeonTitle, Panel } from '../ui/kit';

export function Games() {
  const { games } = useApp();
  const rooms = [
    { id: 'casino', title: 'Casinò', sub: 'Si gioca con le fiches: il master è il banco e registra puntate ed esiti.', color: 'gold' as const },
    { id: 'arcade', title: 'Sala giochi', sub: 'Vite e punti, senza fiches: il master tiene la tabella, tutti vedono la situazione.', color: 'cyan' as const },
  ];
  return (
    <div className="stack">
      <h1 className="screen-title">Giochi e regole</h1>
      {rooms.map((r) => (
        <section key={r.id} className="stack">
          <NeonTitle as="h2" color={r.color}>
            {r.title}
          </NeonTitle>
          <p className="small muted">{r.sub}</p>
          {games
            .filter((g) => g.room === r.id && g.enabled)
            .map((g) => (
              <Panel key={g.id} tone={g.room === 'casino' ? 'felt' : 'neon'} title={`${g.icon} ${g.name}`} actions={<span className="tag">{MODE_LABEL[g.mode]}</span>}>
                <p>{g.description}</p>
                <p className="small muted">
                  {g.minParticipants}–{g.maxParticipants} partecipanti (master incluso)
                  {g.mode === 'lives' && ` · ${g.defaultLives} vite`}
                  {g.mode === 'points' && ` · a ${g.targetPoints} punti`}
                  {g.allowTeams && ' · anche a coppie'}
                  {g.allowLateJoin && ' · si può entrare a partita iniziata'}
                </p>
                {g.outcomes.length > 0 && (
                  <div className="outcome-legend">
                    {g.outcomes.map((o) => (
                      <span key={o.key} className={`outcome static ${o.mult > 0 ? 'win' : o.mult < 0 ? 'lose' : 'push'}`}>
                        {o.label} {o.mult > 0 ? `+${o.mult}×` : o.mult < 0 ? `${o.mult}×` : '0'}
                      </span>
                    ))}
                  </div>
                )}
              </Panel>
            ))}
        </section>
      ))}
    </div>
  );
}
