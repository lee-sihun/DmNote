/**
 * 젤리 노브 스프링 복원력 계약
 * - 트랙이 숨겨져 크기가 0으로 측정되면 (0,0)에 박제하지 않는다
 * - 다시 보일 때 visibility/focus 재개 신호가 실측 좌표로 정착시킨다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GooeyThumb from '@components/main/Modal/content/pickers/color/GooeyThumb';
import { createGooeyPath } from '@utils/ui/gooeyPath';

describe('젤리 노브 벡터 경로', () => {
  it('정착 상태는 필터 없이 정확한 원호 두 개로 닫는다', () => {
    const path = createGooeyPath({
      bodyRadius: 6,
      tailX: 0,
      tailY: 0,
      tailRadius: 0,
    });

    expect(path).not.toContain('C ');
    expect(path.match(/A 6 6/g)).toHaveLength(2);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('꼬리가 드러나면 유한한 Bézier 연결 경로를 만든다', () => {
    const path = createGooeyPath({
      bodyRadius: 6,
      tailX: -8,
      tailY: 2,
      tailRadius: 2.5,
    });

    expect(path).toContain('C ');
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('스프링이 만들 수 있는 거리·각도 범위에서 경로가 퇴화하지 않는다', () => {
    for (const tailRadius of [0.4, 1, 2, 3]) {
      for (const distance of [0.5, 3, 6, 9, 12]) {
        for (const angle of [0, Math.PI / 3, Math.PI, Math.PI * 1.75]) {
          const path = createGooeyPath({
            bodyRadius: 6,
            tailX: Math.cos(angle) * distance,
            tailY: Math.sin(angle) * distance,
            tailRadius,
          });
          expect(path).not.toMatch(/NaN|Infinity/);
          expect(path.endsWith('Z')).toBe(true);
        }
      }
    }
  });
});

describe('GooeyThumb 스프링 복원력', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rafQueue: FrameRequestCallback[];

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const bodyGroup = () => host.querySelector('svg > g') as SVGGElement | null;

  it('크기 0(숨김) 측정에서는 도형을 드러내지 않는다', () => {
    act(() => {
      root.render(<GooeyThumb x={0.5} y={0.5} size={20} color="#fff" />);
    });
    // jsdom 기본 clientWidth/Height는 0 - 숨김과 동일 조건
    const g = bodyGroup();
    expect(g?.style.visibility).toBe('hidden');
    expect(g?.style.transform).toBe('');
  });

  it('다시 보이면 focus 재개 신호로 실측 좌표에 정착한다', () => {
    act(() => {
      root.render(<GooeyThumb x={0.5} y={0.5} size={20} color="#fff" />);
    });
    const svg = host.querySelector('svg') as SVGSVGElement;
    Object.defineProperty(svg, 'clientWidth', { value: 100 });
    Object.defineProperty(svg, 'clientHeight', { value: 60 });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    // 미초기화 상태의 wake는 즉시 snap - 본체가 목표(50,30)으로 이동해 드러난다
    const g = bodyGroup();
    expect(g?.style.visibility).toBe('visible');
    expect(g?.style.transform).toBe('translate(50px, 30px)');
  });

  it('보이는 실루엣은 필터 없는 SVG path이고 그림자만 필터 처리한다', () => {
    act(() => {
      root.render(
        <GooeyThumb x={0.5} y={0.5} size={14} color="#ef4444" checker />,
      );
    });

    const body = host.querySelector('[data-dmn-gooey-body]');
    const shadow = host.querySelector('use[filter]');
    expect(body?.closest('svg')).not.toBeNull();
    expect(body?.getAttribute('filter')).toBeNull();
    expect(body?.getAttribute('shape-rendering')).toBe('geometricPrecision');
    expect(body?.getAttribute('stroke')).toBe('#fff');
    expect(shadow?.getAttribute('filter')).toMatch(/^url\(#goo-shadow-/);
    expect(host.querySelector('feGaussianBlur')).toBeNull();
    expect(host.querySelector('feColorMatrix')).toBeNull();
  });
});
