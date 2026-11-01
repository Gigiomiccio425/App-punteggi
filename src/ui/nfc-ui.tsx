import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { useAsync } from '../app/hooks';
import { SimulatedNfc, type NfcCapabilities } from '../nfc/nfc';
import { sfx } from '../lib/sfx';
import { Modal } from './kit';

export function useNfcCaps() {
  const { nfc } = useApp();
  return useAsync<NfcCapabilities>(() => nfc.capabilities(), [nfc]);
}

export function NfcWaves({ active = true, label, mode = 'read' }: { active?: boolean; label?: ReactNode; mode?: 'read' | 'write' }) {
  return (
    <div className={`nfc-waves nfc-${mode} ${active ? 'active' : ''}`}>
      <span className="ring r1" />
      <span className="ring r2" />
      <span className="ring r3" />
      <span className="nfc-phone" aria-hidden>
        <svg viewBox="0 0 48 48" width="56" height="56">
          <rect x="12" y="4" width="24" height="40" rx="4" />
          <path d="M20 18c2 2 2 8 0 10M24 15c3.5 3.5 3.5 12.5 0 16M28 12c5 5 5 19 0 24" />
        </svg>
      </span>
      {label && <span className="nfc-label">{label}</span>}
    </div>
  );
}

/** Sessione di lettura NFC con la finestra "avvicina il telefono al tag". */
export function useNfcReader() {
  const { nfc } = useApp();
  const ctrl = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setPrompt(null);
  }, []);

  const read = useCallback(
    async (message: string): Promise<string> => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setPrompt(message);
      try {
        const text = await nfc.scan({ signal: c.signal, prompt: message });
        sfx.nfc();
        return text;
      } finally {
        if (ctrl.current === c) {
          ctrl.current = null;
          setPrompt(null);
        }
      }
    },
    [nfc],
  );

  useEffect(() => () => ctrl.current?.abort(), []);

  const sheet = <NfcReadSheet prompt={prompt} onCancel={cancel} />;
  return { read, cancel, reading: prompt !== null, sheet };
}

function NfcReadSheet({ prompt, onCancel }: { prompt: string | null; onCancel: () => void }) {
  const { nfc } = useApp();
  const sim = nfc instanceof SimulatedNfc ? nfc : null;
  const tags = prompt !== null && sim ? sim.virtualTags() : [];
  return (
    <Modal open={prompt !== null} onClose={onCancel} title="Lettura NFC">
      <NfcWaves label={prompt} />
      {sim && (
        <div className="sim-box">
          <p className="small">
            <strong>Simulatore:</strong> tocca un adesivo o un braccialetto virtuale (si creano con “Scrivi” dal master o dal profilo).
          </p>
          {tags.length ? (
            <div className="sim-tags">
              {tags.map((t) => (
                <button key={t.label} type="button" className="btn btn-ghost btn-small" onClick={() => sim.tapVirtualTag(t.url)}>
                  🏷️ {t.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted">Nessun tag virtuale scritto finora.</p>
          )}
        </div>
      )}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annulla
        </button>
      </div>
    </Modal>
  );
}

export function NfcWriteButton({ getUrl, label, done, tagLabel, className = 'btn btn-felt' }: { getUrl: () => Promise<string>; label: ReactNode; done: string; tagLabel?: string; className?: string }) {
  const { nfc, fail, toast } = useApp();
  const [writing, setWriting] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const start = async () => {
    const c = new AbortController();
    ctrl.current = c;
    setWriting(true);
    try {
      const url = await getUrl();
      await nfc.write(url, { signal: c.signal, prompt: 'Avvicina l’adesivo o il braccialetto NFC da scrivere', label: tagLabel });
      sfx.nfc();
      toast(done, 'success');
    } catch (e) {
      fail(e);
    } finally {
      setWriting(false);
      ctrl.current = null;
    }
  };
  return (
    <>
      <button type="button" className={className} onClick={start} disabled={writing}>
        {label}
      </button>
      <Modal open={writing} onClose={() => ctrl.current?.abort()} title="Scrittura tag NFC">
        <NfcWaves mode="write" label="Avvicina un adesivo o braccialetto NFC (NTAG213/215/216) al retro del telefono" />
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={() => ctrl.current?.abort()}>
            Annulla
          </button>
        </div>
      </Modal>
    </>
  );
}
