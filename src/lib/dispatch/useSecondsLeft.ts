import { useEffect, useState } from 'react';

/** Whole seconds until `deadline` (epoch ms), ticking once a second. */
export function useSecondsLeft(deadline: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
