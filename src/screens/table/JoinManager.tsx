import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import type { JoinToken, TableState } from '../../core/types';
import { sfx } from '../../lib/sfx';
import { parsePayload, tableUrl } from '../../nfc/payload';
import { Countdown, Panel, QrImage } from '../../ui/kit';
import { NfcWriteButton, useNfcCaps, useNfcReader } from '../../ui/nfc-ui';

/**
 * Pannello del master per far sedere i giocatori:
 *  - codice tavolo + PIN (e QR): funziona con tutti i telefoni, indispensabile per gli iPhone;
 *  - adesivo NFC del tavolo da scrivere (Android/Chrome) che i giocatori Android leggono;
 *  - lettura dei braccialetti pass dei giocatori (Android/Chrome).
 */
export function JoinManager({ st }: { st: TableState }) {
  const { backend, fail, toast, settings } = useApp();
  const caps = useNfcCaps();
  const c = caps.data;
  const manual = settings?.allowManualCode ?? true;

  // --- codice + PIN (si rinnova da solo alla scadenza)
  const [pin, setPin] = useState<JoinToken | null>(null);
  const [showQr, setShowQr] = useState(false);
  const issuePin = useCallback(async () => {
    try {
      setPin(await backend.issueJoinToken(st.table.id, 'qr'));
    } catch (e) {
      fail(e);
    }
  }, [backend, st.table.id, fail]);
  useEffect(() => {
    if (manual && !pin) void issuePin();
  }, [manual, pin, issuePin]);

  // --- lettura continua dei braccialetti pass
  const reader = useNfcReader();
  const [readingPasses, setReadingPasses] = useState(false);
  const loop = useRef(false);
  const readPasses = async () => {
    loop.current = true;
    setReadingPasses(true);
    while (loop.current) {
      try {
        const text = await reader.read('Avvicina il braccialetto pass del giocatore al retro del telefono');
        const p = parsePayload(text);
        if (p?.kind !== 'pass') throw new Error('Non è un braccialetto pass di Party Casinò.');
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
  useEffect(
    () => () => {
      loop.current = false;
    },
    [],
  );

  return (
    <Panel title="Fai entrare i giocatori" tone="dark" className="join-manager">
      {manual ? (
        <section className="jm-code">
          <div className="pin-display">
            <div>
              <span className="muted small">Codice tavolo</span>
              <span className="arcade-num big">{st.table.code}</span>
            </div>
            <div>
              <span className="muted small">PIN</span>
              <span className="arcade-num big">{pin?.token ?? '······'}</span>
            </div>
          </div>
          {pin && (
            <p className="small muted center">
              Valido ancora <Countdown until={pin.expiresAt} onExpire={() => void issuePin()} /> · si rinnova da solo. Dettalo ai giocatori con iPhone.
            </p>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Nascondi QR' : '🔳 Mostra QR da inquadrare'}
          </button>
          {showQr && pin && (
            <div className="qr-box">
              <QrImage text={tableUrl(st.table.code, pin.token)} size={190} />
            </div>
          )}
        </section>
      ) : (
        <p className="small muted">Lo staff ha disattivato l’ingresso con codice: si entra solo con l’NFC.</p>
      )}

      <div className="jm-nfc">
        <h3 className="jm-sub">📶 NFC</h3>
        {c?.canWrite ? (
          <>
            <p className="small">
              <strong>Adesivo del tavolo:</strong> scrivilo una volta e attaccalo al tavolo. I giocatori Android lo leggono da “Entra”; gli iPhone recenti aprono il link
              toccandolo.
            </p>
            <NfcWriteButton
              label="🏷️ Scrivi l’adesivo del tavolo"
              done="Adesivo scritto! Attaccalo al tavolo."
              tagLabel={`Adesivo tavolo ${st.table.code}`}
              getUrl={async () => {
                const t = await backend.issueJoinToken(st.table.id, 'static');
                return tableUrl(st.table.code, t.token);
              }}
              className="btn btn-gold btn-shine"
            />
            <p className="small">
              <strong>Braccialetti pass:</strong> leggi il braccialetto del giocatore e lo fai sedere tu.
            </p>
            {readingPasses ? (
              <button
                type="button"
                className="btn btn-red"
                onClick={() => {
                  loop.current = false;
                  reader.cancel();
                }}
              >
                Interrompi lettura
              </button>
            ) : (
              <button type="button" className="btn btn-felt" onClick={readPasses}>
                🎫 Leggi i braccialetti pass
              </button>
            )}
            <p className="small muted">L’adesivo vale finché il tavolo è aperto; riscriverlo invalida quello precedente.</p>
          </>
        ) : (
          <p className="small muted">{c?.note ?? 'Per scrivere adesivi o leggere i braccialetti apri il sito con Chrome su un telefono Android.'}</p>
        )}
      </div>
      {reader.sheet}
    </Panel>
  );
}
