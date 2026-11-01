import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { useAsync } from '../app/hooks';
import type { LeaderKind } from '../core/types';
import { fmt } from '../lib/format';
import { Avatar, Chip, Empty, NeonTitle, Segmented, Spinner } from '../ui/kit';

const UNIT: Record<LeaderKind, string> = { chips: 'fiches', wins: 'vittorie', games: 'partite' };

export function Leaderboard() {
  const me = useMe();
  const { backend } = useApp();
  const [kind, setKind] = useState<LeaderKind>('chips');
  const rows = useAsync(() => backend.leaderboard(kind), [backend, kind]);
  const list = rows.data ?? [];
  const podium = [list[1], list[2], list[0]];
  const myPos = list.findIndex((r) => r.profile.id === me.id);

  return (
    <div className="stack leaderboard">
      <NeonTitle color="gold" className="center">
        Hall of Fame
      </NeonTitle>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'chips', label: '💰 Fiches' },
          { value: 'wins', label: '🏆 Vittorie' },
          { value: 'games', label: '🎲 Partite' },
        ]}
      />
      {rows.loading && !rows.data ? (
        <Spinner />
      ) : !list.length ? (
        <Empty>Ancora nessun giocatore in classifica.</Empty>
      ) : (
        <>
          <div className="lb-podium">
            {podium.map((r, i) =>
              r ? (
                <Link key={r.profile.id} to={`/giocatore/${r.profile.username}`} className={`lb-step lb-${['second', 'third', 'first'][i]}`}>
                  <span className="lb-crown">{i === 2 ? '👑' : i === 0 ? '🥈' : '🥉'}</span>
                  <Avatar p={r.profile} size={i === 2 ? 70 : 54} />
                  <span className="lb-name">{r.profile.displayName}</span>
                  <span className="lb-val">
                    {kind === 'chips' && <Chip value={r.value} size={18} label="" />} {fmt(r.value)}
                  </span>
                </Link>
              ) : (
                <span key={i} />
              ),
            )}
          </div>
          <ol className="lb-list" start={4}>
            {list.slice(3).map((r, i) => (
              <li key={r.profile.id} className={r.profile.id === me.id ? 'me' : ''}>
                <span className="lb-pos">{i + 4}</span>
                <Link to={`/giocatore/${r.profile.username}`} className="lb-who">
                  <Avatar p={r.profile} size={32} />
                  <span>{r.profile.displayName}</span>
                </Link>
                <span className="lb-v">
                  {fmt(r.value)} <small>{UNIT[kind]}</small>
                </span>
              </li>
            ))}
          </ol>
          {myPos >= 0 && <p className="center small muted">Sei al {myPos + 1}° posto</p>}
        </>
      )}
    </div>
  );
}
