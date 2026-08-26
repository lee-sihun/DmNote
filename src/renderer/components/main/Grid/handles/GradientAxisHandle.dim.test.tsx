// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import GradientAxisOverlay from './GradientAxisHandle';
import {
  useGradientEditStore,
  type GradientEditSession,
} from '@stores/grid/useGradientEditStore';
import type { KeyPosition } from '@src/types/key/keys';

const session: GradientEditSession = {
  anchor: { kind: 'key', id: 'k1' },
  sessionKey: 'key:k1:test',
  surface: 'background',
  stateMode: 'idle',
  spec: {
    angle: 90,
    stops: [
      { color: '#000000', pos: 0 },
      { color: '#ffffff', pos: 1 },
    ],
  },
  selectedIndex: 0,
  selectStop: () => undefined,
  apply: () => undefined,
};

const positions = {
  '4key': [{ id: 'k1', dx: 0, dy: 0, width: 60, height: 60 } as KeyPosition],
};

describe('그라데이션 축 오버레이 흐림', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={{}}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    act(() => {
      useGradientEditStore.getState().setColorAdjusting(false);
      useGradientEditStore.getState().setSession(null);
    });
  });

  const axisUi = () =>
    host.querySelector<HTMLElement>('[data-dmn-gradient-axis-ui="true"]');

  it('피커 색 드래그 신호에 따라 조작 UI 묶음이 흐려지고 복원된다', () => {
    act(() => useGradientEditStore.getState().setSession(session));
    expect(axisUi()).not.toBeNull();
    expect(axisUi()!.style.opacity).toBe('1');

    act(() => useGradientEditStore.getState().setColorAdjusting(true));
    expect(axisUi()!.style.opacity).toBe('0.12');

    act(() => useGradientEditStore.getState().setColorAdjusting(false));
    expect(axisUi()!.style.opacity).toBe('1');
  });

  it('축 회전 드래그 동안 조작 UI 묶음이 흐려지고 놓으면 복원된다', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    try {
      act(() => useGradientEditStore.getState().setSession(session));
      const strip = host.querySelector<HTMLElement>('[role="slider"]')!;
      act(() => {
        strip.dispatchEvent(
          pointerEvent('pointerdown', { clientX: 30, clientY: 30 }),
        );
        window.dispatchEvent(
          pointerEvent('pointermove', { clientX: 44, clientY: 30 }),
        );
      });
      // 이동은 프레임당 최신 입력으로 반영 - 대기 프레임 실행
      act(() => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(performance.now()));
      });
      expect(axisUi()!.style.opacity).toBe('0.12');

      act(() => {
        window.dispatchEvent(
          pointerEvent('pointerup', { clientX: 44, clientY: 30 }),
        );
      });
      expect(axisUi()!.style.opacity).toBe('1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
