import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/context';
import { useAsync } from '../app/hooks';
import { LocalBackend } from '../data/local/LocalBackend';
import { DEMO_PASSWORD } from '../data/local/LocalBackend';
import { ROLE_LABEL } from '../lib/format';
import { sfx } from '../lib/sfx';
import { Logo, Marquee, Segmented } from '../ui/kit';

export function Login() {
  const { me, backend, fail, toast } = useApp();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [tab, setTab] = useState<'in' | 'up'>('in');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const demo = useAsync(() => backend.demoAccounts?.() ?? Promise.resolve([]), [backend]);

  if (me) return <Navigate to={next} replace />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      sfx.coin();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tab === 'in') void run(() => backend.signIn(identifier, password));
    else
      void run(async () => {
        await backend.signUp({ email, password, username, displayName });
        toast('Benvenuto al tavolo! Hai ricevuto le fiches di benvenuto.', 'win');
      });
  };

  return (
    <div className="login">
      <Marquee bulbs={28} className="login-marquee">
        <Logo />
        <p className="tagline">Fiches, vite e punti per le tue serate di gioco</p>
      </Marquee>

      <form className="panel panel-felt login-form" onSubmit={submit}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'in', label: 'Accedi' },
            { value: 'up', label: 'Registrati' },
          ]}
        />
        {tab === 'in' ? (
          <>
            <label className="field">
              <span>{backend.mode === 'demo' ? 'Username o email' : 'Email'}</span>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            <label className="field">
              <span>Username (pubblico)</span>
              <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} pattern="[a-z0-9_.]{3,20}" title="3-20 caratteri: minuscole, numeri, _ e ." required />
            </label>
            <label className="field">
              <span>Nome visualizzato</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="new-password" required />
            </label>
          </>
        )}
        <button type="submit" className="btn btn-gold btn-big btn-shine" disabled={busy}>
          {tab === 'in' ? 'Entra in sala' : 'Crea il mio account'}
        </button>
        <p className="disclaimer">Le fiches sono virtuali e non hanno alcun valore economico: non si comprano e non si convertono.</p>
      </form>

      {backend.mode === 'demo' && (
        <section className="panel panel-dark demo-box">
          <h2 className="panel-title">Modalità demo</h2>
          <p className="small muted">
            I dati restano in questo browser. Apri l’app in <strong>più schede</strong> e accedi con account diversi per simulare più telefoni:
            l’NFC tra telefoni è simulato tra le schede. Password per tutti: <code>{DEMO_PASSWORD}</code>.
          </p>
          <div className="demo-accounts">
            {(demo.data ?? []).map((a) => (
              <button key={a.username} type="button" className="demo-account" disabled={busy} onClick={() => void run(() => backend.signIn(a.username, DEMO_PASSWORD))}>
                <span className="demo-avatar">{a.avatar}</span>
                <span className="demo-name">{a.displayName}</span>
                <span className={`demo-role role-${a.role}`}>{ROLE_LABEL[a.role]}</span>
              </button>
            ))}
          </div>
          {backend instanceof LocalBackend && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                backend.resetDemo();
                void demo.reload();
                toast('Dati demo ripristinati', 'success');
              }}
            >
              Ripristina dati demo
            </button>
          )}
        </section>
      )}
    </div>
  );
}
