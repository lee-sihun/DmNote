// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePressGatedSwap } from './usePressGatedSwap';

// 분리 패널은 opener 자식 창이라 메인 트리가 자식 문서로 DOM을 포털한다.
// 표식을 걷는 더블 rAF가 메인 창에 걸리면 그 창이 가려졌을 때 표식이 눌러붙는다.
// iframe으로 같은 힙에 문서와 창이 하나 더 있는 상황을 만든다
const Harness = ({ value }: { value: boolean }) => {
  const { ref } = usePressGatedSwap<HTMLButtonElement>(value);
  return (
    <button ref={ref} type="button" data-host="true">
      {String(value)}
    </button>
  );
};

// 밖에서 만든 ref를 나눠 쓰는 소비자(Checkbox·PanelToggleButton) 경로
const SharedRefHarness = ({ value }: { value: boolean }) => {
  const hostRef = useRef<HTMLButtonElement>(null);
  usePressGatedSwap<HTMLButtonElement>(value, hostRef);
  return (
    <button ref={hostRef} type="button" data-host="true">
      {String(value)}
    </button>
  );
};

describe('usePressGatedSwap 자식 창', () => {
  let frame: HTMLIFrameElement;
  let childDoc: Document;
  let childWin: Window & typeof globalThis;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let mainRaf: ReturnType<typeof vi.fn>;
  let mainCancelRaf: ReturnType<typeof vi.fn>;
  let childRaf: ReturnType<typeof vi.fn>;
  let childCancelled: number[];
  let childRafCallbacks: Map<number, FrameRequestCallback>;
  let nextChildRafId: number;

  const host = () => container.querySelector<HTMLElement>('[data-host]')!;

  const flushChildRaf = () => {
    const pending = [...childRafCallbacks.values()];
    childRafCallbacks.clear();
    act(() => pending.forEach((callback) => callback(performance.now())));
  };

  const render = (value: boolean) =>
    act(() => root.render(<Harness value={value} />));

  const renderShared = (value: boolean) =>
    act(() => root.render(<SharedRefHarness value={value} />));

  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };

  beforeEach(() => {
    mainRaf = vi.fn(() => 1);
    mainCancelRaf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', mainRaf);
    vi.stubGlobal('cancelAnimationFrame', mainCancelRaf);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    childDoc = frame.contentDocument!;
    childWin = frame.contentWindow as Window & typeof globalThis;
    childRafCallbacks = new Map();
    childCancelled = [];
    nextChildRafId = 1;
    childRaf = vi.fn((callback: FrameRequestCallback) => {
      const id = nextChildRafId;
      nextChildRafId += 1;
      childRafCallbacks.set(id, callback);
      return id;
    });
    childWin.requestAnimationFrame = childRaf as typeof requestAnimationFrame;
    childWin.cancelAnimationFrame = (id: number) => {
      childCancelled.push(id);
      childRafCallbacks.delete(id);
    };

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

  it('클릭 없는 변경 표식은 자식 창 더블 rAF로 걷는다', () => {
    render(false);
    expect(host().hasAttribute('data-dmn-instant')).toBe(false);

    render(true);
    expect(host().hasAttribute('data-dmn-instant')).toBe(true);
    expect(mainRaf).not.toHaveBeenCalled();

    // 더블 rAF - 첫 프레임에서는 아직 살아 있다
    flushChildRaf();
    expect(host().hasAttribute('data-dmn-instant')).toBe(true);

    flushChildRaf();
    expect(host().hasAttribute('data-dmn-instant')).toBe(false);
    expect(mainRaf).not.toHaveBeenCalled();
  });

  it('직접 클릭에서 온 변경에는 표식을 붙이지 않는다', () => {
    render(false);
    act(() => {
      host().dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    });
    render(true);

    expect(host().hasAttribute('data-dmn-instant')).toBe(false);
    expect(childRaf).not.toHaveBeenCalled();
  });

  it('연이은 변경은 앞선 프레임을 예약한 창에서 취소한다', () => {
    render(false);
    render(true);
    const [firstId] = [...childRafCallbacks.keys()];

    render(false);
    expect(childCancelled).toContain(firstId);
    expect(mainCancelRaf).not.toHaveBeenCalled();
  });

  it('밖에서 받은 ref로도 자식 창 프레임을 쓴다', () => {
    renderShared(false);
    expect(host().hasAttribute('data-dmn-instant')).toBe(false);

    renderShared(true);
    expect(host().hasAttribute('data-dmn-instant')).toBe(true);
    expect(childRaf).toHaveBeenCalled();
    expect(mainRaf).not.toHaveBeenCalled();

    flushChildRaf();
    flushChildRaf();
    expect(host().hasAttribute('data-dmn-instant')).toBe(false);
    expect(mainRaf).not.toHaveBeenCalled();
  });

  it('언마운트 정리도 자식 창 프레임을 취소한다', () => {
    render(false);
    render(true);
    const [pendingId] = [...childRafCallbacks.keys()];

    unmount();

    expect(childCancelled).toContain(pendingId);
    expect(mainCancelRaf).not.toHaveBeenCalled();
  });
});
