import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { useAsync } from '../app/hooks';
import { badgesFor, levelFor } from '../core/rules';
import type { PlayerStats, Profile } from '../core/types';
import { dateTime, fmt, signed } from '../lib/format';
import { Avatar, ChipCount, Empty, Panel, RoleBadge, Spinner } from '../ui/kit';

export function ProfileCard({ profile, stats }: { profile: Profile; stats: PlayerStats }) {
  const { gameById } = useApp();
  const level = levelFor(stats);
  const winRate = stats.gamesPlayed ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
  const badges = badgesFor(stats, profile);
  const progress = level.next ? ((level.xp - level.min) / (level.next - level.min)) * 100 : 100;
  return (
    <div className="stack">
      <section className="profile-hero" style={{ '--ring': profile.color } as CSSProperties}>
        <Avatar p={profile} size={92} />
        <h1 className="profile-name">{profile.displayName}</h1>
        <p className="muted">
          @{profile.username} <RoleBadge role={profile.role} />
          {profile.banned && <span className="tag tag-red">sospeso</span>}
        </p>
        {profile.bio && <p className="profile-bio">“{profile.bio}”</p>}
        <ChipCount value={profile.chips} big />
        <div className="level">
          <span className="level-title">{level.title}</span>
          <div className="progress gold">
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="small muted">{level.next ? `${level.xp}/${level.next} XP` : 'Livello massimo'}</span>
        </div>
      </section>

      <div className="stat-grid">
        <div className="stat"><span className="stat-v">{stats.gamesPlayed}</span><span className="stat-l">Partite</span></div>
        <div className="stat"><span className="stat-v">{stats.wins}</span><span className="stat-l">Vittorie</span></div>
        <div className="stat"><span className="stat-v">{winRate}%</span><span className="stat-l">% vittorie</span></div>
        <div className="stat"><span className="stat-v pos">{fmt(stats.chipsWon)}</span><span className="stat-l">Fiches vinte</span></div>
        <div className="stat"><span className="stat-v neg">{fmt(stats.chipsLost)}</span><span className="stat-l">Fiches perse</span></div>
        <div className="stat"><span className="stat-v">{fmt(stats.biggestWin)}</span><span className="stat-l">Colpo migliore</span></div>
        <div className="stat"><span className="stat-v">{stats.winsByMode.lives}</span><span className="stat-l">Vinte a vite</span></div>
        <div className="stat"><span className="stat-v">{stats.tablesMastered}</span><span className="stat-l">Tavoli condotti</span></div>
      </div>

      <Panel title="Medaglie" tone="dark">
        <div className="badges">
          {badges.map((b) => (
            <div key={b.id} className={`badge ${b.earned ? 'earned' : 'locked'}`} title={b.hint}>
              <span className="badge-ico">{b.icon}</span>
              <span className="badge-label">{b.label}</span>
              <span className="badge-hint">{b.hint}</span>
            </div>
          ))}
        </div>
      </Panel>

      {stats.byGame.length > 0 && (
        <Panel title="Per gioco" tone="felt">
          <table className="data-table">
            <thead>
              <tr>
                <th>Gioco</th>
                <th>Partite</th>
                <th>Vinte</th>
                <th>Fiches</th>
              </tr>
            </thead>
            <tbody>
              {stats.byGame.map((g) => {
                const def = gameById(g.gameId);
                return (
                  <tr key={g.gameId}>
                    <td>
                      {def?.icon} {def?.name ?? g.gameId}
                    </td>
                    <td>{g.played}</td>
                    <td>{g.wins}</td>
                    <td className={g.net > 0 ? 'pos' : g.net < 0 ? 'neg' : ''}>{def?.mode === 'chips' ? signed(g.net) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Ultime partite" tone="dark">
        {stats.recent.length ? (
          <ul className="recent">
            {stats.recent.map((r) => {
              const def = gameById(r.gameId);
              return (
                <li key={r.tableId}>
                  <Link to={`/tavolo/${r.tableId}`}>
                    <span className="recent-ico">{def?.icon}</span>
                    <span className="recent-text">
                      <strong>{r.tableName}</strong>
                      <small>{dateTime(r.closedAt)}</small>
                    </span>
                    <span className="recent-res">
                      {r.wasMaster ? '🎩 master' : r.won ? '🏆 1°' : r.placement ? `${r.placement}°` : '—'}
                      {r.mode === 'chips' && !r.wasMaster && <small className={r.netDelta > 0 ? 'pos' : r.netDelta < 0 ? 'neg' : ''}> {signed(r.netDelta)}</small>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">Nessuna partita conclusa.</p>
        )}
      </Panel>
    </div>
  );
}

export function PlayerProfile() {
  const { username = '' } = useParams();
  const { backend } = useApp();
  const data = useAsync(async () => {
    const p = await backend.findProfileByUsername(username);
    if (!p) return null;
    return { profile: p, stats: await backend.getStats(p.id) };
  }, [backend, username]);
  if (data.loading && !data.data) return <Spinner />;
  if (!data.data) return <Empty icon="🕵️">Giocatore non trovato.</Empty>;
  return <ProfileCard profile={data.data.profile} stats={data.data.stats} />;
}
