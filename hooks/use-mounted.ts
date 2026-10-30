import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * true on the client after hydration, false during SSR and the hydration pass.
 * Replaces the `useEffect(() => setMounted(true), [])` pattern without an extra
 * cascading render (react-hooks/set-state-in-effect).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
