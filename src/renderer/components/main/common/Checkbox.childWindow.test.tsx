// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Checkbox from './Checkbox';

// 분리 패널은 opener 자식 창이라 메인 트리가 자식 문서로 DOM을 포털한다.
// 여기 그려진 토글은 리스너·rAF·선택 잠금·스타일 계산을 전부 자식 창에 걸어야 한다.
// iframe으로 같은 힙에 문서와 창이 하나 더 있는 상황을 만든다
const TRACK = { x: 100, y: 0, width: 28, height: 16 };
const THUMB = { width: 12, height: 12 };
const TRAVEL = TRACK.width - THUMB.width - (TRACK.height - THUMB.height);

const rect = (width: number, height: number, left = 0): DOMRect =>
  ({
    x: left,
    y: 0,
    width,
    height,
    left,
    right: left + width,
    top: 0,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect);

describe('Checkbox 자식 창 노브 드래그', () => {
  let frame: HTMLIFrameElement;
  let childDoc: Document;
  let childWin: Window & typeof globalThis;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let mainRaf: ReturnType<typeof vi.fn>;
  let mainRafCallbacks: Map<number, FrameRequestCallback>;
  let nextMainRafId: number;
  let childRaf: ReturnType<typeof vi.fn>;
  let childRafCallbacks: Map<number, FrameRequestCallback>;
  let nextChildRafId: number;
  let mainButton: HTMLButtonElement;
  let mainClick: ReturnType<typeof vi.fn<(event: Event) => void>>;

  const track = () => container.querySelector<HTMLElement>('[role="switch"]')!;
  const thumb = () =>
    container.querySelector<HTMLElement>('.dmn-toggle-thumb')!;

  const flush = (callbacks: Map<number, FrameRequestCallback>) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(performance.now())));
  };

  const flushChildRaf = () => flush(childRafCallbacks);
  const flushMainRaf = () => flush(mainRafCallbacks);

  // 이벤트를 만든 창이 곧 입력이 뜬 창이다
  const pointerEvent = (
    view: Window & typeof globalThis,
    type: string,
    init: Record<string, unknown> = {},
  ) => {
    const event = new view.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    return event;
  };

  const childEvent = (type: string, init: Record<string, unknown> = {}) =>
    pointerEvent(childWin, type, init);

  const send = (type: string, init: Record<string, unknown> = {}) =>
    act(() => {
      track().dispatchEvent(childEvent(type, init));
    });

  const clickChild = () =>
    act(() => {
      track().dispatchEvent(childEvent('click'));
    });

  const render = (checked: boolean, onChange: () => void) => {
    act(() => root.render(<Checkbox checked={checked} onChange={onChange} />));
    vi.spyOn(track(), 'getBoundingClientRect').mockReturnValue(
      rect(TRACK.width, TRACK.height, TRACK.x),
    );
    vi.spyOn(thumb(), 'getBoundingClientRect').mockReturnValue(
      rect(THUMB.width, THUMB.height),
    );
  };

  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };

  beforeEach(() => {
    mainRafCallbacks = new Map();
    nextMainRafId = 1;
    mainRaf = vi.fn((callback: FrameRequestCallback) => {
      const id = nextMainRafId;
      nextMainRafId += 1;
      mainRafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('requestAnimationFrame', mainRaf);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      mainRafCallbacks.delete(id);
    });
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

    // 메인 문서 버튼. 억제가 메인 창에 걸리면 이 버튼의 클릭까지 먹힌다
    mainButton = document.createElement('button');
    mainClick = vi.fn<(event: Event) => void>();
    mainButton.addEventListener('click', mainClick);
    document.body.appendChild(mainButton);
  });

  afterEach(() => {
    unmount();
    mainButton.remove();
    // 도킹을 흉내 낸 테스트는 컨테이너를 메인 문서로 옮긴다
    container.remove();
    frame.remove();
    document.body.style.userSelect = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('반대편까지 끌고 놓은 뒤 자식 창에 click이 와도 한 번만 뒤집는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    act(() => {
      mainButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    clickChild();

    expect(onChange).toHaveBeenCalledOnce();
    expect(mainClick).toHaveBeenCalledOnce();
  });

  it('이동 폭 미만 흔들림은 탭으로 한 번 뒤집는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    // 노브가 이미 왼쪽 끝이라 clamp돼 제자리. 슬롭은 넘지만 이동 폭에는 못 미친다
    send('pointerdown', { clientX: TRACK.x + 20 });
    send('pointermove', { clientX: TRACK.x + 20 - 5 });
    send('pointerup', { clientX: TRACK.x + 20 - 5 });
    clickChild();

    expect(onChange).toHaveBeenCalledOnce();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
  });

  it('드래그 중 메인 창 blur는 세션을 취소하지 않는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + 6 });
    // 자식 창이 포커스를 가져가면 메인 창에 blur가 뜬다. 여기서 끊기면 안 된다
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    // 취소로 걸렸다면 메인 프레임에서 표식이 걷혔을 것이다
    flushMainRaf();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(true);

    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    flushChildRaf();
    // 세션이 살아 있어야 이어지는 이동이 노브에 계속 실린다
    expect(thumb().style.translate).toBe(`${TRAVEL}px 0`);

    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    clickChild();

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('드래그 중 자식 창 blur는 세션을 취소한다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    act(() => {
      childWin.dispatchEvent(new Event('blur'));
    });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    flushChildRaf();

    expect(onChange).not.toHaveBeenCalled();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
  });

  it('드래그 중 선택 잠금은 자식 문서 body에 걸린다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });

    expect(childDoc.body.style.userSelect).toBe('none');
    expect(document.body.style.userSelect).toBe('');

    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });

    expect(childDoc.body.style.userSelect).toBe('');
  });

  it('정산 프레임과 노브 스케줄러는 자식 창의 rAF를 쓴다', () => {
    render(false, vi.fn());

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 10 });
    // 노브 위치는 자식 창 프레임에서 반영된다
    expect(thumb().style.translate).toBe('');
    flushChildRaf();
    expect(thumb().style.translate).toBe('6px 0');

    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
    expect(track().hasAttribute('data-dmn-dragging')).toBe(true);
    flushChildRaf();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);

    expect(childRaf).toHaveBeenCalled();
    expect(mainRaf).not.toHaveBeenCalled();
  });

  // 해제 조건인 다음 입력도 무장한 창에서만 본다. 메인 창 입력으로 풀리면
  // 드래그 직후 자식 창 click이 살아 두 번 뒤집는다
  it('억제 해제는 무장한 창의 입력으로만 걸린다', () => {
    const onChange = vi.fn();
    render(false, onChange);
    const dragAcross = () => {
      send('pointerdown', { clientX: TRACK.x + 4 });
      send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
      send('pointerup', { clientX: TRACK.x + 4 + TRAVEL });
      flushChildRaf();
    };

    dragAcross();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    clickChild();
    expect(onChange).toHaveBeenCalledOnce();

    dragAcross();
    act(() => {
      childWin.dispatchEvent(
        new childWin.KeyboardEvent('keydown', { key: 'Tab' }),
      );
    });
    clickChild();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  // 토글을 쥔 채로 패널이 도킹되면 호스트가 서브트리를 메인 문서로 옮긴다.
  // 떠나온 창은 숨겨져 프레임이 멈추므로 정산은 지금 사는 창에서 돌아야 한다
  it('세션 도중 노브가 옮겨지면 정산 프레임도 옮겨간 창에 건다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    flushChildRaf();
    expect(childDoc.body.style.userSelect).toBe('none');
    expect(thumb().style.translate).toBe(`${TRAVEL}px 0`);

    act(() => {
      document.body.appendChild(document.adoptNode(container));
    });
    act(() => {
      track().dispatchEvent(
        pointerEvent(window, 'pointerup', { clientX: TRACK.x + 4 + TRAVEL }),
      );
    });

    // 떠나온 자식 창 프레임은 정산을 들고 있지 않다
    flushChildRaf();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(true);

    flushMainRaf();
    expect(track().hasAttribute('data-dmn-dragging')).toBe(false);
    expect(thumb().style.translate).toBe('');
    // 잠금은 걸었던 문서에서 풀린다
    expect(childDoc.body.style.userSelect).toBe('');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('자식 문서 요소의 토큰 이동 폭이 실측을 이긴다', () => {
    const onChange = vi.fn();
    render(false, onChange);
    // 토큰 24 > 실측 12. 실측 기준(6px)으로는 넘지만 토큰 기준(12px)으로는 못 넘는 지점
    track().style.setProperty('--ui-toggle-travel', '24');

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + 8 });
    expect(track().className).not.toContain('bg-accent');
    send('pointermove', { clientX: TRACK.x + 4 + 14 });
    expect(track().className).toContain('bg-accent');
  });

  it('언마운트 정리가 자식 창 리스너와 선택 잠금을 걷는다', () => {
    const onChange = vi.fn();
    render(false, onChange);

    send('pointerdown', { clientX: TRACK.x + 4 });
    send('pointermove', { clientX: TRACK.x + 4 + TRAVEL });
    expect(childDoc.body.style.userSelect).toBe('none');

    const node = track();
    unmount();

    expect(childDoc.body.style.userSelect).toBe('');
    expect(node.hasAttribute('data-dmn-dragging')).toBe(false);
    // 걷힌 뒤 자식 창에 남은 입력은 아무 일도 만들지 않는다
    act(() => {
      node.dispatchEvent(childEvent('click'));
      childWin.dispatchEvent(new Event('blur'));
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
