import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCanonicalFallbackHoldMs, useNoteSystem } from './useNoteSystem';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useNoteSystem>;

interface HarnessProps {
  noteEffect: boolean;
  noteSettings: {
    speed?: number;
    trackHeight?: number;
    frameLimit?: number;
    delayedNoteEnabled?: boolean;
    shortNoteThresholdMs?: number;
    shortNoteMinLengthPx?: number;
  };
  onResult: (result: HookResult) => void;
}

const Harness = ({ noteEffect, noteSettings, onResult }: HarnessProps) => {
  onResult(useNoteSystem({ noteEffect, noteSettings }));
  return null;
};

// m=25, T=100, D=37.5, C=62.5, W=37.5
const DELAY_SETTINGS = {
  speed: 400,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 100,
  shortNoteMinLengthPx: 10,
};

const REFERENCE_LENGTHS = [
  { holdMs: 40, lengthMs: 25 },
  { holdMs: 62.5, lengthMs: 25 },
  { holdMs: 70, lengthMs: 36.4 },
  { holdMs: 80, lengthMs: 59.37777777777778 },
  { holdMs: 99, lengthMs: 98.92142222222222 },
  { holdMs: 100, lengthMs: 100 },
  { holdMs: 150, lengthMs: 150 },
] as const;

describe('canonical hold fallback 시각 방어', () => {
  it('비클램프 시각 차가 과도하면 display 경과와 clock-skew 허용치로 제한한다', () => {
    expect(
      resolveCanonicalFallbackHoldMs({
        displayDownTime: 0,
        displayReleaseTime: 100,
        physicalDownTime: -10_000,
        physicalReleaseTime: 100,
      }),
    ).toBe(350);
  });

  it('정상적인 장시간 hold는 고정 상한으로 자르지 않는다', () => {
    expect(
      resolveCanonicalFallbackHoldMs({
        displayDownTime: 0,
        displayReleaseTime: 60_000,
        physicalDownTime: 0,
        physicalReleaseTime: 60_000,
      }),
    ).toBe(60_000);
  });

  it('역전된 물리 시각 차는 0으로 제한한다', () => {
    expect(
      resolveCanonicalFallbackHoldMs({
        displayDownTime: 0,
        displayReleaseTime: 100,
        physicalDownTime: 200,
        physicalReleaseTime: 100,
      }),
    ).toBe(0);
  });
});

describe('useNoteSystem 길이 연속성', () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: HookResult;
  let nowMs: number;

  const advance = async (ms: number) => {
    // performance.now와 타이머를 같은 축으로 전진
    const target = nowMs + ms;
    while (nowMs < target) {
      nowMs = Math.min(nowMs + 1, target);
      vi.advanceTimersByTime(1);
    }
  };

  const render = async (
    noteSettings: HarnessProps['noteSettings'] = DELAY_SETTINGS,
  ) => {
    await act(async () => {
      root.render(
        <Harness
          noteEffect={true}
          noteSettings={noteSettings}
          onResult={(value) => {
            result = value;
          }}
        />,
      );
    });
  };

  const noteOf = (key: string, index = 0) =>
    result.notesRef.current[key]?.[index];

  const releaseWithDaemonHold = async (
    key: string,
    holdMs: number,
    settleMs = Math.ceil(37.5 + Math.max(25, holdMs)) + 1,
  ) => {
    const downTime = nowMs;
    result.handleKeyDown(key, {
      displayTime: downTime,
      physTime: downTime,
    });
    result.handleKeyUp(key, {
      displayTime: downTime + holdMs,
      physTime: downTime + holdMs,
      holdDurationMs: holdMs,
    });
    await advance(settleMs);
    return { downTime, note: noteOf(key)! };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('계약 참조 수치대로 램프 길이를 계산한다', async () => {
    await render();

    for (const [index, { holdMs, lengthMs }] of REFERENCE_LENGTHS.entries()) {
      const { downTime, note } = await releaseWithDaemonHold(
        `R${index}`,
        holdMs,
      );

      expect(note.isActive).toBe(false);
      expect(note.startTime).toBe(downTime + 37.5);
      expect(note.endTime).toBeCloseTo(downTime + 37.5 + lengthMs, 3);
    }
  });

  it('C와 T 경계에서 길이가 연속이다', async () => {
    await render();

    const atC = await releaseWithDaemonHold('C0', 62.5);
    const afterC = await releaseWithDaemonHold('C1', 62.501);
    const beforeT = await releaseWithDaemonHold('T0', 99.999);
    const atT = await releaseWithDaemonHold('T1', 100);

    const lengthAtC = atC.note.endTime! - atC.note.startTime;
    const lengthAfterC = afterC.note.endTime! - afterC.note.startTime;
    const lengthBeforeT = beforeT.note.endTime! - beforeT.note.startTime;
    const lengthAtT = atT.note.endTime! - atT.note.startTime;

    expect(lengthAtC).toBe(25);
    expect(lengthAfterC - lengthAtC).toBeCloseTo(0.001, 3);
    expect(lengthAtT).toBe(100);
    expect(lengthAtT - lengthBeforeT).toBeCloseTo(0.001, 3);
  });

  it('hold가 증가할 때 길이가 감소하지 않고 램프 이후에는 증가한다', async () => {
    await render();

    const measuredLengths: number[] = [];
    for (const [index, { holdMs }] of REFERENCE_LENGTHS.entries()) {
      const { note } = await releaseWithDaemonHold(`M${index}`, holdMs);
      measuredLengths.push(note.endTime! - note.startTime);
    }

    for (let index = 1; index < measuredLengths.length; index += 1) {
      expect(measuredLengths[index]).toBeGreaterThanOrEqual(
        measuredLengths[index - 1],
      );
    }
    for (let index = 2; index < measuredLengths.length; index += 1) {
      expect(measuredLengths[index]).toBeGreaterThan(
        measuredLengths[index - 1],
      );
    }
  });

  it('h >= T에서는 hold 길이를 그대로 보존한다', async () => {
    await render();

    for (const [index, holdMs] of [100, 150, 500].entries()) {
      const { note } = await releaseWithDaemonHold(`L${index}`, holdMs);
      expect(note.endTime! - note.startTime).toBe(holdMs);
    }
  });

  it('T <= m이면 D=0과 L=max(m,h)로 폴백한다', async () => {
    await render({ ...DELAY_SETTINGS, shortNoteThresholdMs: 20 });

    result.handleKeyDown('SYNC', { displayTime: nowMs, physTime: nowMs });
    expect(noteOf('SYNC')).toBeDefined();
    result.handleKeyUp('SYNC', {
      displayTime: nowMs + 10,
      physTime: nowMs + 10,
      holdDurationMs: 10,
    });

    const short = await releaseWithDaemonHold('D0', 10, 30);
    const boundary = await releaseWithDaemonHold('D1', 20, 30);
    const long = await releaseWithDaemonHold('D2', 40, 50);

    expect(short.note.startTime).toBe(short.downTime);
    expect(short.note.endTime! - short.note.startTime).toBe(25);
    expect(boundary.note.startTime).toBe(boundary.downTime);
    expect(boundary.note.endTime! - boundary.note.startTime).toBe(25);
    expect(long.note.startTime).toBe(long.downTime);
    expect(long.note.endTime! - long.note.startTime).toBe(40);
  });

  it('UP 전달이 늦으면 NoShrink 클램프로 현재 시각보다 줄지 않는다', async () => {
    await render();

    result.handleKeyDown('N', { displayTime: 0, physTime: 0 });
    await advance(80);
    result.handleKeyUp('N', {
      displayTime: 62.5,
      physTime: 62.5,
      holdDurationMs: 62.5,
    });

    const note = noteOf('N');
    expect(note!.startTime).toBe(37.5);
    expect(note!.endTime).toBe(80);
  });

  it('startTimer 이전 UP도 데몬 hold가 T 이상이면 롱노트로 보존한다', async () => {
    await render();

    // 배치 전달된 실제 600ms 홀드를 타이머 생존 여부로 오분류하지 않음
    result.handleKeyDown('Z', { displayTime: 0, physTime: 0 });
    result.handleKeyUp('Z', {
      displayTime: 5,
      physTime: 5,
      holdDurationMs: 600,
    });
    await advance(638);

    const note = noteOf('Z');
    expect(note!.isActive).toBe(false);
    expect(note!.startTime).toBe(37.5);
    expect(note!.endTime).toBe(637.5);
  });

  it('holdDurationMs가 NaN·음수면 비클램프 시각 차로 폴백한다', async () => {
    await render();

    result.handleKeyDown('N', { displayTime: 0, physTime: 0 });
    result.handleKeyUp('N', {
      displayTime: 30,
      physTime: 30,
      holdDurationMs: Number.NaN,
    });
    await advance(63);
    expect(noteOf('N')!.startTime).toBe(37.5);
    expect(noteOf('N')!.endTime).toBe(62.5);

    result.handleKeyDown('M', { displayTime: nowMs, physTime: nowMs });
    const mDown = nowMs;
    result.handleKeyUp('M', {
      displayTime: mDown + 40,
      physTime: mDown + 40,
      holdDurationMs: -5,
    });
    await advance(63);
    expect(noteOf('M')!.startTime).toBe(mDown + 37.5);
    expect(noteOf('M')!.endTime).toBe(mDown + 62.5);
  });

  it('mid-press 설정 변경에도 m, T, D, C, W 스냅샷을 유지한다', async () => {
    await render();

    result.handleKeyDown('S', { displayTime: 0, physTime: 0 });
    await render({
      ...DELAY_SETTINGS,
      speed: 800,
      shortNoteThresholdMs: 60,
      shortNoteMinLengthPx: 40,
    });
    result.handleKeyUp('S', {
      displayTime: 80,
      physTime: 80,
      holdDurationMs: 80,
    });
    await advance(100);

    const note = noteOf('S');
    expect(note!.startTime).toBe(37.5);
    expect(note!.endTime).toBeCloseTo(96.87777777777778, 3);
  });

  it('UP 유실 시 reconcileActiveNotes가 활성 노트를 현재 시각으로 종료한다', async () => {
    await render();

    result.handleKeyDown('Z', { displayTime: 0, physTime: 0 });
    await advance(300);
    expect(noteOf('Z')!.isActive).toBe(true);

    act(() => {
      result.reconcileActiveNotes(new Set());
    });

    const note = noteOf('Z');
    expect(note!.isActive).toBe(false);
    expect(note!.endTime).toBe(300);
  });

  it('reconcile: 스냅샷에 있는 키는 유지하고, 생성 전 press는 조용히 취소한다', async () => {
    await render();

    result.handleKeyDown('H', { displayTime: 0, physTime: 0 });
    await advance(150);
    act(() => {
      result.reconcileActiveNotes(new Set(['H']));
    });
    expect(noteOf('H')!.isActive).toBe(true);

    result.handleKeyDown('P', { displayTime: nowMs, physTime: nowMs });
    await advance(20);
    act(() => {
      result.reconcileActiveNotes(new Set(['H']));
    });
    await advance(200);
    // P는 표시 전 취소 - 노트가 생성되지 않아야 함
    expect(noteOf('P')).toBeUndefined();
  });

  it('non-delay 모드는 기존 계약 유지 - 도착 시각 기반 종료', async () => {
    await render({ ...DELAY_SETTINGS, delayedNoteEnabled: false });

    result.handleKeyDown('D', { displayTime: 10, physTime: 10 });
    await advance(60);
    result.handleKeyUp('D', {
      displayTime: 60,
      physTime: 60,
      holdDurationMs: 9999,
    });

    const note = noteOf('D');
    expect(note!.startTime).toBe(10);
    // holdDurationMs와 무관하게 도착(보정) 시각으로 종료
    expect(note!.endTime).toBe(60);
  });
});

describe('useNoteSystem 반환 API 안정성 (#111)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: HookResult;

  const render = async (noteEffect: boolean) => {
    await act(async () => {
      root.render(
        <Harness
          noteEffect={noteEffect}
          noteSettings={DELAY_SETTINGS}
          onResult={(value) => {
            result = value;
          }}
        />,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('반환 함수는 리렌더·noteEffect 토글에도 동일 참조를 유지한다', async () => {
    await render(true);
    const first = result;

    await render(true); // 단순 리렌더
    expect(Object.is(result, first)).toBe(true);

    await render(false); // noteEffect 토글
    expect(Object.is(result.handleKeyDown, first.handleKeyDown)).toBe(true);
    expect(Object.is(result.handleKeyUp, first.handleKeyUp)).toBe(true);
    expect(Object.is(result.subscribe, first.subscribe)).toBe(true);
    expect(Object.is(result.finalizeAllActive, first.finalizeAllActive)).toBe(
      true,
    );
    expect(
      Object.is(result.reconcileActiveNotes, first.reconcileActiveNotes),
    ).toBe(true);
    expect(Object.is(result.updateTrackLayouts, first.updateTrackLayouts)).toBe(
      true,
    );
    expect(Object.is(result.noteBuffer, first.noteBuffer)).toBe(true);
  });

  it('noteEffect off 후에는 기존 캡처 참조로 호출해도 노트를 만들지 않는다', async () => {
    await render(true);
    const captured = result.handleKeyDown;

    await render(false);
    act(() => {
      captured('KeyK', { displayTime: 0, physTime: 0 });
    });
    expect(result.notesRef.current['KeyK'] ?? []).toHaveLength(0);
  });

  it('마운트 직후 noteEffect=false면 첫 렌더부터 노트를 만들지 않는다', async () => {
    // effect 실행 전(첫 렌더 중) 호출로 마운트~첫 effect 사이 창을 검증 -
    // noteEffectEnabled ref 초기값이 !!noteEffect가 아니면 노트가 생성되어 실패
    let calledDuringFirstRender = false;
    await act(async () => {
      root.render(
        <Harness
          noteEffect={false}
          noteSettings={DELAY_SETTINGS}
          onResult={(value) => {
            result = value;
            if (!calledDuringFirstRender) {
              calledDuringFirstRender = true;
              value.handleKeyDown('KeyK', { displayTime: 0, physTime: 0 });
            }
          }}
        />,
      );
    });
    expect(calledDuringFirstRender).toBe(true);
    expect(result.notesRef.current['KeyK'] ?? []).toHaveLength(0);
  });
});
