export type ContinuousInputStrategy = 'legacy' | 'frame';

interface RafLatestScheduler<T> {
  push: (value: T) => void;
  flush: () => void;
  cancel: () => void;
}

// 프레임을 실어 보낼 창. 분리 패널처럼 다른 창 문서에 그려진 노드는 자기 창의 rAF를
// 써야 메인이 가려지거나 최소화됐을 때도 프레임이 돈다
type FrameSource = Pick<
  Window,
  'requestAnimationFrame' | 'cancelAnimationFrame'
>;

export const createRafLatestScheduler = <T>(
  apply: (value: T) => void,
  strategy: ContinuousInputStrategy = 'frame',
  frames: FrameSource = window,
): RafLatestScheduler<T> => {
  let frame: number | null = null;
  let pending: T | null = null;

  const applyPending = () => {
    const value = pending;
    pending = null;
    if (value !== null) apply(value);
  };

  const cancel = () => {
    if (frame !== null) frames.cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };

  const flush = () => {
    if (frame !== null) frames.cancelAnimationFrame(frame);
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
    frame = frames.requestAnimationFrame(() => {
      frame = null;
      applyPending();
    });
  };

  return { push, flush, cancel };
};
