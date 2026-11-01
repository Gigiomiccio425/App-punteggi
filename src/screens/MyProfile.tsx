import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { useAsync } from '../app/hooks';
import { AVATARS, COLORS } from '../core/rules';
import { LocalBackend } from '../data/local/LocalBackend';
import { dateTime, fmt, LEDGER_LABEL, signed } from '../lib/format';
import { passUrl } from '../nfc/payload';
import { Avatar, Confirm, Panel, Toggle } from '../ui/kit';
import { NfcWriteButton, useNfcCaps } from '../ui/nfc-ui';

function EditProfile() {
  const me = useMe();
  const { backend, fail, toast, refreshMe } = useApp();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [avatar, setAvatar] = useState(me.avatar);
  const [color, setColor] = useState(me.color);
  const [bio, setBio] = useState(me.bio);
  const save = async () => {
    try {
      await backend.updateMyProfile({ displayName, avatar, color, bio });
      await refreshMe();
      toast('Profilo aggiornato', 'success');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Panel title="Il tuo profilo pubblico" tone="felt" actions={<Link to={`/giocatore/${me.username}`} className="btn btn-ghost btn-small">Vedi statistiche</Link>}>
      <div className="edit-head">
        <Avatar p={{ avatar, color, displayName }} size={72} />
        <div className="grow">
          <label className="field">
            <span>Nome visualizzato</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} />
          </label>
          <p className="small muted">@{me.username}</p>
        </div>
      </div>
      <div className="field">
        <span>Avatar</span>
        <div className="avatar-picker">
          {AVATARS.map((a) => (
            <button key={a} type="button" className={a === avatar ? 'active' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Colore</span>
        <div className="color-picker">
          {COLORS.map((c) => (
            <button key={c} type="button" className={c === color ? 'active' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colore ${c}`} />
          ))}
        </div>
      </div>
      <label className="field">
        <span>Bio</span>
        <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} placeholder="Il tuo motto al tavolo" />
      </label>
      <button type="button" className="btn btn-gold" onClick={save}>
        Salva
      </button>
    </Panel>
  );
}

function PassSection() {
  const me = useMe();
  const { backend, fail, toast } = useApp();
  const caps = useNfcCaps();
  const [rotate, setRotate] = useState(false);
  return (
    <Panel title="🎫 Il mio braccialetto pass NFC" tone="dark" className="pass-section">
      <div id="pass" />
      <p className="small">
        Il pass serve quando è il <strong>game master</strong> a farti sedere: avvicini il braccialetto (o un adesivo NFC NTAG213/215/216) al suo telefono Android e sei al
        tavolo, senza toccare il tuo telefono.
      </p>
      {caps.data?.canWrite ? (
        <NfcWriteButton
          label="Scrivi il pass su braccialetto/adesivo"
          done="Pass scritto! Tienilo con te."
          tagLabel={`Braccialetto di @${me.username}`}
          getUrl={async () => passUrl(await backend.getMyPassToken())}
        />
      ) : (
        <p className="small muted">
          Da questo telefono non puoi scrivere tag NFC{caps.data?.ios ? ' (iPhone)' : ''}: chiedi allo staff, che può scriverti il braccialetto dal pannello admin con un
          telefono Android.
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setRotate(true)}>
        Rigenera pass (se hai perso il braccialetto)
      </button>
      <Confirm
        open={rotate}
        title="Rigenerare il pass?"
        danger
        confirmLabel="Rigenera"
        onClose={() => setRotate(false)}
        onConfirm={async () => {
          try {
            await backend.rotateMyPassToken();
            toast('Pass rigenerato: il vecchio braccialetto non funziona più', 'success');
          } catch (e) {
            fail(e);
          }
        }}
      >
        <p>Il vecchio braccialetto smetterà di funzionare e dovrai scriverne uno nuovo.</p>
      </Confirm>
    </Panel>
  );
}

function PasswordSection() {
  const { backend, fail, toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  if (!backend.changePassword) return null;
  return (
    <Panel title="Password" tone="dark">
      <div className="field-row">
        <label className="field">
          <span>Attuale</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>Nuova (min. 6)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} autoComplete="new-password" />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        disabled={!current || next.length < 6}
        onClick={async () => {
          try {
            await backend.changePassword!(current, next);
            setCurrent('');
            setNext('');
            toast('Password aggiornata', 'success');
          } catch (e) {
            fail(e);
          }
        }}
      >
        Cambia password
      </button>
    </Panel>
  );
}

function GmRequestSection() {
  const me = useMe();
  const { backend, fail, toast } = useApp();
  const req = useAsync(() => backend.myGmRequest(), [backend]);
  const [text, setText] = useState('');
  if (me.role !== 'player') {
    return (
      <Panel title="🎩 Game master" tone="felt">
        <div id="gm" />
        <p>Sei autorizzato ad aprire e condurre tavoli. Gioca pulito: le tue mani sono registrate e verificabili dallo staff.</p>
        <Link to="/apri" className="btn btn-gold">
          Apri un tavolo
        </Link>
      </Panel>
    );
  }
  const last = req.data;
  return (
    <Panel title="🎩 Diventa game master" tone="felt">
      <div id="gm" />
      <p className="small">I game master aprono i tavoli e gestiscono fiches e vite: per questo devono essere approvati dallo staff.</p>
      {last?.status === 'pending' ? (
        <p className="pill pill-lobby">Richiesta inviata {dateTime(last.createdAt)} · in attesa dello staff</p>
      ) : (
        <>
          {last?.status === 'rejected' && <p className="warn small">Ultima richiesta rifiutata{last.reviewNote ? `: “${last.reviewNote}”` : ''}. Puoi riprovare.</p>}
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Perché sei affidabile? Hai già fatto da mazziere?" maxLength={500} rows={3} />
          <button
            type="button"
            className="btn btn-gold"
            disabled={text.trim().length < 10}
            onClick={async () => {
              try {
                await backend.requestGameMaster(text);
                setText('');
                await req.reload();
                toast('Richiesta inviata allo staff', 'success');
              } catch (e) {
                fail(e);
              }
            }}
          >
            Invia richiesta
          </button>
        </>
      )}
    </Panel>
  );
}

function Ledger() {
  const { backend } = useApp();
  const rows = useAsync(() => backend.myLedger(15), [backend]);
  return (
    <Panel title="Movimenti fiches" tone="dark">
      <ul className="ledger">
        {(rows.data ?? []).map((l) => (
          <li key={l.id}>
            <span className="ledger-kind">{LEDGER_LABEL[l.kind] ?? l.kind}</span>
            <span className="ledger-note">{l.note}</span>
            <span className={`ledger-delta ${l.delta > 0 ? 'pos' : 'neg'}`}>{signed(l.delta)}</span>
            <span className="ledger-bal">{fmt(l.balanceAfter)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function MyProfile() {
  const { backend, prefs, setPrefs, toast } = useApp();
  const navigate = useNavigate();
  useEffect(() => {
    const hash = location.hash.slice(1);
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }, []);
  return (
    <div className="stack">
      <h1 className="screen-title">Profilo</h1>
      <EditProfile />
      <PassSection />
      <GmRequestSection />
      <PasswordSection />
      <Panel title="Preferenze" tone="dark">
        <Toggle checked={prefs.sound} onChange={(v) => setPrefs({ ...prefs, sound: v })} label="Effetti sonori e vibrazione" />
        <Toggle checked={prefs.reduceMotion} onChange={(v) => setPrefs({ ...prefs, reduceMotion: v })} label="Riduci animazioni" hint="Disattiva ruote, coriandoli e luci lampeggianti" />
      </Panel>
      <Ledger />
      <div className="row-end">
        {backend instanceof LocalBackend && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              backend.resetDemo();
              toast('Dati demo ripristinati', 'success');
              navigate('/login');
            }}
          >
            Ripristina demo
          </button>
        )}
        <button
          type="button"
          className="btn btn-red"
          onClick={async () => {
            await backend.signOut();
            navigate('/login');
          }}
        >
          Esci
        </button>
      </div>
    </div>
  );
}
