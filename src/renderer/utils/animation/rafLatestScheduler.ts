export type ContinuousInputStrategy = 'legacy' | 'frame';

interface RafLatestScheduler<T> {
  push: (value: T) => void;
  flush: () => void;
  cancel: () => void;
}

export const createRafLatestScheduler = <T>(
  apply: (value: T) => void,
  strategy: ContinuousInputStrategy = 'frame',
): RafLatestScheduler<T> => {
  let frame: number | null = null;
  let pending: T | null = null;

  const applyPending = () => {
    const value = pending;
    pending = null;
    if (value !== null) apply(value);
  };

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };

  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    applyPending();
  };

  const push = (value: T) => {
    if (strategy === 'legacy') {
      apply(value);
      return;
    }
    pending = value;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      applyPending();
    });
  };

  return { push, flush, cancel };
};
