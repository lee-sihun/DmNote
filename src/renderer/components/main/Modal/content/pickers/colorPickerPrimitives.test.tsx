// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePointerSession } from './colorPickerPrimitives';

interface HarnessProps {
  emit: (x: number, y: number, final: boolean) => void;
}

const Harness = ({ emit }: HarnessProps) => {
  const session = usePointerSession(emit);
  return <div data-track="true" {...session} />;
};

// 입력 blur가 바꾼 상태를 첫 emit이 읽어야 한다 (hex 확정 뒤 트랙 드래그)
const BlurCommitHarness = ({
  emit,
}: {
  emit: (hue: number, final: boolean) => void;
}) => {
  const [hue, setHue] = React.useState(0);
  const session = usePointerSession((_x, _y, final) => emit(hue, final));
  return (
    <div role="dialog">
      <input onBlur={() => setHue(120)} />
      <div data-track="true" {...session} />
    </div>
  );
};

const pointerEvent = (
  type: string,
  { clientX, clientY }: { clientX: number; clientY: number },
) => {
  const event = new MouseEvent(type, {
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

describe('색상 트랙 pointer session', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;
  let emit: ReturnType<
    typeof vi.fn<(x: number, y: number, final: boolean) => void>
  >;

  beforeEach(() => {
    callbacks = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    emit = vi.fn<(x: number, y: number, final: boolean) => void>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness emit={emit} />));
    const track = host.querySelector<HTMLElement>('[data-track="true"]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 100,
      height: 50,
      right: 110,
      bottom: 70,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    Object.defineProperties(track, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const track = () => host.querySelector<HTMLElement>('[data-track="true"]')!;

  it('연속 pointermove를 프레임당 최신 비율 한 번으로 병합한다', () => {
    act(() => {
      track().dispatchEvent(
        pointerEvent('pointerdown', { clientX: 10, clientY: 20 }),
      );
      track().dispatchEvent(
        pointerEvent('pointermove', { clientX: 40, clientY: 30 }),
      );
      track().dispatchEvent(
        pointerEvent('pointermove', { clientX: 90, clientY: 60 }),
      );
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });
    expect(emit).toHaveBeenLastCalledWith(0.8, 0.8, false);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('pointerup은 대기 프레임을 취소하고 최종 좌표를 한 번 커밋한다', () => {
    act(() => {
      track().dispatchEvent(
        pointerEvent('pointerdown', { clientX: 10, clientY: 20 }),
      );
      track().dispatchEvent(
        pointerEvent('pointermove', { clientX: 40, clientY: 30 }),
      );
      track().dispatchEvent(
        pointerEvent('pointerup', { clientX: 110, clientY: 70 }),
      );
    });

    expect(callbacks).toHaveLength(0);
    expect(emit).toHaveBeenLastCalledWith(1, 1, true);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

// 드래그 시작은 텍스트 편집을 끝낸다. 첫 preview보다 먼저 blur해야
// 입력 쪽 확정이 슬라이더 값을 나중에 덮지 않는다
describe('색상 트랙 pointerdown과 활성 입력', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const mockTrack = () => {
    const track = host.querySelector<HTMLElement>('[data-track="true"]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 10,
      right: 100,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperties(track, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });
    return track;
  };

  it('blur가 확정한 상태에서 첫 preview가 출발한다', () => {
    const emit = vi.fn<(hue: number, final: boolean) => void>();
    act(() => root.render(<BlurCommitHarness emit={emit} />));
    const input = host.querySelector('input')!;
    const track = mockTrack();

    act(() => input.focus());
    act(() => {
      track.dispatchEvent(
        pointerEvent('pointerdown', { clientX: 50, clientY: 5 }),
      );
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(120, false);
  });

  it('팝업 밖의 입력은 건드리지 않는다', () => {
    const emit = vi.fn();
    act(() => root.render(<BlurCommitHarness emit={emit} />));
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const track = mockTrack();

    outside.focus();
    act(() => {
      track.dispatchEvent(
        pointerEvent('pointerdown', { clientX: 50, clientY: 5 }),
      );
    });

    expect(document.activeElement).toBe(outside);
    expect(emit).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it('활성 input을 첫 preview 전에 blur한다', () => {
    const order: string[] = [];
    const emit = vi.fn(() => order.push('emit'));
    act(() => root.render(<Harness emit={emit} />));
    // render가 host의 기존 자식을 지우므로 입력은 그 뒤에 붙인다
    const input = document.createElement('input');
    host.appendChild(input);
    input.addEventListener('blur', () => order.push('blur'));
    const track = host.querySelector<HTMLElement>('[data-track="true"]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 10,
      right: 100,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperties(track, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });

    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      track.dispatchEvent(
        pointerEvent('pointerdown', { clientX: 50, clientY: 5 }),
      );
    });

    expect(document.activeElement).not.toBe(input);
    expect(order).toEqual(['blur', 'emit']);
  });
});
