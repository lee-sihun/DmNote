// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// macOS 커스텀 커서 경로 강제
vi.mock('../core/platform', () => ({
  isMac: () => true,
}));

import {
  clearPendingCustomCursorHover,
  isCustomCursorHoverSuspended,
  lockCustomCursor,
  resumeCustomCursorHover,
  setCustomCursorHover,
  setPendingCustomCursorHover,
  suspendCustomCursorHover,
  unlockCustomCursor,
} from './cursorUtils';

// 오버레이 활성화 시 body에 붙는 클래스 계약
const CURSOR_BODY_CLASS = 'dmn-custom-cursor';

const hasCursorBodyClass = () =>
  document.body.classList.contains(CURSOR_BODY_CLASS);

describe('커스텀 커서 호버 억제 (드래그 세션)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 모듈 상태 원복 (억제 해제 후 호버 클리어)
    resumeCustomCursorHover();
    vi.runAllTimers();
    setCustomCursorHover(null);
    vi.useRealTimers();
  });

  it('호버 설정과 해제가 body 커서 클래스를 토글한다', () => {
    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(true);

    setCustomCursorHover(null);
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('억제 시작은 기존 호버를 즉시 걷어낸다', () => {
    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(true);

    suspendCustomCursorHover();
    expect(hasCursorBodyClass()).toBe(false);
    expect(isCustomCursorHoverSuspended()).toBe(true);
  });

  it('억제 중 호버 설정은 무시되고 해제는 허용된다', () => {
    suspendCustomCursorHover();

    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(false);

    setCustomCursorHover(null);
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('resume 직후 같은 태스크의 잔여 호버 설정은 무시된다', () => {
    suspendCustomCursorHover();
    resumeCustomCursorHover();

    // 세션 해제와 같은 태스크로 도착하는 boundary 이벤트 재현
    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(false);

    vi.runAllTimers();
    expect(isCustomCursorHoverSuspended()).toBe(false);

    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(true);
  });

  it('resume 대기 중 재억제는 해제 타이머를 취소한다', () => {
    suspendCustomCursorHover();
    resumeCustomCursorHover();
    suspendCustomCursorHover();

    vi.runAllTimers();
    expect(isCustomCursorHoverSuspended()).toBe(true);

    setCustomCursorHover('ns-resize');
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('억제 중 보류된 enter는 resume 시 hover로 적용된다', () => {
    suspendCustomCursorHover();
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);
    expect(hasCursorBodyClass()).toBe(false);

    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).toHaveBeenCalledOnce();
    expect(hasCursorBodyClass()).toBe(true);
  });

  it('대응 leave가 오면 보류 기록을 지운다', () => {
    suspendCustomCursorHover();
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);
    // 핸들 leave 시퀀스: 자기 보류 소거 후 hover 해제
    clearPendingCustomCursorHover(apply);
    setCustomCursorHover(null);

    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).not.toHaveBeenCalled();
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('hover 해제는 다른 소유자의 보류 기록을 지우지 않는다', () => {
    suspendCustomCursorHover();
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);
    // 다른 핸들의 unmount 정리가 hover만 걷는 경우
    setCustomCursorHover(null);

    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).toHaveBeenCalledOnce();
    expect(hasCursorBodyClass()).toBe(true);
  });

  it('재억제는 이전 보류 기록을 초기화한다', () => {
    suspendCustomCursorHover();
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);
    suspendCustomCursorHover();

    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).not.toHaveBeenCalled();
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('억제 중이 아니면 보류 기록을 받지 않는다', () => {
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);

    suspendCustomCursorHover();
    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).not.toHaveBeenCalled();
    expect(hasCursorBodyClass()).toBe(false);
  });

  it('보류 해제는 같은 기록일 때만 지운다', () => {
    suspendCustomCursorHover();
    const apply = vi.fn();
    setPendingCustomCursorHover('ns-resize', apply);
    // 다른 소유자의 정리 요청은 무시된다
    clearPendingCustomCursorHover(vi.fn());

    resumeCustomCursorHover();
    vi.runAllTimers();

    expect(apply).toHaveBeenCalledOnce();
    expect(hasCursorBodyClass()).toBe(true);
  });
});

describe('커스텀 커서 포인터 추종', () => {
  let target: HTMLDivElement;

  const overlay = () => document.getElementById('dmn-cursor-overlay')!;
  const move = (type: 'pointermove' | 'mousemove', x: number, y: number) => {
    const EventType = type === 'pointermove' ? PointerEvent : MouseEvent;
    target.dispatchEvent(
      new EventType(type, { clientX: x, clientY: y, bubbles: true }),
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    target = document.createElement('div');
    // 핸들의 이벤트 전파와 무관하게 화면 커서는 현재 포인터를 따른다
    target.addEventListener('pointermove', (event) => event.stopPropagation());
    target.addEventListener('mousemove', (event) => event.stopPropagation());
    document.body.appendChild(target);
  });

  afterEach(() => {
    setCustomCursorHover(null);
    unlockCustomCursor();
    target.remove();
    vi.runAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    'rotate',
    'ns-resize',
    'ew-resize',
    'nwse-resize',
    'nesw-resize',
  ] as const)(
    '%s 드래그는 호환 mousemove가 없어도 캡처된 pointermove를 따른다',
    (cursor) => {
      lockCustomCursor(
        cursor,
        new PointerEvent('pointerdown', { clientX: 20, clientY: 30 }),
      );
      expect(overlay().style.transform).toBe('translate3d(8px, 18px, 0)');

      move('pointermove', 70, 90);
      move('pointermove', 120, 150);
      vi.runAllTimers();

      expect(overlay().style.transform).toBe('translate3d(108px, 138px, 0)');
      expect(hasCursorBodyClass()).toBe(true);
    },
  );

  it('pointer와 mouse 이동이 함께 오면 같은 프레임의 최종 위치를 한 번만 그린다', () => {
    lockCustomCursor(
      'rotate',
      new PointerEvent('pointerdown', { clientX: 20, clientY: 30 }),
    );
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

    move('pointermove', 70, 90);
    move('mousemove', 70, 90);
    move('pointermove', 120, 150);
    move('mousemove', 120, 150);
    expect(requestFrame).toHaveBeenCalledOnce();
    vi.runAllTimers();

    expect(overlay().style.transform).toBe('translate3d(108px, 138px, 0)');
  });

  it('기존 mouse 이동만 제공하는 입력도 캡처 단계에서 따른다', () => {
    lockCustomCursor(
      'ew-resize',
      new MouseEvent('mousedown', { clientX: 20, clientY: 30 }),
    );
    move('mousemove', 100, 120);
    vi.runAllTimers();

    expect(overlay().style.transform).toBe('translate3d(88px, 108px, 0)');
  });

  it.each(['unlock', 'blur'] as const)(
    '%s 뒤에는 예약 프레임과 두 이동 리스너를 모두 회수한다',
    (finish) => {
      lockCustomCursor(
        'rotate',
        new PointerEvent('pointerdown', { clientX: 20, clientY: 30 }),
      );
      move('pointermove', 100, 120);
      if (finish === 'unlock') unlockCustomCursor();
      else window.dispatchEvent(new Event('blur'));
      const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

      move('pointermove', 200, 220);
      move('mousemove', 200, 220);
      vi.runAllTimers();

      expect(requestFrame).not.toHaveBeenCalled();
      expect(overlay().style.transform).toBe('translate3d(8px, 18px, 0)');
      expect(overlay().style.display).toBe('none');
      expect(hasCursorBodyClass()).toBe(false);
    },
  );

  it('드래그 잠금 해제 뒤 남은 호버는 이동을 계속 따르고 leave에서 끝난다', () => {
    setCustomCursorHover('ns-resize');
    lockCustomCursor(
      'rotate',
      new PointerEvent('pointerdown', { clientX: 20, clientY: 30 }),
    );
    unlockCustomCursor();
    move('pointermove', 100, 120);
    vi.runAllTimers();
    expect(overlay().style.transform).toBe('translate3d(88px, 108px, 0)');
    expect(hasCursorBodyClass()).toBe(true);

    setCustomCursorHover(null);
    expect(overlay().style.display).toBe('none');
    expect(hasCursorBodyClass()).toBe(false);
  });
});
