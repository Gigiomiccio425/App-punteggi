import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { encodeUriRecord, firstText } from './ndef';

export type NfcPlatform = 'android' | 'ios' | 'web' | 'simulator' | 'none';

export interface NfcCapabilities {
  platform: NfcPlatform;
  canRead: boolean;
  canWrite: boolean;
  /** il telefono può "fare da tag" (Android HCE): serve per il telefono-a-telefono */
  canEmulate: boolean;
  /** NFC presente ma spento nelle impostazioni */
  disabled?: boolean;
  note?: string;
}

export interface ScanOptions {
  signal: AbortSignal;
  prompt?: string;
}

export interface NfcService {
  readonly label: string;
  capabilities(): Promise<NfcCapabilities>;
  /** Attende un tag (o un telefono in emulazione) e restituisce il testo/URL letto. */
  scan(opts: ScanOptions): Promise<string>;
  /** Scrive un URL sul prossimo tag avvicinato (adesivo del tavolo o braccialetto personale). */
  write(url: string, opts: ScanOptions): Promise<void>;
  /** Trasforma il telefono in un tag NFC che espone l'URL (solo Android). */
  startEmulation(url: string): Promise<void>;
  stopEmulation(): Promise<void>;
  openSettings?(): Promise<void>;
}

function abortError() {
  return new DOMException('Operazione annullata', 'AbortError');
}

// ------------------------------------------------------------------ Capacitor (app nativa)

interface NfcHcePlugin {
  isAvailable(): Promise<{ available: boolean; enabled: boolean }>;
  start(options: { url: string }): Promise<void>;
  stop(): Promise<void>;
}

/** Plugin locale (android/app/src/main/java/.../NfcHcePlugin.kt) che emula un tag NFC Forum Type 4. */
const NfcHce = registerPlugin<NfcHcePlugin>('NfcHce');

class NativeNfc implements NfcService {
  readonly label = 'NFC del telefono';
  private platform = Capacitor.getPlatform() as 'android' | 'ios';

  private async plugin() {
    const { CapacitorNfc } = await import('@capgo/capacitor-nfc');
    return CapacitorNfc;
  }

  async capabilities(): Promise<NfcCapabilities> {
    try {
      const nfc = await this.plugin();
      const { supported } = await nfc.isSupported();
      if (!supported) return { platform: this.platform, canRead: false, canWrite: false, canEmulate: false, note: 'Questo telefono non ha l’NFC.' };
      const { status } = await nfc.getStatus();
      let canEmulate = false;
      if (this.platform === 'android') {
        try {
          canEmulate = (await NfcHce.isAvailable()).available;
        } catch {
          canEmulate = false;
        }
      }
      return {
        platform: this.platform,
        canRead: true,
        canWrite: true,
        canEmulate,
        disabled: status === 'NFC_DISABLED',
        note: this.platform === 'ios' ? 'iPhone legge e scrive tag, ma non può fare da tag: usa un adesivo NFC o il telefono Android di un altro giocatore.' : undefined,
      };
    } catch {
      return { platform: this.platform, canRead: false, canWrite: false, canEmulate: false, note: 'Plugin NFC non disponibile.' };
    }
  }

  private async session<T>(opts: ScanOptions, keepOpen: boolean, onTag: (records: Parameters<typeof firstText>[0]) => Promise<T>): Promise<T> {
    const nfc = await this.plugin();
    if (opts.signal.aborted) throw abortError();
    const handles: PluginListenerHandle[] = [];
    const cleanup = async () => {
      await Promise.all(handles.map((h) => h.remove()));
      await nfc.stopScanning().catch(() => undefined);
    };
    try {
      return await new Promise<T>((resolve, reject) => {
        let done = false;
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          fn();
        };
        opts.signal.addEventListener('abort', () => finish(() => reject(abortError())), { once: true });
        void (async () => {
          handles.push(
            await nfc.addListener('nfcEvent', (ev) => {
              onTag(ev.tag?.ndefMessage)
                .then((v) => finish(() => resolve(v)))
                .catch((e) => finish(() => reject(e)));
            }),
          );
          handles.push(
            await nfc.addListener('nfcSessionEnd', (ev) => {
              if (ev.reason !== 'invalidated') finish(() => reject(abortError()));
            }),
          );
          await nfc.startScanning({
            invalidateAfterFirstRead: !keepOpen,
            alertMessage: opts.prompt ?? 'Avvicina il telefono al tag NFC',
          });
        })().catch((e) => finish(() => reject(e)));
      });
    } finally {
      await cleanup();
    }
  }

  scan(opts: ScanOptions): Promise<string> {
    return this.session(opts, false, async (records) => {
      const text = firstText(records);
      if (!text) throw new Error('Tag vuoto o non riconosciuto.');
      return text;
    });
  }

  write(url: string, opts: ScanOptions): Promise<void> {
    return this.session(opts, true, async () => {
      const nfc = await this.plugin();
      await nfc.write({ records: [encodeUriRecord(url)], allowFormat: true });
    });
  }

  async startEmulation(url: string): Promise<void> {
    if (this.platform !== 'android') throw new Error('Solo i telefoni Android possono fare da tag NFC.');
    await NfcHce.start({ url });
  }

  async stopEmulation(): Promise<void> {
    if (this.platform === 'android') await NfcHce.stop().catch(() => undefined);
  }

  async openSettings() {
    const nfc = await this.plugin();
    await nfc.showSettings();
  }
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

class WebNfc implements NfcService {
  readonly label = 'Web NFC (Chrome)';

  async capabilities(): Promise<NfcCapabilities> {
    return {
      platform: 'web',
      canRead: true,
      canWrite: true,
      canEmulate: false,
      note: 'Dal browser puoi leggere e scrivere tag, ma non fare da tag: per il telefono-a-telefono serve l’app.',
    };
  }

  async scan(opts: ScanOptions): Promise<string> {
    const reader = new window.NDEFReader!();
    const ctrl = new AbortController();
    opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    await reader.scan({ signal: ctrl.signal });
    try {
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
    } finally {
      ctrl.abort();
    }
  }

  async write(url: string, opts: ScanOptions): Promise<void> {
    const reader = new window.NDEFReader!();
    await reader.write({ records: [{ recordType: 'url', data: url }] }, { signal: opts.signal });
  }

  async startEmulation(): Promise<void> {
    throw new Error('Il browser non può emulare un tag NFC: usa l’app Android o un adesivo NFC.');
  }

  async stopEmulation(): Promise<void> {}
}

// ------------------------------------------------------------------ Simulatore (demo multi-scheda)

type SimMessage = { type: 'field'; url: string; from: string } | { type: 'tag-written'; url: string };

/**
 * Simula l'avvicinamento di due telefoni tra schede dello stesso browser: una scheda "emula"
 * (come il telefono Android del master) e l'altra "legge". Supporta anche tag virtuali scritti.
 */
export class SimulatedNfc implements NfcService {
  readonly label = 'Simulatore NFC (demo)';
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('party-casino-nfc-sim') : null;
  private id = Math.random().toString(36).slice(2);
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTap: ((url: string) => void) | null = null;

  async capabilities(): Promise<NfcCapabilities> {
    return {
      platform: 'simulator',
      canRead: true,
      canWrite: true,
      canEmulate: true,
      note: 'Demo: apri l’app in due schede (es. master e giocatore). La scheda che emula fa da telefono/tag, l’altra legge.',
    };
  }

  virtualTags(): string[] {
    try {
      return JSON.parse(localStorage.getItem('party-casino-sim-tags') ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  /** Usato dall'interfaccia: "tocca" un tag virtuale salvato. */
  tapVirtualTag(url: string) {
    this.pendingTap?.(url);
  }

  scan(opts: ScanOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const onMsg = (ev: MessageEvent<SimMessage>) => {
        if (ev.data.type === 'field' && ev.data.from !== this.id) done(ev.data.url);
      };
      const done = (url: string) => {
        this.channel?.removeEventListener('message', onMsg);
        this.pendingTap = null;
        resolve(url);
      };
      this.pendingTap = done;
      this.channel?.addEventListener('message', onMsg);
      opts.signal.addEventListener(
        'abort',
        () => {
          this.channel?.removeEventListener('message', onMsg);
          this.pendingTap = null;
          reject(abortError());
        },
        { once: true },
      );
    });
  }

  async write(url: string, opts: ScanOptions): Promise<void> {
    if (opts.signal.aborted) throw abortError();
    await new Promise((r) => setTimeout(r, 700));
    const tags = [url, ...this.virtualTags().filter((t) => t !== url)].slice(0, 8);
    try {
      localStorage.setItem('party-casino-sim-tags', JSON.stringify(tags));
    } catch {
      // storage non disponibile: il tag virtuale non viene ricordato
    }
    this.channel?.postMessage({ type: 'tag-written', url } satisfies SimMessage);
  }

  async startEmulation(url: string): Promise<void> {
    await this.stopEmulation();
    const send = () => this.channel?.postMessage({ type: 'field', url, from: this.id } satisfies SimMessage);
    send();
    this.emitTimer = setInterval(send, 600);
  }

  async stopEmulation(): Promise<void> {
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.emitTimer = null;
  }
}

class NoNfc implements NfcService {
  readonly label = 'NFC non disponibile';
  async capabilities(): Promise<NfcCapabilities> {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return {
      platform: 'none',
      canRead: false,
      canWrite: false,
      canEmulate: false,
      note: ios
        ? 'Safari non supporta Web NFC: avvicina l’iPhone all’adesivo NFC del tavolo (si apre il link) oppure installa l’app.'
        : 'Questo browser non supporta l’NFC: usa l’app oppure il QR/PIN del tavolo.',
    };
  }
  scan(): Promise<string> {
    return Promise.reject(new Error('NFC non disponibile su questo dispositivo.'));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('NFC non disponibile su questo dispositivo.'));
  }
  startEmulation(): Promise<void> {
    return Promise.reject(new Error('NFC non disponibile su questo dispositivo.'));
  }
  async stopEmulation(): Promise<void> {}
}

export function createNfcService(opts: { allowSimulator: boolean }): NfcService {
  if (Capacitor.isNativePlatform()) return new NativeNfc();
  const forceSim = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nfcsim');
  if (!forceSim && typeof window !== 'undefined' && 'NDEFReader' in window) return new WebNfc();
  if (opts.allowSimulator || forceSim) return new SimulatedNfc();
  return new NoNfc();
}
