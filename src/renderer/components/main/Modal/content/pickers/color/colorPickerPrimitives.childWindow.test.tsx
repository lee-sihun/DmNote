// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePointerSession } from './colorPickerPrimitives';

// 분리 패널은 opener 자식 창이라 메인 트리가 자식 문서로 DOM을 포털한다.
// 거기 그려진 색 트랙은 취소 사유가 되는 blur도, 프리뷰 프레임도 자기 창에서 봐야 한다.
// iframe으로 같은 힙에 문서와 창이 하나 더 있는 상황을 만든다
const TRACK = { left: 10, top: 20, width: 100, height: 50 };

interface HarnessProps {
  emit: (x: number, y: number, final: boolean) => void;
}

const Harness = ({ emit }: HarnessProps) => {
  const session = usePointerSession(emit);
  return <div data-track="true" {...session} />;
};

describe('색상 트랙 pointer session 자식 창', () => {
  let frame: HTMLIFrameElement;
  let childDoc: Document;
  let childWin: Window & typeof globalThis;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let emit: ReturnType<
    typeof vi.fn<(x: number, y: number, final: boolean) => void>
  >;
  let mainRaf: ReturnType<typeof vi.fn>;
  let childRaf: ReturnType<typeof vi.fn>;
  let childRafCallbacks: Map<number, FrameRequestCallback>;
  let nextChildRafId: number;

  const track = () => container.querySelector<HTMLElement>('[data-track]')!;

  const flushChildRaf = () => {
    const pending = [...childRafCallbacks.values()];
    childRafCallbacks.clear();
    act(() => pending.forEach((callback) => callback(performance.now())));
  };

  // 이벤트를 만든 창이 곧 입력이 뜬 창이다
  const childEvent = (type: string, clientX: number, clientY: number) => {
    const event = new childWin.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX,
      clientY,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    return event;
  };

  const send = (type: string, clientX: number, clientY: number) =>
    act(() => {
      track().dispatchEvent(childEvent(type, clientX, clientY));
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

    container = childDoc.createElement('div');
    childDoc.body.appendChild(container);
    root = createRoot(container);
    mounted = true;

    emit = vi.fn<(x: number, y: number, final: boolean) => void>();
    act(() => root.render(<Harness emit={emit} />));

    const node = track();
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      left: TRACK.left,
      top: TRACK.top,
      width: TRACK.width,
      height: TRACK.height,
      right: TRACK.left + TRACK.width,
      bottom: TRACK.top + TRACK.height,
      x: TRACK.left,
      y: TRACK.top,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperties(node, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: vi.fn(() => true), configurable: true },
      releasePointerCapture: { value: vi.fn(), configurable: true },
    });
  });

  afterEach(() => {
    unmount();
    container.remove();
    frame.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('메인 창 blur는 세션을 끝내지 않는다', () => {
    send('pointerdown', TRACK.left, TRACK.top);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(0, 0, false);

    // 자식 창이 포커스를 가져가면 메인 창에 blur가 뜬다. 여기서 커밋하면 안 된다
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(emit).toHaveBeenCalledTimes(1);

    // 세션이 살아 있어야 이어지는 이동이 계속 실린다
    send('pointermove', TRACK.left + 50, TRACK.top + 25);
    flushChildRaf();
    expect(emit).toHaveBeenLastCalledWith(0.5, 0.5, false);
  });

  it('자식 창 blur는 세션을 한 번만 끝낸다', () => {
    send('pointerdown', TRACK.left + 25, TRACK.top + 10);
    emit.mockClear();

    act(() => {
      childWin.dispatchEvent(new Event('blur'));
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(0.25, 0.2, true);

    // 뒤늦게 온 메인 창 blur는 아무것도 만들지 않는다
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('프리뷰는 자식 창 프레임에 실린다', () => {
    send('pointerdown', TRACK.left, TRACK.top);
    emit.mockClear();

    send('pointermove', TRACK.left + 50, TRACK.top + 25);
    // 프레임 전에는 아직 반영되지 않는다
    expect(emit).not.toHaveBeenCalled();
    expect(childRaf).toHaveBeenCalled();
    expect(mainRaf).not.toHaveBeenCalled();

    flushChildRaf();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(0.5, 0.5, false);
  });

  it('blur 리스너는 자식 창에 걸고 종료 때 같은 창에서 걷는다', () => {
    const addSpy = vi.spyOn(childWin, 'addEventListener');
    const removeSpy = vi.spyOn(childWin, 'removeEventListener');
    const blurOf = (spy: typeof addSpy) =>
      spy.mock.calls.filter(([type]) => type === 'blur');

    send('pointerdown', TRACK.left, TRACK.top);
    expect(blurOf(addSpy)).toHaveLength(1);
    expect(blurOf(removeSpy)).toHaveLength(0);

    send('pointerup', TRACK.left + 100, TRACK.top + 50);
    expect(emit).toHaveBeenLastCalledWith(1, 1, true);
    // 건 핸들러를 그대로 같은 창에서 걷는다
    expect(blurOf(removeSpy)).toHaveLength(1);
    expect(blurOf(removeSpy)[0][1]).toBe(blurOf(addSpy)[0][1]);
  });
});
