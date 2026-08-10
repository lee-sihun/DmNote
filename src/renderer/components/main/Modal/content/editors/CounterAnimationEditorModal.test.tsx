// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CounterAnimationEditorModal from './CounterAnimationEditorModal';

vi.mock('@components/main/Modal/FullSurfaceModalLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@components/main/common/Dropdown', () => ({
  default: () => null,
}));
vi.mock('@components/main/Grid/PropertiesPanel/PropertyInputs', () => ({
  TextInput: () => null,
  NumberInput: () => null,
}));
vi.mock('@components/overlay/counters/CountDisplay', () => ({
  default: () => null,
}));

const pointerEvent = (type: string, clientX: number, clientY: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
};

describe('CounterAnimationEditorModal 베지어 드래그', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    callbacks = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        css: {
          get: vi.fn().mockResolvedValue({ content: '' }),
          getUse: vi.fn().mockResolvedValue(false),
          tab: { getAll: vi.fn().mockResolvedValue({}) },
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <CounterAnimationEditorModal
          isOpen
          mode="create"
          onClose={() => undefined}
          onSaved={() => undefined}
          t={(key) => key}
        />,
      );
    });
    const svg = host.querySelector<SVGSVGElement>(
      '[data-counter-bezier-editor="true"]',
    )!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 220,
      height: 220,
      right: 220,
      bottom: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const p1 = () =>
    host.querySelector<SVGCircleElement>('[data-counter-bezier-handle="p1"]')!;

  it('연속 pointermove의 최신 좌표만 한 프레임에 반영한다', () => {
    act(() => {
      p1().dispatchEvent(pointerEvent('pointerdown', 47.5, 79.4));
      window.dispatchEvent(pointerEvent('pointermove', 44, 110));
      window.dispatchEvent(pointerEvent('pointermove', 110, 110));
    });

    expect(callbacks).toHaveLength(1);
    expect(Number(p1().getAttribute('cx'))).toBeCloseTo(47.5);
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });
    expect(Number(p1().getAttribute('cx'))).toBeCloseTo(75);
    act(() => window.dispatchEvent(pointerEvent('pointerup', 110, 110)));
  });

  it('프레임 전에 pointerup하면 마지막 좌표를 flush한다', () => {
    act(() => {
      p1().dispatchEvent(pointerEvent('pointerdown', 47.5, 79.4));
      window.dispatchEvent(pointerEvent('pointermove', 110, 110));
      window.dispatchEvent(pointerEvent('pointerup', 110, 110));
    });

    expect(Number(p1().getAttribute('cx'))).toBeCloseTo(75);
  });

  // 드래그의 preventDefault가 포커스를 남긴다. 편집 세션을 안 끊으면
  // 뒤이은 Escape가 드래그 결과까지 함께 되돌린다
  it('드래그를 시작하면 포커스된 입력의 편집 세션을 끊는다', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => p1().dispatchEvent(pointerEvent('pointerdown', 47.5, 79.4)));

    expect(document.activeElement).not.toBe(input);

    act(() => window.dispatchEvent(pointerEvent('pointerup', 47.5, 79.4)));
    input.remove();
  });
});
