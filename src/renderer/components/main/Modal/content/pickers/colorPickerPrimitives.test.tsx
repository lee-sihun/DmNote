// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePointerSession } from './colorPickerPrimitives';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';

interface HarnessProps {
  emit: (x: number, y: number, final: boolean) => void;
}

const Harness = ({ emit }: HarnessProps) => {
  const session = usePointerSession(emit);
  return <div data-track="true" {...session} />;
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

  it('드래그 동안 colorAdjusting 신호가 켜지고 종료 시 꺼진다', () => {
    expect(useGradientEditStore.getState().colorAdjusting).toBe(false);
    act(() => {
      track().dispatchEvent(
        pointerEvent('pointerdown', { clientX: 10, clientY: 20 }),
      );
    });
    expect(useGradientEditStore.getState().colorAdjusting).toBe(true);
    act(() => {
      track().dispatchEvent(
        pointerEvent('pointerup', { clientX: 40, clientY: 30 }),
      );
    });
    expect(useGradientEditStore.getState().colorAdjusting).toBe(false);
  });

  it('드래그 중 언마운트돼도 colorAdjusting이 남지 않는다', () => {
    act(() => {
      track().dispatchEvent(
        pointerEvent('pointerdown', { clientX: 10, clientY: 20 }),
      );
    });
    expect(useGradientEditStore.getState().colorAdjusting).toBe(true);
    act(() => root.unmount());
    expect(useGradientEditStore.getState().colorAdjusting).toBe(false);
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
