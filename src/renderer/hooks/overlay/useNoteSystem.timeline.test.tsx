import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useNoteSystem } from './useNoteSystem';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useNoteSystem>;

const SETTINGS = {
  speed: 1000,
  trackHeight: 300,
  frameLimit: 0,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 100,
  shortNoteMinLengthPx: 30,
};

const Harness = ({ onResult }: { onResult: (value: HookResult) => void }) => {
  onResult(useNoteSystem({ noteEffect: true, noteSettings: SETTINGS }));
  return null;
};

describe('useNoteSystem timeline 이진 판정', () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: HookResult;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <Harness
          onResult={(value) => {
            result = value;
          }}
        />,
      );
    });
    result.updateTrackLayouts([
      {
        trackKey: 'A',
        trackIndex: 0,
        position: { dx: 0, dy: 300 },
        width: 40,
        height: 300,
      },
    ]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const play = (pressId: string, downTimeMs: number, holdMs: number) => {
    const press = {
      pressId,
      mode: '4key',
      key: 'A',
      downTimeMs,
      upTimeMs: downTimeMs + holdMs,
    };
    act(() => {
      result.handleTimelinePressStart(press);
      result.handleTimelinePressResolve(press);
    });
    return result.notesRef.current.A.at(-1)!;
  };

  it('threshold 미만은 모두 고정 길이이고 정확 경계부터 실제 길이다', () => {
    const below = play('below', 1000, 99.999);
    const boundary = play('boundary', 2000, 100);
    const above = play('above', 3000, 175);

    expect(below.endTime! - below.startTime).toBeCloseTo(30, 5);
    expect(boundary.endTime! - boundary.startTime).toBe(100);
    expect(above.endTime! - above.startTime).toBe(175);
  });

  it('같은 키 연타를 pressId별 독립 노트로 유지한다', () => {
    const first = play('rapid-1', 1000, 20);
    const second = play('rapid-2', 1030, 25);
    const third = play('rapid-3', 1060, 150);

    expect(result.notesRef.current.A).toHaveLength(3);
    expect([first.id, second.id, third.id]).toEqual([
      'timeline:rapid-1',
      'timeline:rapid-2',
      'timeline:rapid-3',
    ]);
    expect(first.endTime! - first.startTime).toBe(30);
    expect(second.endTime! - second.startTime).toBe(30);
    expect(third.endTime! - third.startTime).toBe(150);
  });

  it('정리는 wall clock이 아니라 presentation playhead를 따른다', () => {
    play('cleanup', 1000, 50);

    act(() => result.advanceTimeline(1379));
    expect(result.notesRef.current.A).toHaveLength(1);

    act(() => result.advanceTimeline(1380));
    expect(result.notesRef.current.A).toBeUndefined();
    expect(result.noteBuffer.activeCount).toBe(0);
  });
});
