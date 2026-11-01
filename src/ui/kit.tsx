import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useApp } from '../app/context';
import { useCountUp } from '../app/hooks';
import type { ProfileLite, Role, TableStatus } from '../core/types';
import { fmt, ROLE_LABEL, STATUS_LABEL } from '../lib/format';

// ---------------------------------------------------------------- insegna con lampadine "a inseguimento"

export function Marquee({ children, bulbs = 14, className = '', tone = 'gold' }: { children: ReactNode; bulbs?: number; className?: string; tone?: 'gold' | 'neon' }) {
  // distribuisce le lampadine lungo il perimetro (in senso orario)
  const pts: { x: number; y: number }[] = [];
  const perSide = Math.max(3, Math.round(bulbs / 4));
  for (let i = 0; i < perSide; i++) pts.push({ x: (i / perSide) * 100, y: 0 });
  for (let i = 0; i < perSide; i++) pts.push({ x: 100, y: (i / perSide) * 100 });
  for (let i = 0; i < perSide; i++) pts.push({ x: 100 - (i / perSide) * 100, y: 100 });
  for (let i = 0; i < perSide; i++) pts.push({ x: 0, y: 100 - (i / perSide) * 100 });
  return (
    <div className={`marquee marquee-${tone} ${className}`}>
      <div className="marquee-bulbs" aria-hidden>
        {pts.map((p, i) => (
          <span key={i} className={`bulb b${i % 3}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        ))}
      </div>
      <div className="marquee-inner">{children}</div>
    </div>
  );
}

export function NeonTitle({ children, color = 'pink', as: Tag = 'h1', className = '' }: { children: ReactNode; color?: 'pink' | 'cyan' | 'gold' | 'green'; as?: 'h1' | 'h2' | 'div'; className?: string }) {
  return <Tag className={`neon neon-${color} ${className}`}>{children}</Tag>;
}

export function Logo({ small = false }: { small?: boolean }) {
  const name = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'Party Casinò';
  const [a, ...rest] = name.split(' ');
  return (
    <div className={`logo ${small ? 'logo-small' : ''}`}>
      <span className="logo-suits" aria-hidden>
        ♠ ♥ ♦ ♣
      </span>
      <span className="logo-top neon neon-pink">{a}</span>
      {rest.length > 0 && <span className="logo-bottom">{rest.join(' ')}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- fiches

const CHIP_COLORS: Record<number, string> = {
  1: '#f2f2f2',
  5: '#c8102e',
  10: '#1f5fbf',
  25: '#138a4a',
  100: '#16181c',
  500: '#6b2bbf',
  1000: '#e8a317',
};

export function chipColor(value: number): string {
  const keys = Object.keys(CHIP_COLORS).map(Number).sort((a, b) => b - a);
  return CHIP_COLORS[keys.find((k) => value >= k) ?? 1];
}

export function Chip({ value, size = 44, label, onClick, active = false, disabled = false, title }: { value: number; size?: number; label?: string; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  const style = { '--chip': chipColor(value), width: size, height: size, fontSize: size * 0.28 } as CSSProperties;
  const content = <span className="chip-face">{label ?? (value >= 1000 ? `${value / 1000}K` : value)}</span>;
  if (onClick) {
    return (
      <button type="button" className={`chip ${active ? 'chip-active' : ''}`} style={style} onClick={onClick} disabled={disabled} title={title} aria-label={title ?? `Fiche da ${value}`}>
        {content}
      </button>
    );
  }
  return (
    <span className="chip" style={style} aria-hidden>
      {content}
    </span>
  );
}

export function ChipCount({ value, big = false, className = '' }: { value: number; big?: boolean; className?: string }) {
  const { prefs } = useApp();
  const shown = useCountUp(value, 900, prefs.reduceMotion);
  const [bump, setBump] = useState<'up' | 'down' | null>(null);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setBump(value > prev ? 'up' : 'down');
    setPrev(value);
  }
  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(null), 900);
    return () => clearTimeout(t);
  }, [bump]);
  return (
    <span className={`chip-count ${big ? 'chip-count-big' : ''} ${bump ? `bump-${bump}` : ''} ${className}`}>
      <Chip value={100} size={big ? 34 : 22} label="" />
      <span className="chip-count-value">{fmt(shown)}</span>
    </span>
  );
}

// ---------------------------------------------------------------- vite (cuori pixel)

const HEART_PIXELS = ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000'];

export function PixelHeart({ full = true, size = 22, breaking = false }: { full?: boolean; size?: number; breaking?: boolean }) {
  return (
    <svg className={`pixel-heart ${full ? 'ph-full' : 'ph-empty'} ${breaking ? 'breaking' : ''}`} width={size} height={(size * 7) / 8} viewBox="0 0 8 7" shapeRendering="crispEdges" aria-hidden>
      {HEART_PIXELS.flatMap((row, y) =>
        [...row].map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null)),
      )}
      {full && <rect x="1" y="1" width="1" height="1" className="shine" />}
    </svg>
  );
}

export function Hearts({ lives, max, size = 22 }: { lives: number; max: number; size?: number }) {
  const total = Math.max(max, lives);
  const [prev, setPrev] = useState(lives);
  const [breaking, setBreaking] = useState<{ from: number; to: number } | null>(null);
  if (prev !== lives) {
    setBreaking(lives < prev ? { from: lives, to: prev } : null);
    setPrev(lives);
  }
  useEffect(() => {
    if (!breaking) return;
    const t = setTimeout(() => setBreaking(null), 700);
    return () => clearTimeout(t);
  }, [breaking]);
  if (total > 10) {
    return (
      <span className="hearts hearts-compact">
        <PixelHeart size={size} full={lives > 0} /> <span className="arcade-num">×{lives}</span>
      </span>
    );
  }
  return (
    <span className="hearts" aria-label={`${lives} vite su ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <PixelHeart key={i} size={size} full={i < lives} breaking={!!breaking && i >= breaking.from && i < breaking.to} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- avatar, badge, pill

export function Avatar({ p, size = 40, ring = true }: { p: Pick<ProfileLite, 'avatar' | 'color' | 'displayName'>; size?: number; ring?: boolean }) {
  return (
    <span className={`avatar ${ring ? 'avatar-ring' : ''}`} style={{ '--ring': p.color, width: size, height: size, fontSize: size * 0.55 } as CSSProperties} title={p.displayName}>
      {p.avatar}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'player') return null;
  return <span className={`role-badge role-${role}`}>{role === 'staff' ? '★ ' : '🎩 '}{ROLE_LABEL[role]}</span>;
}

export function StatusPill({ status }: { status: TableStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PlayerLink({ p, showChips = false, size = 36 }: { p: ProfileLite; showChips?: boolean; size?: number }) {
  return (
    <Link to={`/giocatore/${p.username}`} className="player-link">
      <Avatar p={p} size={size} />
      <span className="player-link-text">
        <span className="player-name">{p.displayName}</span>
        <span className="player-handle">@{p.username}</span>
      </span>
      {showChips && <ChipCount value={p.chips} />}
    </Link>
  );
}

// ---------------------------------------------------------------- contenitori

export function Panel({ title, children, className = '', actions, tone = 'felt' }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; tone?: 'felt' | 'dark' | 'neon' }) {
  return (
    <section className={`panel panel-${tone} ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="deco-divider" role="separator">
      <span>♠</span>
      {label && <em>{label}</em>}
      <span>♦</span>
    </div>
  );
}

export function Empty({ icon = '🂠', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

export function Spinner({ label = 'Mescolo le carte…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-chip" />
      <span>{label}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Confirm({ open, title, children, confirmLabel = 'Conferma', danger = false, onConfirm, onClose }: { open: boolean; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Annulla
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-red' : 'btn-gold'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'success' ? '✔ ' : t.kind === 'error' ? '✖ ' : t.kind === 'win' ? '★ ' : ''}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function QrImage({ text, size = 200 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#0b0f12', light: '#f7f1e1' } }).then((d) => {
      if (alive) setSrc(d);
    });
    return () => {
      alive = false;
    };
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt="QR code per entrare al tavolo" /> : <div className="qr" style={{ width: size, height: size }} />;
}

export function Countdown({ until, onExpire }: { until: string | null; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  const left = until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : null;
  useEffect(() => {
    if (left === 0) onExpire?.();
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (left === null) return <span className="countdown">senza scadenza</span>;
  return <span className={`countdown ${left < 15 ? 'countdown-low' : ''}`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>;
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string }) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" className="btn btn-round" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label="Diminuisci">
        −
      </button>
      <span className="stepper-value arcade-num">{value}</span>
      <button type="button" className="btn btn-round" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label="Aumenta">
        +
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
