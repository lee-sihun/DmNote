// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CounterAnimationEditorModal from './CounterAnimationEditorModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const preview = vi.hoisted(() => ({
  countDisplayProps: null as Record<string, unknown> | null,
}));

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
  default: (props: Record<string, unknown>) => {
    preview.countDisplayProps = props;
    return <span data-testid="counter-animation-preview-count" />;
  },
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
  let resizeCallback: ResizeObserverCallback;

  beforeEach(() => {
    preview.countDisplayProps = null;
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
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

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
  const p1Visual = () => p1().nextElementSibling as SVGCircleElement;

  it('캔버스 실측 전에도 베지어 좌표계를 비균등 확대하지 않는다', () => {
    const svg = host.querySelector<SVGSVGElement>(
      '[data-counter-bezier-editor="true"]',
    )!;

    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('미리보기는 기본 fallback을 전달하고 press·release 순서로 count와 active를 갱신한다', () => {
    const key = host.querySelector<HTMLElement>('[data-key-element="true"]')!;
    const scope = host.querySelector<HTMLElement>(
      '[data-dmn-user-css-scope=""]',
    )!;
    const stage = scope.parentElement!;

    expect(preview.countDisplayProps).toMatchObject({
      count: 0,
      active: false,
      globalKey: 'preview',
      animationEnabled: true,
      animationBezier: [0.25, 0.46, 0.45, 0.94],
      animationScale: 1.1,
      animationDurationMs: 300,
    });
    expect(key.getAttribute('data-state')).toBe('inactive');
    expect(key.getAttribute('data-key-element')).toBe('true');
    expect(key.hasAttribute('data-key-image')).toBe(false);
    expect(stage.textContent).toContain('counterSetting.pressToPreview');

    act(() => stage.dispatchEvent(pointerEvent('pointerdown', 100, 100)));
    expect(preview.countDisplayProps).toMatchObject({
      count: 1,
      active: true,
    });
    expect(key.getAttribute('data-state')).toBe('active');

    act(() => window.dispatchEvent(pointerEvent('pointerup', 100, 100)));
    expect(preview.countDisplayProps).toMatchObject({
      count: 1,
      active: false,
    });
    expect(key.getAttribute('data-state')).toBe('inactive');
  });

  it('가로형 캔버스 실측 뒤에는 같은 비율의 풀블리드 viewBox를 쓴다', () => {
    const svg = host.querySelector<SVGSVGElement>(
      '[data-counter-bezier-editor="true"]',
    )!;
    const area = svg.parentElement!;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 440,
      height: 220,
      right: 440,
      bottom: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => resizeCallback([], {} as ResizeObserver));

    const [, , viewWidth, viewHeight] = svg
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number);
    expect(viewWidth / viewHeight).toBeCloseTo(2);
  });

  it('가로형 캔버스에서도 손잡이의 기존 화면 크기를 유지한다', () => {
    const svg = host.querySelector<SVGSVGElement>(
      '[data-counter-bezier-editor="true"]',
    )!;
    const area = svg.parentElement!;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 440,
      height: 220,
      right: 440,
      bottom: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => resizeCallback([], {} as ResizeObserver));

    const [, , , viewHeight] = svg
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number);
    const screenScale = 220 / viewHeight;
    const visualRadius = Number(p1Visual().getAttribute('r')) * screenScale;
    const strokeWidth =
      Number(p1Visual().getAttribute('stroke-width')) * screenScale;
    const hitRadius = Number(p1().getAttribute('r')) * screenScale;

    expect(visualRadius).toBeCloseTo(6);
    expect(strokeWidth).toBeCloseTo(2);
    expect(hitRadius).toBeCloseTo(10);
  });

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
