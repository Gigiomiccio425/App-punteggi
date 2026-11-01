import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { useAsync } from '../app/hooks';
import { errMsg } from '../lib/format';
import { sfx } from '../lib/sfx';
import { parsePayload } from '../nfc/payload';
import { Empty, Panel, Spinner } from '../ui/kit';
import { NfcWaves, useNfcCaps, useNfcReader } from '../ui/nfc-ui';

export function Join() {
  const { backend, fail, toast, settings } = useApp();
  const navigate = useNavigate();
  const caps = useNfcCaps();
  const reader = useNfcReader();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const mine = useAsync(() => backend.myActiveTableId(), [backend]);

  // Se il master legge il mio braccialetto pass mi ritrovo seduto: vado al tavolo.
  const { reload } = mine;
  useEffect(() => backend.subscribeLobby(() => void reload()), [backend, reload]);
  useEffect(() => {
    if (mine.data) navigate(`/tavolo/${mine.data}`, { replace: true, state: { joined: true } });
  }, [mine.data, navigate]);

  const join = async (c: string, token: string, via: 'nfc_table' | 'code') => {
    const id = await backend.joinWithToken(c, token, via);
    sfx.win();
    toast('Seduto al tavolo! Buona fortuna 🍀', 'win');
    navigate(`/tavolo/${id}`, { state: { joined: true } });
  };

  const scan = async () => {
    try {
      const text = await reader.read('Avvicina il retro del telefono all’adesivo NFC del tavolo');
      const p = parsePayload(text);
      if (!p) throw new Error('Questo tag non appartiene a un tavolo di Party Casinò.');
      if (p.kind === 'pass') throw new Error('Questo è un braccialetto pass: va avvicinato al telefono del master.');
      await join(p.code, p.token, 'nfc_table');
    } catch (e) {
      fail(e);
    }
  };

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await join(code, pin, 'code');
    } catch (err) {
      fail(err);
    }
  };

  if (caps.loading || !caps.data) return <Spinner label="Controllo il telefono…" />;
  const c = caps.data;
  const manualAllowed = settings?.allowManualCode ?? true;

  const codePanel = manualAllowed ? (
    <Panel title={c.canRead ? 'Oppure con il codice' : '🔢 Entra con il codice'} tone={c.canRead ? 'dark' : 'felt'} className="code-panel">
      <p className="small">
        Il master ti detta (o ti mostra sul suo telefono) il <strong>codice del tavolo</strong> e il <strong>PIN</strong>. Il PIN cambia ogni pochi minuti.
      </p>
      <form className="pin-form" onSubmit={submitPin}>
        <input className="input-code" placeholder="CODICE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={5} autoCapitalize="characters" autoComplete="off" required aria-label="Codice tavolo" />
        <input className="input-code" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" required aria-label="PIN" />
        <button type="submit" className="btn btn-gold">
          Entra
        </button>
      </form>
      <p className="small muted">Puoi anche inquadrare con la fotocamera il QR mostrato dal master: si apre direttamente il tavolo.</p>
    </Panel>
  ) : (
    !c.canRead && <p className="warn">Lo staff ha disattivato l’ingresso con codice: chiedi al master di leggere il tuo braccialetto pass NFC.</p>
  );

  return (
    <div className="stack join">
      <h1 className="screen-title center">Entra al tavolo</h1>

      {c.canRead ? (
        <Panel tone="dark" className="join-hero">
          <button type="button" className="nfc-big-button" onClick={scan} aria-label="Leggi l’adesivo NFC del tavolo">
            <NfcWaves active={false} />
          </button>
          <button type="button" className="btn btn-gold btn-big btn-shine" onClick={scan}>
            Leggi l’adesivo NFC del tavolo
          </button>
          <p className="muted small center">Tocca il pulsante e avvicina il retro del telefono all’adesivo NFC sul tavolo.</p>
          {c.note && <p className="muted small center">{c.note}</p>}
        </Panel>
      ) : (
        c.note && <p className="info-box">{c.ios ? '📱 ' : ''}{c.note}</p>
      )}

      {codePanel}

      {c.ios && (
        <Panel tone="dark" title="Trucco per iPhone">
          <p className="small">
            Su iPhone XS o più recente puoi anche avvicinare l’iPhone (sbloccato) all’<strong>adesivo NFC del tavolo</strong>: compare una notifica, toccala e si apre il
            tavolo in Safari, già pronto per farti sedere.
          </p>
        </Panel>
      )}

      <Panel title="🎫 Hai un braccialetto pass?" tone="felt">
        <p className="small">Avvicinalo al telefono del master (Android): ti fa sedere lui, questa pagina si aggiorna da sola.</p>
        <Link to="/profilo#pass" className="btn btn-ghost btn-small">
          {c.canWrite ? 'Scrivi il tuo pass su un braccialetto' : 'Come ottenere un braccialetto pass'}
        </Link>
      </Panel>
      {reader.sheet}
    </div>
  );
}

/** Link letto da un tag NFC / QR: https://.../j/CODICE/TOKEN */
export function JoinLink() {
  const { code = '', token = '' } = useParams();
  const { backend, toast } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    backend
      .joinWithToken(code, token, /^\d{6}$/.test(token) ? 'qr' : 'nfc_table')
      .then((id) => {
        sfx.win();
        toast('Seduto al tavolo! Buona fortuna 🍀', 'win');
        navigate(`/tavolo/${id}`, { replace: true, state: { joined: true } });
      })
      .catch((e) => setError(errMsg(e)));
  }, [backend, code, token, navigate, toast]);
  if (error) {
    return (
      <Empty icon="⚠️">
        {error} <br />
        <Link to="/entra">Inserisci il codice a mano</Link>
      </Empty>
    );
  }
  return <Spinner label="Ti accompagno al tavolo…" />;
}
