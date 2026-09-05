// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CounterAnimationCurveCanvas from './CounterAnimationCurveCanvas';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pointerEvent = () => {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
};

describe('CounterAnimationCurveCanvas', () => {
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
  });

  it('SVG 구조·좌표·ref와 입력 핸들러 계약을 유지한다', () => {
    const editorAreaRef = vi.fn();
    const svgRef = createRef<SVGSVGElement>();
    const onWheel = vi.fn();
    const onPointerDown = vi.fn();
    const onDoubleClick = vi.fn();
    const handleTargets: string[] = [];

    act(() => {
      root.render(
        <CounterAnimationCurveCanvas
          editorAreaRef={editorAreaRef}
          svgRef={svgRef}
          bezier={[0.25, 0.46, 0.45, 0.94]}
          editorSize={{ width: 220, height: 220 }}
          viewOffset={{ x: 0, y: 0 }}
          viewScale={1}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onHandlePointerDown={(_event, target) => {
            handleTargets.push(target);
          }}
        />,
      );
    });

    const svg = host.querySelector<SVGSVGElement>(
      '[data-counter-bezier-editor="true"]',
    )!;
    const area = svg.parentElement as HTMLDivElement;
    expect(svgRef.current).toBe(svg);
    expect(editorAreaRef).toHaveBeenCalledWith(area);
    expect(svg.getAttribute('viewBox')).toBe('0 0 150 150');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(
      Array.from(svg.children).map((node) => node.tagName.toLowerCase()),
    ).toEqual([
      'rect',
      'path',
      'path',
      'rect',
      'line',
      'line',
      'line',
      'path',
      'circle',
      'circle',
      'circle',
      'circle',
    ]);

    const p1 = svg.querySelector<SVGCircleElement>(
      '[data-counter-bezier-handle="p1"]',
    )!;
    const p2 = svg.querySelector<SVGCircleElement>(
      '[data-counter-bezier-handle="p2"]',
    )!;
    expect(p1.getAttribute('cx')).toBe('47.5');
    expect(p1.getAttribute('cy')).toBe('79.4');
    expect(Number(p1.getAttribute('r'))).toBeCloseTo((10 * 150) / 220);
    expect(Number(p1.nextElementSibling!.getAttribute('r'))).toBeCloseTo(
      (6 * 150) / 220,
    );
    expect(p2.getAttribute('cx')).toBe('69.5');
    expect(
      Number(p2.nextElementSibling!.getAttribute('stroke-width')),
    ).toBeCloseTo((2 * 150) / 220);

    act(() => {
      svg.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true }),
      );
      svg.dispatchEvent(pointerEvent());
      svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      p1.dispatchEvent(pointerEvent());
      p2.dispatchEvent(pointerEvent());
    });

    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalled();
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
    expect(handleTargets).toEqual(['p1', 'p2']);
  });
});
