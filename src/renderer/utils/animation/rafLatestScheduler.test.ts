import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRafLatestScheduler } from './rafLatestScheduler';

describe('createRafLatestScheduler', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('한 프레임의 최신 값만 적용한다', () => {
    let callback: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const apply = vi.fn();
    const scheduler = createRafLatestScheduler(apply);

    scheduler.push(1);
    scheduler.push(2);
    scheduler.push(3);
    expect(apply).not.toHaveBeenCalled();

    (callback as FrameRequestCallback)(performance.now());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(3);
  });

  it('flush는 예약을 취소하고 마지막 값을 즉시 적용한다', () => {
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 7);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const apply = vi.fn();
    const scheduler = createRafLatestScheduler(apply);

    scheduler.push('final');
    scheduler.flush();

    expect(cancel).toHaveBeenCalledWith(7);
    expect(apply).toHaveBeenCalledWith('final');
  });

  it('legacy 전략은 각 값을 즉시 적용한다', () => {
    const apply = vi.fn();
    const scheduler = createRafLatestScheduler(apply, 'legacy');
    scheduler.push(1);
    scheduler.push(2);
    expect(apply.mock.calls).toEqual([[1], [2]]);
  });
});
