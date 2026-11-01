import { useRef, useState } from 'react';
import { useApp } from '../app/context';
import { fmt } from '../lib/format';
import { sfx } from '../lib/sfx';
import type { BonusResult } from '../core/types';
import { Celebration } from './effects';

const SIZE = 300;
const C = SIZE / 2;
const R = 132;

function arc(i: number, n: number) {
  const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
  const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
  const p = (a: number) => `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
  return `M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)} Z`;
}

/** Ruota della fortuna del bonus giornaliero. L'esito lo decide il server, la ruota lo "racconta". */
export function BonusWheel({ wheel, base, streakPct, streak, onDone }: { wheel: number[]; base: number; streakPct: number; streak: number; onDone: (r: BonusResult) => void }) {
  const { backend, fail, prefs, refreshMe } = useApp();
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'done'>('idle');
  const [result, setResult] = useState<BonusResult | null>(null);
  const [burst, setBurst] = useState(0);
  const ticker = useRef<ReturnType<typeof setTimeout> | null>(null);
  const n = wheel.length;
  const seg = 360 / n;
  const best = Math.max(...wheel);

  const tickLoop = (delay: number, elapsed: number) => {
    if (elapsed > 5000) return;
    sfx.tick();
    ticker.current = setTimeout(() => tickLoop(delay * 1.12, elapsed + delay), delay);
  };

  const spin = async () => {
    setPhase('spinning');
    try {
      const r = await backend.claimDailyBonus();
      setResult(r);
      const current = rotation % 360;
      const target = -(r.segment + 0.5) * seg;
      const delta = (((target - current) % 360) + 360) % 360;
      const turns = prefs.reduceMotion ? 0 : 6;
      setRotation(rotation + turns * 360 + delta);
      if (prefs.reduceMotion) finish(r);
      else tickLoop(40, 0);
    } catch (e) {
      setPhase('idle');
      fail(e);
    }
  };

  const finish = (r: BonusResult | null = result) => {
    if (!r || phase === 'done') return;
    if (ticker.current) clearTimeout(ticker.current);
    setPhase('done');
    setBurst((b) => b + 1);
    sfx.win();
    sfx.coin();
    void refreshMe();
    onDone(r);
  };

  return (
    <div className="bonus-wheel">
      <div className="wheel-wrap">
        <svg className="wheel-pointer" width="34" height="40" viewBox="0 0 34 40" aria-hidden>
          <path d="M17 38 L3 6 Q17 -2 31 6 Z" />
        </svg>
        <svg
          className="wheel"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label="Ruota del bonus giornaliero"
        >
          <circle cx={C} cy={C} r={R + 14} className="wheel-rim" />
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * 2 * Math.PI;
            return <circle key={i} cx={C + (R + 7) * Math.cos(a)} cy={C + (R + 7) * Math.sin(a)} r="3.4" className={`wheel-bulb ${phase === 'spinning' ? 'fast' : ''} b${i % 2}`} />;
          })}
          <g
            className="wheel-disc"
            style={{ transform: `rotate(${rotation}deg)`, transition: phase === 'spinning' && !prefs.reduceMotion ? 'transform 5.2s cubic-bezier(0.12, 0.7, 0.1, 1)' : 'none' }}
            onTransitionEnd={() => finish()}
          >
            {wheel.map((m, i) => (
              <g key={i}>
                <path d={arc(i, n)} className={m === best ? 'seg seg-jackpot' : i % 2 ? 'seg seg-black' : 'seg seg-red'} />
                <text
                  x={C}
                  y={C - R + 34}
                  transform={`rotate(${(i + 0.5) * seg} ${C} ${C})`}
                  className="seg-label"
                  textAnchor="middle"
                >
                  {m === best ? '★' : ''}×{String(m).replace('.', ',')}
                </text>
              </g>
            ))}
            <circle cx={C} cy={C} r="30" className="wheel-hub" />
            <text x={C} y={C + 6} textAnchor="middle" className="wheel-hub-text">
              ♠
            </text>
          </g>
        </svg>
      </div>
      {phase !== 'done' ? (
        <>
          <p className="muted center">
            Base {fmt(base)} fiches × moltiplicatore della ruota
            {streak > 0 && streakPct > 0 && <> · serie attuale 🔥 {streak} (+{streakPct}% per ogni giorno consecutivo)</>}
          </p>
          <button type="button" className="btn btn-gold btn-big btn-shine" onClick={spin} disabled={phase === 'spinning'}>
            {phase === 'spinning' ? 'La ruota gira…' : 'Gira la ruota!'}
          </button>
        </>
      ) : (
        result && (
          <div className="bonus-result pop-in">
            <div className="bonus-amount neon neon-gold">+{fmt(result.amount)}</div>
            <p>
              Moltiplicatore ×{String(result.multiplier).replace('.', ',')} · serie 🔥 {result.streak}
            </p>
          </div>
        )
      )}
      <Celebration burst={burst} kind="coins" count={50} />
    </div>
  );
}
