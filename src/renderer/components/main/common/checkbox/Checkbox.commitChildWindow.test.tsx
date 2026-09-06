// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Checkbox from './Checkbox';

// 분리 패널은 opener 자식 창이라 메인 트리가 자식 문서로 DOM을 포털한다.
// after-paint 커밋이 메인 프레임에 걸리면 메인이 가려진 동안 토글이 저장되지 않는다.
// iframe으로 같은 힙에 문서와 창이 하나 더 있는 상황을 만든다
describe('Checkbox 자식 창 after-paint 커밋', () => {
  let frame: HTMLIFrameElement;
  let childDoc: Document;
  let childWin: Window & typeof globalThis;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let mainRaf: ReturnType<typeof vi.fn>;
  let childRaf: ReturnType<typeof vi.fn>;
  let childRafCallbacks: Map<number, FrameRequestCallback>;
  let nextChildRafId: number;
  let childTimers: Map<number, () => void>;
  let nextChildTimerId: number;

  const track = () => container.querySelector<HTMLElement>('[role="switch"]')!;

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

  const clickChild = () =>
    act(() => {
      track().dispatchEvent(
        new childWin.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
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
    childWin.setTimeout = ((callback: () => void) => {
      const id = nextChildTimerId;
      nextChildTimerId += 1;
      childTimers.set(id, callback);
      return id;
    }) as unknown as typeof setTimeout;
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

  const render = (onChange: () => void) =>
    act(() =>
      root.render(
        <Checkbox
          checked={false}
          onChange={onChange}
          commitStrategy="after-paint"
        />,
      ),
    );

  it('클릭 커밋은 자식 창 프레임을 타고 한 번만 발화한다', () => {
    const onChange = vi.fn();
    render(onChange);

    clickChild();
    // 표시값은 즉시 뒤집히고 커밋만 미뤄진다
    expect(track().getAttribute('aria-checked')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();

    flushChildRaf();
    flushChildTimers();

    expect(onChange).toHaveBeenCalledOnce();
    expect(mainRaf).not.toHaveBeenCalled();
  });

  it('커밋 프레임 전에 언마운트돼도 한 번은 커밋된다', () => {
    const onChange = vi.fn();
    render(onChange);

    clickChild();
    expect(() => unmount()).not.toThrow();

    expect(onChange).toHaveBeenCalledOnce();
    flushChildRaf();
    flushChildTimers();
    expect(onChange).toHaveBeenCalledOnce();
    expect(mainRaf).not.toHaveBeenCalled();
  });
});
