import { useEffect, useState } from 'react';

/** The value once it has stopped changing for `ms` — so typing re-queries once, not per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
