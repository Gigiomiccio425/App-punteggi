import { useEffect, useState, type CSSProperties } from 'react';
import { useApp } from '../app/context';

// Effetti "juice": pioggia di fiches/coriandoli. DOM + CSS, nessuna libreria.

interface Particle {
  id: number;
  x: number;
  delay: number;
  dur: number;
  rot: number;
  drift: number;
  kind: string;
  color: string;
}

const CONFETTI_COLORS = ['#d4af37', '#f6e27a', '#c8102e', '#22e7ff', '#ff2bd6', '#f7f1e1', '#2ecc71'];

function makeParticles(n: number, kinds: string[]): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 1.6 + Math.random() * 1.4,
    rot: Math.random() * 720 - 360,
    drift: Math.random() * 120 - 60,
    kind: kinds[i % kinds.length],
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));
}

/** Pioggia a schermo intero; cambia `burst` (es. un contatore) per farla ripartire. */
export function Celebration({ burst, kind = 'confetti', count = 60 }: { burst: number; kind?: 'confetti' | 'chips' | 'coins'; count?: number }) {
  const { prefs } = useApp();
  const [parts, setParts] = useState<Particle[]>([]);
  useEffect(() => {
    if (!burst || prefs.reduceMotion) return;
    const kinds = kind === 'chips' ? ['chip'] : kind === 'coins' ? ['coin', 'chip'] : ['rect', 'circle', 'suit'];
    setParts(makeParticles(count, kinds));
    const t = setTimeout(() => setParts([]), 3600);
    return () => clearTimeout(t);
  }, [burst, kind, count, prefs.reduceMotion]);
  if (!parts.length) return null;
  return (
    <div className="celebration" aria-hidden>
      {parts.map((p) => (
        <span
          key={p.id}
          className={`particle particle-${p.kind}`}
          style={
            {
              left: `${p.x}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              '--rot': `${p.rot}deg`,
              '--drift': `${p.drift}px`,
              '--pc': p.color,
            } as CSSProperties
          }
        >
          {p.kind === 'suit' ? ['♠', '♥', '♦', '♣'][p.id % 4] : null}
        </span>
      ))}
    </div>
  );
}

/** Numero che "vola" verso l'alto (es. +150) sopra un elemento. */
export function FloatingDelta({ value, trigger }: { value: number; trigger: number }) {
  const [shown, setShown] = useState<{ v: number; k: number } | null>(null);
  useEffect(() => {
    if (!trigger || value === 0) return;
    setShown({ v: value, k: trigger });
    const t = setTimeout(() => setShown(null), 1400);
    return () => clearTimeout(t);
  }, [trigger, value]);
  if (!shown) return null;
  return (
    <span key={shown.k} className={`floating-delta ${shown.v > 0 ? 'pos' : 'neg'}`}>
      {shown.v > 0 ? '+' : '−'}
      {Math.abs(shown.v)}
    </span>
  );
}
