// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// macOS 커스텀 커서 경로 강제
vi.mock('../core/platform', () => ({
  isMac: () => true,
}));

import {
  clearPendingCustomCursorHover,
  isCustomCursorHoverSuspended,
  resumeCustomCursorHover,
  setCustomCursorHover,
  setPendingCustomCursorHover,
  suspendCustomCursorHover,
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
