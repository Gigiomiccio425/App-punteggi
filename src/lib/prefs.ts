export interface Prefs {
  sound: boolean;
  reduceMotion: boolean;
}

const KEY = 'party-casino-prefs';

export function loadPrefs(): Prefs {
  const base: Prefs = {
    sound: true,
    reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return base;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // preferenze non persistite (navigazione privata)
  }
}
