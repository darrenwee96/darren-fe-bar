import { useCallback, useEffect, useState } from 'react';
import { fetchSummary, type Summary } from './api';

export function useSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    () =>
      fetchSummary()
        .then((s) => {
          setSummary(s);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    void reload();
  }, [reload]);
  return { summary, error, loading, reload };
}
