// Formato dei dati scritti nei tag / emulati via HCE / mostrati nei QR.
// Si usa un record NDEF di tipo URI con un URL https: così
//  - un iPhone (anche senza app) legge il tag in background e apre il link (Universal Link → app, altrimenti Safari);
//  - Android apre l'app tramite App Links oppure il browser;
//  - dentro l'app lo stesso URL viene interpretato direttamente.

export type NfcPayload =
  | { kind: 'table'; code: string; token: string }
  | { kind: 'pass'; token: string };

export function publicBaseUrl(): string {
  const configured = (import.meta.env?.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '');
  if (configured) return configured;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return location.origin;
  return 'https://party.example.com';
}

export function tableUrl(code: string, token: string): string {
  return `${publicBaseUrl()}/j/${encodeURIComponent(code)}/${encodeURIComponent(token)}`;
}

export function passUrl(token: string): string {
  return `${publicBaseUrl()}/p/${encodeURIComponent(token)}`;
}

export function parsePayload(text: string): NfcPayload | null {
  const raw = text.trim();
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    // non è un URL completo: accettiamo anche "/j/CODE/TOKEN"
  }
  const table = path.match(/\/j\/([A-Za-z0-9]{4,8})\/([A-Za-z0-9]{4,64})\/?$/);
  if (table) return { kind: 'table', code: decodeURIComponent(table[1]).toUpperCase(), token: decodeURIComponent(table[2]) };
  const pass = path.match(/\/p\/([A-Za-z0-9]{8,64})\/?$/);
  if (pass) return { kind: 'pass', token: decodeURIComponent(pass[1]) };
  return null;
}
