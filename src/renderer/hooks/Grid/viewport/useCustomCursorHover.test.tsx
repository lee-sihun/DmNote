import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lockCustomCursor,
  resumeCustomCursorHover,
  setCustomCursorHover,
  setPendingCustomCursorHover,
  suspendCustomCursorHover,
  unlockCustomCursor,
  type CursorType,
} from '@utils/grid/cursorUtils';
import { useCustomCursorHover } from './useCustomCursorHover';

vi.mock('@utils/core/platform', () => ({ isMac: () => true }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HoverHandle = ({ cursor }: { cursor: CursorType }) => {
  const hover = useCustomCursorHover(cursor);
  return <div {...hover} />;
};

describe('핸들 호버 중 커서 방향 변경', () => {
  let host: HTMLDivElement;
  let root: Root;
  const overlay = () => document.getElementById('dmn-cursor-overlay')!;
  const shownAngle = () =>
    overlay().querySelector('path')?.getAttribute('transform');
  const render = (cursor: CursorType) =>
    act(() => root.render(<HoverHandle cursor={cursor} />));
  const enter = () =>
    act(() => {
      host.firstElementChild!.dispatchEvent(
        new PointerEvent('pointerover', {
          bubbles: true,
          clientX: 70,
          clientY: 90,
        }),
      );
    });

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resumeCustomCursorHover();
    vi.runAllTimers();
    unlockCustomCursor();
    setCustomCursorHover(null);
    vi.useRealTimers();
  });

  it('같은 노드를 계속 가리켜도 새 방향을 표시한다', () => {
    render('rotate');
    const handle = host.firstElementChild;
    enter();
    expect(shownAngle()).toBe('rotate(0 12 12)');

    render('rotate-90');

    expect(host.firstElementChild).toBe(handle);
    expect(shownAngle()).toBe('rotate(90 12 12)');
    expect(overlay().style.transform).toBe('translate3d(58px, 78px, 0)');
  });

  it('잠긴 드래그는 시작 방향을 유지하고 해제하면 현재 호버 방향을 표시한다', () => {
    render('rotate');
    enter();
    lockCustomCursor('rotate');

    render('rotate-90');
    expect(shownAngle()).toBe('rotate(0 12 12)');
    unlockCustomCursor();

    expect(shownAngle()).toBe('rotate(90 12 12)');
  });

  it('보류된 호버는 위치를 유지하면서 새 방향으로 복원한다', () => {
    suspendCustomCursorHover();
    render('rotate');
    enter();
    render('rotate-90');
    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(shownAngle()).toBe('rotate(90 12 12)');
    expect(overlay().style.transform).toBe('translate3d(58px, 78px, 0)');
  });

  it('다른 핸들이 소유한 보류 기록의 방향과 위치를 바꾸지 않는다', () => {
    suspendCustomCursorHover();
    render('rotate');
    enter();
    const applyOther = vi.fn();
    setPendingCustomCursorHover(
      'rotate-180',
      applyOther,
      new PointerEvent('pointerover', { clientX: 150, clientY: 180 }),
    );

    render('rotate-90');
    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(applyOther).toHaveBeenCalledOnce();
    expect(shownAngle()).toBe('rotate(180 12 12)');
    expect(overlay().style.transform).toBe('translate3d(138px, 168px, 0)');
  });

  it('보류 중 언마운트된 핸들은 방향이 바뀌었어도 다시 표시하지 않는다', () => {
    suspendCustomCursorHover();
    render('rotate');
    enter();
    render('rotate-90');
    act(() => root.render(null));
    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(document.body.classList.contains('dmn-custom-cursor')).toBe(false);
  });
});
