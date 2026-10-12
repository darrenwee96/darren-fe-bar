import { useEffect, useRef, useState } from 'react';

/**
 * Run an API call whenever `key` changes (e.g. the serialized filters + a refresh counter). Keeps the previous data
 * while reloading, so panels don't flash empty between filter changes, and ignores responses for stale keys.
 * `loading` is true until a response for the current key has arrived.
 */
export function useAsync<T>(key: string, fn: () => Promise<T>) {
  const fnRef = useRef(fn);
  // Runs before the fetch effect below in the same commit, so the fetch always uses the latest closure.
  useEffect(() => {
    fnRef.current = fn;
  });
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    let live = true;
    fnRef
      .current()
      .then((data) => live && setState({ key, data, error: null }))
      .catch((e: Error) => live && setState((s) => ({ key, data: s.data, error: e.message })));
    return () => {
      live = false;
    };
  }, [key]);

  return { data: state.data, error: state.error, loading: state.key !== key };
}
