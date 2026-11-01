// Accesso all'NFC dal browser.
//  - Android + Chrome: Web NFC (lettura e scrittura di tag NDEF; serve https).
//  - iPhone: nessun browser supporta Web NFC → si entra con codice tavolo + PIN (o QR).
//  - Demo: simulatore che riproduce Web NFC tra schede dello stesso browser.

export type NfcPlatform = 'web' | 'simulator' | 'none';

export interface NfcCapabilities {
  platform: NfcPlatform;
  canRead: boolean;
  canWrite: boolean;
  ios: boolean;
  note?: string;
}

export interface ScanOptions {
  signal: AbortSignal;
  prompt?: string;
  /** etichetta descrittiva (usata dal simulatore per mostrare i tag scritti) */
  label?: string;
}

export interface NfcService {
  readonly label: string;
  capabilities(): Promise<NfcCapabilities>;
  /** Attende un tag NFC e restituisce l'URL/testo letto. */
  scan(opts: ScanOptions): Promise<string>;
  /** Scrive un URL sul prossimo tag avvicinato (adesivo del tavolo o braccialetto pass). */
  write(url: string, opts: ScanOptions): Promise<void>;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function abortError() {
  return new DOMException('Operazione annullata', 'AbortError');
}

// ------------------------------------------------------------------ Web NFC (Chrome per Android)

interface NDEFRecordLike {
  recordType: string;
  data?: DataView;
  encoding?: string;
}
interface NDEFReaderLike extends EventTarget {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: { recordType: string; data: string }[] }, opts?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((ev: Event & { message: { records: NDEFRecordLike[] } }) => void) | null;
  onreadingerror: ((ev: Event) => void) | null;
}
declare global {
  interface Window {
    NDEFReader?: { new (): NDEFReaderLike };
  }
}

function webNfcError(e: unknown): Error {
  if (e instanceof DOMException) {
    if (e.name === 'AbortError') return e;
    if (e.name === 'NotAllowedError') return new Error('Permesso NFC negato: consentilo nelle impostazioni del sito in Chrome.');
    if (e.name === 'NotSupportedError') return new Error('NFC spento o non presente: attivalo nelle impostazioni del telefono.');
    if (e.name === 'NetworkError') return new Error('Tag allontanato troppo presto: riprova tenendolo fermo.');
  }
  return e instanceof Error ? e : new Error(String(e));
}

class WebNfc implements NfcService {
  readonly label = 'Web NFC (Chrome Android)';

  async capabilities(): Promise<NfcCapabilities> {
    return {
      platform: 'web',
      canRead: true,
      canWrite: true,
      ios: false,
      note: 'Puoi leggere e scrivere adesivi e braccialetti NFC. Due telefoni non si "leggono" tra loro dal browser: serve un tag.',
    };
  }

  async scan(opts: ScanOptions): Promise<string> {
    const reader = new window.NDEFReader!();
    const ctrl = new AbortController();
    opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      await reader.scan({ signal: ctrl.signal });
      return await new Promise<string>((resolve, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(abortError()), { once: true });
        reader.onreadingerror = () => reject(new Error('Tag non leggibile, riprova.'));
        reader.onreading = (ev) => {
          for (const r of ev.message.records) {
            if (!r.data) continue;
            if (r.recordType === 'url' || r.recordType === 'absolute-url') return resolve(new TextDecoder().decode(r.data));
            if (r.recordType === 'text') return resolve(new TextDecoder(r.encoding || 'utf-8').decode(r.data));
          }
          reject(new Error('Tag vuoto o non riconosciuto.'));
        };
      });
    } catch (e) {
      throw webNfcError(e);
    } finally {
      ctrl.abort();
    }
  }

  async write(url: string, opts: ScanOptions): Promise<void> {
    try {
      const writer = new window.NDEFReader!();
      await writer.write({ records: [{ recordType: 'url', data: url }] }, { signal: opts.signal });
    } catch (e) {
      throw webNfcError(e);
    }
  }
}

// ------------------------------------------------------------------ Simulatore (solo modalità demo)

export interface VirtualTag {
  url: string;
  label: string;
}

const SIM_KEY = 'party-casino-sim-tags';

/**
 * Riproduce Web NFC nella demo: "scrivere" un tag lo salva tra gli adesivi virtuali (condivisi tra
 * le schede), "leggere" significa toccarne uno dall'elenco. Come nel browser reale, il telefono
 * non può fare da tag.
 */
export class SimulatedNfc implements NfcService {
  readonly label = 'Simulatore NFC (demo)';
  private pendingTap: ((url: string) => void) | null = null;

  async capabilities(): Promise<NfcCapabilities> {
    return {
      platform: 'simulator',
      canRead: true,
      canWrite: true,
      ios: false,
      note: 'Demo: gli adesivi e i braccialetti NFC sono virtuali e condivisi tra le schede di questo browser.',
    };
  }

  virtualTags(): VirtualTag[] {
    try {
      const raw = JSON.parse(localStorage.getItem(SIM_KEY) ?? '[]') as unknown[];
      return raw.filter((t): t is VirtualTag => !!t && typeof t === 'object' && typeof (t as VirtualTag).url === 'string');
    } catch {
      return [];
    }
  }

  tapVirtualTag(url: string) {
    this.pendingTap?.(url);
  }

  scan(opts: ScanOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pendingTap = (url) => {
        this.pendingTap = null;
        resolve(url);
      };
      opts.signal.addEventListener(
        'abort',
        () => {
          this.pendingTap = null;
          reject(abortError());
        },
        { once: true },
      );
    });
  }

  async write(url: string, opts: ScanOptions): Promise<void> {
    if (opts.signal.aborted) throw abortError();
    await new Promise((r) => setTimeout(r, 600));
    if (opts.signal.aborted) throw abortError();
    const tag: VirtualTag = { url, label: opts.label ?? url.replace(/^https?:\/\/[^/]+/, '') };
    const tags = [tag, ...this.virtualTags().filter((t) => t.label !== tag.label)].slice(0, 12);
    try {
      localStorage.setItem(SIM_KEY, JSON.stringify(tags));
    } catch {
      // storage non disponibile: il tag virtuale non viene ricordato
    }
  }
}

class NoNfc implements NfcService {
  readonly label = 'NFC non disponibile';
  async capabilities(): Promise<NfcCapabilities> {
    const ios = isIOS();
    const insecure = typeof window !== 'undefined' && !window.isSecureContext;
    return {
      platform: 'none',
      canRead: false,
      canWrite: false,
      ios,
      note: ios
        ? 'Su iPhone il browser non può usare l’NFC: entra con il codice del tavolo e il PIN che ti dà il master (o inquadra il suo QR).'
        : insecure
          ? 'L’NFC funziona solo aprendo il sito in https://.'
          : 'Questo browser non supporta l’NFC: usa Chrome su Android, oppure entra con codice e PIN.',
    };
  }
  scan(): Promise<string> {
    return Promise.reject(new Error('NFC non disponibile su questo dispositivo.'));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('NFC non disponibile su questo dispositivo.'));
  }
}

export function createNfcService(opts: { demo: boolean }): NfcService {
  const forceSim = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nfcsim');
  if (!forceSim && typeof window !== 'undefined' && 'NDEFReader' in window && window.isSecureContext) return new WebNfc();
  if (opts.demo || forceSim) return new SimulatedNfc();
  return new NoNfc();
}
