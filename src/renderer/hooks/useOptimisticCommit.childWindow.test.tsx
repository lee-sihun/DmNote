// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOptimisticBooleanCommit } from './useOptimisticBooleanCommit';
import { useOptimisticValueCommit } from './useOptimisticValueCommit';

// 분리 패널은 opener 자식 창이라 메인 트리가 자식 문서로 DOM을 포털한다.
// 커밋 프레임이 메인 창에 걸리면 메인이 가려진 동안 저장이 통째로 멈춘다.
// iframe으로 같은 힙에 문서와 창이 하나 더 있는 상황을 만든다

interface BooleanHarnessProps {
  onCommit: (value: boolean) => void;
}

const BooleanHarness = ({ onCommit }: BooleanHarnessProps) => {
  const hostRef = useRef<HTMLButtonElement>(null);
  const { value, toggle } = useOptimisticBooleanCommit({
    canonicalValue: false,
    onCommit,
    strategy: 'after-paint',
    frameHostRef: hostRef,
  });
  return (
    <button
      ref={hostRef}
      type="button"
      data-host="true"
      aria-pressed={value}
      onClick={toggle}
    />
  );
};

interface ValueHarnessProps {
  onCommit: (value: string) => void;
}

const ValueHarness = ({ onCommit }: ValueHarnessProps) => {
  const hostRef = useRef<HTMLButtonElement>(null);
  const { value, select } = useOptimisticValueCommit({
    canonicalValue: 'a',
    onCommit,
    strategy: 'after-paint',
    frameHostRef: hostRef,
  });
  return (
    <button
      ref={hostRef}
      type="button"
      data-host="true"
      data-value={value}
      onClick={() => select('b')}
    />
  );
};

describe('낙관 커밋 훅 자식 창', () => {
  let frame: HTMLIFrameElement;
  let childDoc: Document;
  let childWin: Window & typeof globalThis;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let mainRaf: ReturnType<typeof vi.fn>;
  let mainSetTimeout: ReturnType<typeof vi.fn>;
  let mainTimers: Map<number, () => void>;
  let nextMainTimerId: number;
  let childRaf: ReturnType<typeof vi.fn>;
  let childRafCallbacks: Map<number, FrameRequestCallback>;
  let nextChildRafId: number;
  let childTimers: Map<number, () => void>;
  let childSetTimeout: ReturnType<typeof vi.fn>;
  let nextChildTimerId: number;

  const host = () => container.querySelector<HTMLElement>('[data-host]')!;

  const flushChildRaf = () => {
    const pending = [...childRafCallbacks.values()];
    childRafCallbacks.clear();
    act(() => pending.forEach((callback) => callback(performance.now())));
  };

  const flushChildTimers = () => {
    const pending = [...childTimers.values()];
    childTimers.clear();
    act(() => pending.forEach((callback) => callback()));
  };

  // 메인 큐도 삼키지 않고 실제로 돌린다. 라이브러리가 건 타이머까지 죽이면
  // 커밋이 메인 큐에 실렸는지 여부를 이 테스트로 가릴 수 없다
  const flushMainTimers = () => {
    const pending = [...mainTimers.values()];
    mainTimers.clear();
    act(() => pending.forEach((callback) => callback()));
  };

  const click = () =>
    act(() => {
      host().dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    });

  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };

  beforeEach(() => {
    mainRaf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', mainRaf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mainTimers = new Map();
    nextMainTimerId = 1;
    mainSetTimeout = vi.fn((callback: () => void) => {
      const id = nextMainTimerId;
      nextMainTimerId += 1;
      mainTimers.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'setTimeout').mockImplementation(
      mainSetTimeout as unknown as typeof window.setTimeout,
    );
    vi.spyOn(window, 'clearTimeout').mockImplementation(((id: number) => {
      mainTimers.delete(id);
    }) as typeof window.clearTimeout);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    childDoc = frame.contentDocument!;
    childWin = frame.contentWindow as Window & typeof globalThis;

    childRafCallbacks = new Map();
    nextChildRafId = 1;
    childRaf = vi.fn((callback: FrameRequestCallback) => {
      const id = nextChildRafId;
      nextChildRafId += 1;
      childRafCallbacks.set(id, callback);
      return id;
    });
    childWin.requestAnimationFrame = childRaf as typeof requestAnimationFrame;
    childWin.cancelAnimationFrame = (id: number) => {
      childRafCallbacks.delete(id);
    };

    childTimers = new Map();
    nextChildTimerId = 1;
    childSetTimeout = vi.fn((callback: () => void) => {
      const id = nextChildTimerId;
      nextChildTimerId += 1;
      childTimers.set(id, callback);
      return id;
    });
    childWin.setTimeout = childSetTimeout as unknown as typeof setTimeout;
    childWin.clearTimeout = ((id: number) => {
      childTimers.delete(id);
    }) as typeof clearTimeout;

    container = childDoc.createElement('div');
    childDoc.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    unmount();
    container.remove();
    frame.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('토글 커밋은 자식 창 프레임과 타이머를 탄다', () => {
    const onCommit = vi.fn();
    act(() => root.render(<BooleanHarness onCommit={onCommit} />));

    click();
    // 표시값은 즉시 뒤집히고 커밋만 미뤄진다
    expect(host().getAttribute('aria-pressed')).toBe('true');
    expect(childRaf).toHaveBeenCalledTimes(1);
    expect(mainRaf).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    flushChildRaf();
    expect(childSetTimeout).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    // 메인 큐를 다 돌려도 커밋은 오지 않는다
    flushMainTimers();
    expect(onCommit).not.toHaveBeenCalled();

    flushChildTimers();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('선택 커밋도 자식 창 프레임과 타이머를 탄다', () => {
    const onCommit = vi.fn();
    act(() => root.render(<ValueHarness onCommit={onCommit} />));

    click();
    expect(host().getAttribute('data-value')).toBe('b');
    expect(childRaf).toHaveBeenCalledTimes(1);
    expect(mainRaf).not.toHaveBeenCalled();

    flushChildRaf();
    expect(childSetTimeout).toHaveBeenCalledTimes(1);

    flushMainTimers();
    expect(onCommit).not.toHaveBeenCalled();

    flushChildTimers();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('프레임 전에 언마운트돼도 토글은 한 번 커밋된다', () => {
    const onCommit = vi.fn();
    act(() => root.render(<BooleanHarness onCommit={onCommit} />));

    click();
    expect(() => unmount()).not.toThrow();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(true);
    // 걷힌 프레임·타이머가 뒤늦게 돌아도 두 번 커밋되지 않는다
    flushChildRaf();
    flushChildTimers();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('프레임 전에 언마운트돼도 선택은 한 번 커밋된다', () => {
    const onCommit = vi.fn();
    act(() => root.render(<ValueHarness onCommit={onCommit} />));

    click();
    expect(() => unmount()).not.toThrow();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('b');
    flushChildRaf();
    flushChildTimers();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
