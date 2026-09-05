// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/counter/counterGlyphMetrics', () => ({
  measureCounterGlyphBox: vi.fn(),
}));

import { measureCounterGlyphBox } from '@utils/counter/counterGlyphMetrics';
import { useCounterGlyphPaint } from './useCounterGlyphPaint';
import { useCounterAxisAnchor } from './useCounterAxisAnchor';
import {
  useGradientEditStore,
  type GradientEditSession,
} from '@stores/grid/useGradientEditStore';

const measureMock = vi.mocked(measureCounterGlyphBox);

const session: GradientEditSession = {
  anchor: { kind: 'key', id: 'k1' },
  sessionKey: 'key:k1:counterFill',
  surface: 'counterFill',
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

const rect = (x: number, y: number, width: number, height: number) =>
  ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => undefined,
  } as DOMRect);

const Probe = ({ typography }: { typography: string }) => {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  useCounterGlyphPaint(spanRef, true, 42, typography);
  useCounterAxisAnchor(session, spanRef, 42);
  return (
    <span ref={spanRef} className="counter" data-text="42">
      42
    </span>
  );
};

describe('카운터 글리프 재측정과 축 앵커 동기화', () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalGetRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    // 그리드 공간 마커 (0,0) 기준, 카운터 스팬은 (100,200) 40x20
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-dmn-grid-space')) return rect(0, 0, 800, 600);
      if (this.classList.contains('counter')) return rect(100, 200, 40, 20);
      return rect(0, 0, 0, 0);
    };
    host = document.createElement('div');
    host.setAttribute('data-dmn-grid-space', '');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => useGradientEditStore.getState().setSession(session));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    act(() => useGradientEditStore.getState().setSession(null));
    HTMLElement.prototype.getBoundingClientRect = originalGetRect;
    measureMock.mockReset();
  });

  it('타이포그래피 재측정이 페인트 변수와 앵커 bounds를 함께 갱신한다', () => {
    measureMock.mockReturnValue({ x: 2, y: 3, width: 30, height: 12 });
    act(() => root.render(<Probe typography="16|font|400|false" />));

    const span = host.querySelector<HTMLElement>('.counter')!;
    expect(
      span.style.getPropertyValue('--dmn-counter-fill-position-default'),
    ).toBe('2px 3px');
    expect(useGradientEditStore.getState().anchorBounds).toEqual({
      sessionKey: session.sessionKey,
      bounds: { x: 102, y: 203, width: 30, height: 12 },
      origin: null,
    });

    // 세션 유지 중 폰트 크기 변경 - 앵커가 새 글리프 박스를 따라와야 한다
    measureMock.mockReturnValue({ x: 5, y: 6, width: 20, height: 10 });
    act(() => root.render(<Probe typography="24|font|400|false" />));

    expect(
      span.style.getPropertyValue('--dmn-counter-fill-position-default'),
    ).toBe('5px 6px');
    expect(useGradientEditStore.getState().anchorBounds).toEqual({
      sessionKey: session.sessionKey,
      bounds: { x: 105, y: 206, width: 20, height: 10 },
      origin: null,
    });
  });

  it('측정 실패 시 이전 글리프 박스를 남기지 않고 박스 전체로 폴백한다', () => {
    measureMock.mockReturnValue({ x: 2, y: 3, width: 30, height: 12 });
    act(() => root.render(<Probe typography="16|font|400|false" />));

    measureMock.mockReturnValue(null);
    act(() => root.render(<Probe typography="24|font|400|false" />));

    const span = host.querySelector<HTMLElement>('.counter')!;
    expect(
      span.style.getPropertyValue('--dmn-counter-fill-position-default'),
    ).toBe('');
    expect(span.dataset.dmnGlyphBox).toBeUndefined();
    expect(useGradientEditStore.getState().anchorBounds).toEqual({
      sessionKey: session.sessionKey,
      bounds: { x: 100, y: 200, width: 40, height: 20 },
      origin: null,
    });
  });
});
