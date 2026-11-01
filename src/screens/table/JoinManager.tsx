import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import type { JoinToken, TableState } from '../../core/types';
import { sfx } from '../../lib/sfx';
import { parsePayload, tableUrl } from '../../nfc/payload';
import { Countdown, Panel, QrImage, Segmented } from '../../ui/kit';
import { NfcWaves, NfcWriteButton, useEmulation, useNfcCaps, useNfcReader } from '../../ui/nfc-ui';

type Mode = 'emit' | 'pass' | 'tag' | 'qr';

/** Pannello del master per far entrare i giocatori: tutte le varianti NFC + ripiego QR/PIN. */
export function JoinManager({ st }: { st: TableState }) {
  const { backend, fail, toast, settings } = useApp();
  const caps = useNfcCaps();
  const c = caps.data;
  const modes: { value: Mode; label: string }[] = [];
  if (c?.canEmulate) modes.push({ value: 'emit', label: '📲 Telefono' });
  if (c?.canRead) modes.push({ value: 'pass', label: '🎫 Leggi pass' });
  if (c?.canWrite) modes.push({ value: 'tag', label: '🏷️ Adesivo' });
  if (settings?.allowQrFallback) modes.push({ value: 'qr', label: '🔳 QR/PIN' });
  const [mode, setMode] = useState<Mode | null>(null);
  const current = mode && modes.some((m) => m.value === mode) ? mode : modes[0]?.value;

  // --- emissione (telefono del master come tag) con token che ruota
  const [nfcToken, setNfcToken] = useState<JoinToken | null>(null);
  const issue = useCallback(
    async (kind: 'nfc' | 'qr') => {
      try {
        const t = await backend.issueJoinToken(st.table.id, kind);
        if (kind === 'nfc') setNfcToken(t);
        else setQrToken(t);
      } catch (e) {
        fail(e);
      }
    },
    [backend, st.table.id, fail],
  );
  const [qrToken, setQrToken] = useState<JoinToken | null>(null);
  useEffect(() => {
    if (current === 'emit' && !nfcToken) void issue('nfc');
    if (current === 'qr' && !qrToken) void issue('qr');
  }, [current, nfcToken, qrToken, issue]);
  useEmulation(nfcToken ? tableUrl(st.table.code, nfcToken.token) : null, current === 'emit');

  // --- lettura continua dei pass
  const reader = useNfcReader();
  const [readingPasses, setReadingPasses] = useState(false);
  const loop = useRef(false);
  const readPasses = async () => {
    loop.current = true;
    setReadingPasses(true);
    while (loop.current) {
      try {
        const text = await reader.read('Avvicina il pass del giocatore (braccialetto o telefono Android)');
        const p = parsePayload(text);
        if (p?.kind !== 'pass') throw new Error('Non è un pass giocatore.');
        const added = await backend.addPlayerByPass(st.table.id, p.token);
        sfx.win();
        toast(`${added.displayName} si è seduto al tavolo`, 'success');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') break;
        fail(e);
      }
    }
    loop.current = false;
    setReadingPasses(false);
  };
  useEffect(() => () => {
    loop.current = false;
  }, []);

  if (!modes.length) {
    return (
      <Panel title="Fai entrare i giocatori" tone="dark">
        <p className="warn">{c?.note ?? 'Questo dispositivo non supporta l’NFC e lo staff ha disattivato il QR.'}</p>
      </Panel>
    );
  }

  return (
    <Panel title="Fai entrare i giocatori" tone="dark" className="join-manager">
      <Segmented value={current!} options={modes} onChange={setMode} />

      {current === 'emit' && (
        <div className="jm-body">
          <NfcWaves mode="emit" label="Tavolo in trasmissione: i giocatori avvicinano il telefono al tuo" />
          {nfcToken && (
            <p className="small muted center">
              Codice di sicurezza rinnovato automaticamente · scade tra <Countdown until={nfcToken.expiresAt} onExpire={() => void issue('nfc')} />
            </p>
          )}
          <p className="small center">Funziona con iPhone e Android: tieni lo schermo acceso e sbloccato.</p>
        </div>
      )}

      {current === 'pass' && (
        <div className="jm-body">
          <p className="small">
            Leggi il <strong>braccialetto/adesivo pass</strong> del giocatore o il suo telefono Android in modalità “Emetti il mio pass”. Ideale se usi un iPhone.
          </p>
          {readingPasses ? (
            <button type="button" className="btn btn-red" onClick={() => {
              loop.current = false;
              reader.cancel();
            }}>
              Interrompi lettura
            </button>
          ) : (
            <button type="button" className="btn btn-gold btn-shine" onClick={readPasses}>
              Inizia a leggere i pass
            </button>
          )}
        </div>
      )}

      {current === 'tag' && (
        <div className="jm-body">
          <p className="small">
            Scrivi il tavolo su un <strong>adesivo NFC</strong> (NTAG213/215) e attaccalo al tavolo: chiunque lo tocca col telefono entra, anche da iPhone senza app (si apre il link).
          </p>
          <NfcWriteButton
            label="Scrivi l’adesivo del tavolo"
            done="Adesivo scritto! Attaccalo al tavolo."
            getUrl={async () => {
              const t = await backend.issueJoinToken(st.table.id, 'static');
              return tableUrl(st.table.code, t.token);
            }}
            className="btn btn-gold btn-shine"
          />
          <p className="small muted">Il codice dell’adesivo vale finché il tavolo resta aperto; riscriverlo invalida il precedente.</p>
        </div>
      )}

      {current === 'qr' && qrToken && (
        <div className="jm-body qr-box">
          <QrImage text={tableUrl(st.table.code, qrToken.token)} size={190} />
          <div className="pin-display">
            <span className="muted small">Codice</span>
            <span className="arcade-num big">{st.table.code}</span>
            <span className="muted small">PIN</span>
            <span className="arcade-num big">{qrToken.token}</span>
            <span className="small">
              scade tra <Countdown until={qrToken.expiresAt} onExpire={() => void issue('qr')} />
            </span>
          </div>
        </div>
      )}
      {c?.note && <p className="small muted">{c.note}</p>}
      {reader.sheet}
    </Panel>
  );
}
