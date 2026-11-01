import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useApp } from './context';
import { useAsync } from './hooks';
import { ChipCount, Logo, Spinner, Toasts } from '../ui/kit';
import { Login } from '../screens/Login';
import { Lobby } from '../screens/Lobby';
import { Join, JoinLink } from '../screens/Join';
import { PassLink } from '../screens/PassLink';
import { CreateTable } from '../screens/CreateTable';
import { TableScreen } from '../screens/Table';
import { Leaderboard } from '../screens/Leaderboard';
import { PlayerProfile } from '../screens/PlayerProfile';
import { MyProfile } from '../screens/MyProfile';
import { Games } from '../screens/Games';
import { Admin } from '../screens/admin/Admin';

function DeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      const h = await App.addListener('appUrlOpen', (ev) => {
        try {
          const u = new URL(ev.url);
          navigate(u.pathname + u.search);
        } catch {
          // URL non valido: ignorato
        }
      });
      remove = () => void h.remove();
    });
    return () => remove?.();
  }, [navigate]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, authReady } = useApp();
  const loc = useLocation();
  if (!authReady) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { me } = useApp();
  if (me?.role !== 'staff') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const { me, backend } = useApp();
  const loc = useLocation();
  const activeTable = useAsync(() => backend.myActiveTableId(), [backend, me?.id, loc.pathname]);
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="topbar-logo" aria-label="Home">
          <Logo small />
        </Link>
        <div className="topbar-right">
          {backend.mode === 'demo' && <span className="demo-tag" title="Dati salvati solo in questo browser">DEMO</span>}
          {me?.role === 'staff' && (
            <NavLink to="/admin" className="topbar-admin" title="Pannello staff">
              ★ Staff
            </NavLink>
          )}
          {me && (
            <Link to="/profilo" className="topbar-chips" title="Il tuo saldo">
              <ChipCount value={me.chips} />
            </Link>
          )}
        </div>
      </header>
      <main className="content" key={loc.pathname}>
        {children}
      </main>
      {me && (
        <nav className="bottombar" aria-label="Navigazione">
          <NavLink to="/" end>
            <span className="nav-ico">🎰</span>
            <span>Sala</span>
          </NavLink>
          <NavLink to="/classifica">
            <span className="nav-ico">🏆</span>
            <span>Classifica</span>
          </NavLink>
          {activeTable.data ? (
            <NavLink to={`/tavolo/${activeTable.data}`} className="nav-nfc">
              <span className="nav-ico">🃏</span>
              <span>Il mio tavolo</span>
            </NavLink>
          ) : (
            <NavLink to="/entra" className="nav-nfc">
              <span className="nav-ico">📲</span>
              <span>Entra</span>
            </NavLink>
          )}
          <NavLink to="/giochi">
            <span className="nav-ico">📜</span>
            <span>Giochi</span>
          </NavLink>
          <NavLink to="/profilo">
            <span className="nav-ico">👤</span>
            <span>Profilo</span>
          </NavLink>
        </nav>
      )}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <DeepLinks />
      <Shell>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><Lobby /></RequireAuth>} />
          <Route path="/entra" element={<RequireAuth><Join /></RequireAuth>} />
          <Route path="/j/:code/:token" element={<RequireAuth><JoinLink /></RequireAuth>} />
          <Route path="/p/:token" element={<RequireAuth><PassLink /></RequireAuth>} />
          <Route path="/apri" element={<RequireAuth><CreateTable /></RequireAuth>} />
          <Route path="/tavolo/:id" element={<RequireAuth><TableScreen /></RequireAuth>} />
          <Route path="/classifica" element={<RequireAuth><Leaderboard /></RequireAuth>} />
          <Route path="/giocatore/:username" element={<RequireAuth><PlayerProfile /></RequireAuth>} />
          <Route path="/profilo" element={<RequireAuth><MyProfile /></RequireAuth>} />
          <Route path="/giochi" element={<RequireAuth><Games /></RequireAuth>} />
          <Route path="/admin/*" element={<RequireAuth><RequireStaff><Admin /></RequireStaff></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
