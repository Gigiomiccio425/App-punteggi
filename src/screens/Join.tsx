import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { useAsync } from '../app/hooks';
import { errMsg } from '../lib/format';
import { sfx } from '../lib/sfx';
import { parsePayload, passUrl } from '../nfc/payload';
import { Empty, Panel, Spinner, Toggle } from '../ui/kit';
import { NfcWaves, useEmulation, useNfcCaps, useNfcReader } from '../ui/nfc-ui';

export function Join() {
  const { backend, fail, toast, settings } = useApp();
  const navigate = useNavigate();
  const caps = useNfcCaps();
  const reader = useNfcReader();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPass, setShowPass] = useState(false);
  const pass = useAsync(() => backend.getMyPassToken(), [backend]);
  const mine = useAsync(() => backend.myActiveTableId(), [backend]);
  useEmulation(pass.data ? passUrl(pass.data) : null, showPass);

  // Quando il master legge il mio pass, mi ritrovo seduto: vado al tavolo.
  const { reload } = mine;
  useEffect(() => backend.subscribeLobby(() => void reload()), [backend, reload]);
  useEffect(() => {
    if (showPass && mine.data) {
      sfx.nfc();
      toast('Sei stato fatto accomodare al tavolo!', 'success');
      navigate(`/tavolo/${mine.data}`, { state: { joined: true } });
    }
  }, [mine.data, showPass, navigate, toast]);

  const join = async (c: string, token: string, via: 'nfc_table' | 'code') => {
    const id = await backend.joinWithToken(c, token, via);
    sfx.win();
    toast('Seduto al tavolo! Buona fortuna 🍀', 'win');
    navigate(`/tavolo/${id}`, { state: { joined: true } });
  };

  const scan = async () => {
    try {
      const text = await reader.read('Avvicina il telefono a quello del game master o all’adesivo NFC del tavolo');
      const p = parsePayload(text);
      if (!p) throw new Error('Questo tag non appartiene a un tavolo di Party Casinò.');
      if (p.kind === 'pass') throw new Error('Questo è il pass di un giocatore: avvicina il telefono al tavolo o al master.');
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

  if (mine.data && !showPass) {
    return (
      <Empty icon="🃏">
        Sei già seduto a un tavolo. <Link to={`/tavolo/${mine.data}`}>Vai al tuo tavolo</Link>
      </Empty>
    );
  }

  const c = caps.data;
  return (
    <div className="stack join">
      <Panel tone="dark" className="join-hero">
        <h1 className="screen-title">Entra al tavolo</h1>
        {caps.loading ? (
          <Spinner label="Controllo l’NFC…" />
        ) : c?.canRead ? (
          <>
            <button type="button" className="nfc-big-button" onClick={scan} aria-label="Leggi NFC">
              <NfcWaves active={false} />
            </button>
            <button type="button" className="btn btn-gold btn-big btn-shine" onClick={scan}>
              Tocca e avvicina il telefono
            </button>
            <p className="muted small center">
              Avvicina il retro del telefono a quello del game master (Android) o all’adesivo NFC sul tavolo.
            </p>
            {c.disabled && <p className="warn">L’NFC è disattivato nelle impostazioni del telefono.</p>}
          </>
        ) : (
          <p className="warn">{c?.note ?? 'NFC non disponibile.'}</p>
        )}
        {c?.note && c.canRead && <p className="muted small center">{c.note}</p>}
      </Panel>

      <Panel title="Fatti leggere dal master" tone="felt">
        <p className="small">
          In alternativa è il master a leggere te: avvicina il tuo <strong>braccialetto/adesivo pass</strong> al suo telefono
          {c?.canEmulate ? ', oppure trasforma questo telefono nel tuo pass.' : '.'}
        </p>
        {c?.canEmulate && (
          <>
            <Toggle checked={showPass} onChange={setShowPass} label="Emetti il mio pass NFC" hint="Tieni lo schermo acceso e avvicina il telefono a quello del master" />
            {showPass && <NfcWaves mode="emit" label="Pass in trasmissione…" />}
          </>
        )}
        <Link to="/profilo#pass" className="btn btn-ghost btn-small">
          Scrivi il pass su un braccialetto NFC
        </Link>
      </Panel>

      {settings?.allowQrFallback && (
        <Panel title="Niente NFC? Usa il PIN" tone="dark">
          <p className="small muted">Il master può mostrare un QR (inquadralo con la fotocamera) oppure dettarti codice tavolo e PIN.</p>
          <form className="pin-form" onSubmit={submitPin}>
            <input className="input-code" placeholder="CODICE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} required aria-label="Codice tavolo" />
            <input className="input-code" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} required aria-label="PIN" />
            <button type="submit" className="btn btn-felt">
              Entra
            </button>
          </form>
        </Panel>
      )}
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
        <Link to="/entra">Riprova</Link>
      </Empty>
    );
  }
  return <Spinner label="Ti accompagno al tavolo…" />;
}
