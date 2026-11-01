import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameDef, Profile, Settings } from '../core/types';
import type { Backend } from '../data/backend';
import { errMsg } from '../lib/format';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import { setSoundEnabled, sfx } from '../lib/sfx';
import type { NfcService } from '../nfc/nfc';

export type ToastKind = 'success' | 'error' | 'info' | 'win';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface AppCtx {
  backend: Backend;
  nfc: NfcService;
  me: Profile | null;
  authReady: boolean;
  refreshMe: () => Promise<void>;
  games: GameDef[];
  gameById: (id: string) => GameDef | undefined;
  settings: Settings | null;
  reloadCatalog: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: ToastKind) => void;
  fail: (e: unknown) => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ backend, nfc, children }: { backend: Backend; nfc: NfcService; children: ReactNode }) {
  const [me, setMe] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [games, setGames] = useState<GameDef[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const toastId = useRef(0);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await backend.currentUser());
    } finally {
      setAuthReady(true);
    }
  }, [backend]);

  const reloadCatalog = useCallback(async () => {
    if (!(await backend.currentUser())) return;
    const [g, s] = await Promise.all([backend.listGames(), backend.getSettings()]);
    setGames(g);
    setSettings(s);
  }, [backend]);

  useEffect(() => {
    void refreshMe();
    return backend.onAuthChange(() => void refreshMe());
  }, [backend, refreshMe]);

  useEffect(() => {
    if (me) void reloadCatalog();
  }, [me?.id, reloadCatalog]); // eslint-disable-line react-hooks/exhaustive-deps

  // il saldo cambia anche per azioni altrui (mani registrate dal master): ascoltiamo i cambiamenti
  useEffect(() => {
    if (!me) return;
    return backend.subscribeLobby(() => void refreshMe());
  }, [backend, me?.id, refreshMe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSoundEnabled(prefs.sound);
    document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
  }, [prefs]);

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3500);
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      sfx.error();
      toast(errMsg(e), 'error');
    },
    [toast],
  );

  const setPrefs = useCallback((p: Prefs) => {
    savePrefs(p);
    setPrefsState(p);
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      backend,
      nfc,
      me,
      authReady,
      refreshMe,
      games,
      gameById: (id: string) => games.find((g) => g.id === id),
      settings,
      reloadCatalog,
      toasts,
      toast,
      fail,
      prefs,
      setPrefs,
    }),
    [backend, nfc, me, authReady, refreshMe, games, settings, reloadCatalog, toasts, toast, fail, prefs, setPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fuori da AppProvider');
  return v;
}

/** Profilo dell'utente loggato (le schermate protette sono montate solo se presente). */
export function useMe(): Profile {
  const { me } = useApp();
  if (!me) throw new Error('utente non autenticato');
  return me;
}
