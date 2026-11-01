import { useCallback, useEffect, useRef, useState } from 'react';
import type { TableState } from '../core/types';
import { useApp } from './context';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const v = await fnRef.current();
      if (n === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, reload };
}

/** Stato del tavolo sempre aggiornato (Realtime / BroadcastChannel). */
export function useTable(tableId: string | undefined) {
  const { backend } = useApp();
  const state = useAsync<TableState | undefined>(
    () => (tableId ? backend.getTable(tableId) : Promise.resolve(undefined)),
    [tableId, backend],
  );
  const { reload } = state;
  useEffect(() => {
    if (!tableId) return;
    return backend.subscribeTable(tableId, () => void reload());
  }, [backend, tableId, reload]);
  return state;
}

/** Valore numerico animato (conteggio "a rullo" con easing). */
export function useCountUp(target: number, duration = 900, disabled = false): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (disabled || from.current === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(a + (target - a) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, duration, disabled]);
  return value;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
