import { Capacitor } from '@capacitor/core';

// Effetti sonori sintetizzati con WebAudio (nessun file audio da scaricare) + vibrazione su app nativa.

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled || typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

async function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error') {
  if (!Capacitor.isNativePlatform()) {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }) : null;
    if (nav && 'vibrate' in nav && nav.userActivation?.hasBeenActive) nav.vibrate(kind === 'error' ? [40, 40, 40] : 25);
    return;
  }
  const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
  if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
  if (kind === 'error') return Haptics.notification({ type: NotificationType.Error });
  return Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
}

export const sfx = {
  chip() {
    tone(1800, 0, 0.05, 'triangle', 0.08);
    tone(2400, 0.03, 0.05, 'triangle', 0.05);
    void haptic('light');
  },
  coin() {
    tone(988, 0, 0.08, 'square', 0.05);
    tone(1319, 0.08, 0.25, 'square', 0.05);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.1));
    void haptic('success');
  },
  lose() {
    tone(330, 0, 0.18, 'sawtooth', 0.05);
    tone(220, 0.15, 0.3, 'sawtooth', 0.05);
    void haptic('medium');
  },
  tick() {
    tone(3000, 0, 0.015, 'square', 0.03);
  },
  nfc() {
    tone(1568, 0, 0.09, 'sine', 0.12);
    tone(2093, 0.1, 0.16, 'sine', 0.12);
    void haptic('success');
  },
  error() {
    tone(180, 0, 0.25, 'square', 0.05);
    void haptic('error');
  },
};
