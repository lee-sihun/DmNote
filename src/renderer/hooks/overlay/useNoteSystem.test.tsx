import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteSystem } from './useNoteSystem';

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

// threshold 100ms, 최소 길이 10px @ 400px/s = 25ms
const DELAY_SETTINGS = {
  speed: 400,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 100,
  shortNoteMinLengthPx: 10,
};

describe('useNoteSystem 단/롱 판정', () => {
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

  it('UP이 startTimer 이후 도착해도 hold < threshold면 고정 길이 단노트다', async () => {
    await render();

    // 물리 hold 80ms < threshold 100ms인 탭. 전달 지연으로 UP 콜백은
    // 타이머 발화(100ms) 뒤인 110ms에 도착 - 1.6.1 회귀의 핵심 시나리오
    result.handleKeyDown('Z', { displayTime: 0, physTime: 0 });
    await advance(105);
    result.handleKeyUp('Z', {
      displayTime: 80,
      physTime: 80,
      holdDurationMs: 80,
    });
    await advance(30);

    const note = noteOf('Z');
    expect(note).toBeDefined();
    expect(note!.isActive).toBe(false);
    expect(note!.startTime).toBe(100);
    // 단노트 고정 길이 25ms (80ms가 아님)
    expect(note!.endTime).toBe(125);
  });

  it('UP이 startTimer 이전에 도착해도 hold >= threshold면 롱노트다', async () => {
    await render();

    // 배치 전달로 DOWN/UP이 함께 늦게 도착한 진짜 600ms 홀드.
    // 기존 코드는 타이머 생존만 보고 단노트로 오분류했다
    result.handleKeyDown('Z', { displayTime: 0, physTime: 0 });
    result.handleKeyUp('Z', {
      displayTime: 5,
      physTime: 5,
      holdDurationMs: 600,
    });
    await advance(100);
    await advance(650);

    const note = noteOf('Z');
    expect(note!.isActive).toBe(false);
    expect(note!.startTime).toBe(100);
    expect(note!.endTime).toBe(700);
  });

  it('경계 정책: hold == threshold는 롱, 미만은 단', async () => {
    await render();

    result.handleKeyDown('A', { displayTime: 0, physTime: 0 });
    await advance(105);
    result.handleKeyUp('A', {
      displayTime: 100,
      physTime: 100,
      holdDurationMs: 100,
    });
    await advance(120);
    expect(noteOf('A')!.endTime).toBe(200);

    result.handleKeyDown('B', { displayTime: nowMs, physTime: nowMs });
    const bDown = nowMs;
    await advance(105);
    result.handleKeyUp('B', {
      displayTime: bDown + 99,
      physTime: bDown + 99,
      holdDurationMs: 99,
    });
    await advance(30);
    expect(noteOf('B')!.endTime).toBe(bDown + 125);
  });

  it('holdDurationMs가 NaN·음수면 비클램프 시각 차로 폴백한다', async () => {
    await render();

    result.handleKeyDown('N', { displayTime: 0, physTime: 0 });
    await advance(105);
    result.handleKeyUp('N', {
      displayTime: 30,
      physTime: 30,
      holdDurationMs: Number.NaN,
    });
    await advance(30);
    // 폴백 hold 30ms < 100ms → 단노트
    expect(noteOf('N')!.endTime).toBe(125);

    result.handleKeyDown('M', { displayTime: nowMs, physTime: nowMs });
    const mDown = nowMs;
    await advance(105);
    result.handleKeyUp('M', {
      displayTime: mDown + 40,
      physTime: mDown + 40,
      holdDurationMs: -5,
    });
    await advance(30);
    expect(noteOf('M')!.endTime).toBe(mDown + 125);
  });

  it('mid-press 설정 변경에도 press 시작 시점의 threshold로 판정한다', async () => {
    await render();

    result.handleKeyDown('S', { displayTime: 0, physTime: 0 });
    // press 진행 중 threshold를 100 → 30으로 낮춰도 진행 중 press에는 미적용
    await render({ ...DELAY_SETTINGS, shortNoteThresholdMs: 30 });
    result.handleKeyUp('S', {
      displayTime: 60,
      physTime: 60,
      holdDurationMs: 60,
    });
    await advance(105);
    await advance(30);

    // 스냅샷 threshold 100 기준 단노트 (라이브 값 30이었다면 롱노트 160)
    expect(noteOf('S')!.endTime).toBe(125);
  });

  it('reconcile: 스냅샷에 없는 키의 활성 노트를 현재 시각으로 종료한다', async () => {
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
    await advance(50);
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
