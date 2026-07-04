// Leading + trailing throttle: the first call fires immediately, bursts are
// rate-limited, and the LAST call in a burst always lands (a cursor must come
// to rest where the pointer did).
export function throttle<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number
): (...args: T) => void {
  let last = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  return (...args: T) => {
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed >= ms) {
      last = now;
      fn(...args);
      return;
    }
    pending = args;
    if (!trailing) {
      trailing = setTimeout(() => {
        trailing = null;
        last = Date.now();
        if (pending) {
          fn(...pending);
          pending = null;
        }
      }, ms - elapsed);
    }
  };
}
