/**
 * 젤리 노브 스프링 복원력 계약
 * - 트랙이 숨겨져 크기가 0으로 측정되면 (0,0)에 박제하지 않는다
 * - 다시 보일 때 visibility/focus 재개 신호가 실측 좌표로 정착시킨다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GooeyThumb from '@components/main/Modal/content/pickers/GooeyThumb';

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
});
