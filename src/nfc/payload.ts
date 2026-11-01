// Formato dei dati scritti nei tag NFC e mostrati nei QR: un URL https.
//  - Android/Chrome: l'app lo legge con Web NFC; toccando il tag fuori dall'app si apre comunque il link;
//  - iPhone XS e successivi: leggono in background i tag con URL e propongono di aprirlo in Safari;
//  - fotocamera (QR): apre lo stesso link. Il link /j/CODICE/TOKEN fa sedere al tavolo.

export type NfcPayload =
  | { kind: 'table'; code: string; token: string }
  | { kind: 'pass'; token: string };

export function publicBaseUrl(): string {
  const configured = (import.meta.env?.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '');
  if (configured) return configured;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    const base = ((import.meta.env?.BASE_URL as string | undefined) ?? '/').replace(/\/$/, '');
    return location.origin + base;
  }
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
