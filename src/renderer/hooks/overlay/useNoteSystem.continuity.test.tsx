import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteSystem } from './useNoteSystem';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useNoteSystem>;

interface Settings {
  speed: number;
  trackHeight: number;
  delayedNoteEnabled: boolean;
  shortNoteThresholdMs: number;
  shortNoteMinLengthPx: number;
}

const Harness = ({
  noteSettings,
  onResult,
}: {
  noteSettings: Settings;
  onResult: (r: HookResult) => void;
}) => {
  onResult(useNoteSystem({ noteEffect: true, noteSettings }));
  return null;
};

// 계약서 수식을 독립 구현한 오라클 - 구현 코드를 참조하지 않는다
const oracle = (s: Settings) => {
  const effectiveMinPx = Math.min(s.shortNoteMinLengthPx, s.trackHeight);
  const m = (effectiveMinPx * 1000) / s.speed;
  const T = s.shortNoteThresholdMs;
  if (T <= m) {
    return {
      m,
      T,
      D: 0,
      C: m,
      W: T - m,
      L: (h: number) => Math.max(m, h),
    };
  }
  const D = (T - m) / 2;
  const C = m + D;
  const W = T - C;
  const L = (h: number) => {
    if (h <= C) return m;
    if (h >= T) return h;
    const x = (h - C) / W;
    return h - D + D * (3 * x * x - 2 * x * x * x);
  };
  return { m, T, D, C, W, L };
};

const USER: Settings = {
  speed: 700,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 60,
  shortNoteMinLengthPx: 24,
};
const LEGACY: Settings = {
  speed: 400,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 100,
  shortNoteMinLengthPx: 10,
};
const HIGH_SPEED: Settings = {
  speed: 3000,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 60,
  shortNoteMinLengthPx: 1,
};
// degenerate: T <= m  (m = 50*1000/700 ≈ 71.4 > T = 40)
const DEGEN: Settings = {
  speed: 700,
  trackHeight: 300,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 40,
  shortNoteMinLengthPx: 50,
};
const TRACK_CAPPED: Settings = {
  speed: 1000,
  trackHeight: 20,
  delayedNoteEnabled: true,
  shortNoteThresholdMs: 100,
  shortNoteMinLengthPx: 500,
};
const TRACK_EXPANDED: Settings = {
  ...TRACK_CAPPED,
  trackHeight: 500,
};

describe('노트 길이 연속성 계약 독립 검증', () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: HookResult;
  let nowMs: number;

  const advance = async (ms: number) => {
    const target = nowMs + ms;
    while (nowMs < target) {
      nowMs = Math.min(nowMs + 1, target);
      vi.advanceTimersByTime(1);
    }
  };

  const render = async (noteSettings: Settings) => {
    await act(async () => {
      root.render(
        <Harness
          noteSettings={noteSettings}
          onResult={(v) => {
            result = v;
          }}
        />,
      );
    });
  };

  beforeEach(() => {
    nowMs = 0;
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const noteOf = (key: string) => result.notesRef.current[key]?.[0];

  // hold h 를 재생하고 최종 (startTime, endTime) 반환
  // upBeforeStart=true 면 노트 생성 전에 UP을 흘려보낸다 (타이머 경합 경로)
  const play = async (
    key: string,
    h: number,
    s: Settings,
    upBeforeStart: boolean,
  ) => {
    const down = nowMs;
    result.handleKeyDown(key, { displayTime: down, physTime: down });
    const o = oracle(s);
    if (!upBeforeStart) {
      // 전달 지연 0: 정확히 down+h 시점에 UP 처리 (NoShrink 클램프가 끼어들지 않는 조건)
      await advance(h);
    }
    result.handleKeyUp(key, {
      displayTime: down + h,
      physTime: down + h,
      holdDurationMs: h,
    });
    // 완료될 때까지만 전진 - 더 가면 cleanup이 노트를 회수한다
    const cap =
      Math.ceil(o.D + Math.max(o.L(h), h) + s.shortNoteThresholdMs) + 5;
    let n = noteOf(key);
    for (let i = 0; i < cap && (!n || n.endTime == null); i += 1) {
      await advance(1);
      n = noteOf(key);
    }
    return n && n.endTime != null
      ? { start: n.startTime - down, end: n.endTime - down }
      : null;
  };

  for (const [label, s] of [
    ['유저 설정 24/60/700', USER],
    ['기존 테스트 설정 10/100/400', LEGACY],
  ] as const) {
    it(`${label}: L(h)가 계약 수식과 일치하고 정확 구간 결손이 0이다`, async () => {
      const o = oracle(s);
      for (const h of [
        10, 25, 34, 40, 47, 50, 55, 59, 60, 62, 70, 80, 99, 100, 150, 300,
      ]) {
        await render(s);
        const r = await play(`K${h}`, h, s, false);
        expect(r, `hold ${h}`).not.toBeNull();
        // 시작 시각은 downTime + D
        expect(r!.start, `hold ${h} start`).toBeCloseTo(o.D, 3);
        // 길이는 계약 수식
        expect(r!.end - r!.start, `hold ${h} length`).toBeCloseTo(o.L(h), 3);
        // 롱노트 결손 0
        if (h >= Math.max(o.T, o.m))
          expect(r!.end - r!.start, `hold ${h} 롱노트 결손`).toBeCloseTo(h, 3);
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        nowMs += 1000;
      }
    });

    it(`${label}: 경계 구간을 실제 훅으로 스윕해 연속·단조를 확인한다`, async () => {
      const o = oracle(s);
      // C와 T 주변을 0.5ms 간격으로 실제 훅에 통과시킨다
      const holds: number[] = [];
      for (let h = Math.max(0, o.C - 3); h <= o.T + 3; h += 0.5) holds.push(h);

      const measured: number[] = [];
      for (const h of holds) {
        await render(s);
        const r = await play(`S${h}`, h, s, false);
        expect(r, `hold ${h}`).not.toBeNull();
        measured.push(r!.end - r!.start);
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        nowMs += 1000;
      }

      for (let i = 0; i < holds.length; i += 1) {
        // 구현이 계약 수식과 일치
        expect(measured[i], `hold ${holds[i]}`).toBeCloseTo(o.L(holds[i]), 3);
        if (i === 0) continue;
        const step = holds[i] - holds[i - 1];
        const delta = measured[i] - measured[i - 1];
        // 단조증가
        expect(delta, `hold ${holds[i]} 단조성`).toBeGreaterThanOrEqual(-1e-6);
        // 계단 없음: 최대 기울기 2.5를 넘는 도약이 없어야 한다
        expect(delta, `hold ${holds[i]} 계단`).toBeLessThanOrEqual(
          step * 2.5 + 1e-6,
        );
      }
    });

    it(`${label}: UP이 노트 생성 전/후 어느 쪽이든 결과가 같다`, async () => {
      for (const h of [30, 55, 70, 120]) {
        await render(s);
        const a = await play(`A${h}`, h, s, true);
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        nowMs += 1000;

        await render(s);
        const b = await play(`B${h}`, h, s, false);
        expect(a, `hold ${h}`).not.toBeNull();
        expect(b, `hold ${h}`).not.toBeNull();
        expect(a!.end - a!.start, `hold ${h} 경로 불변`).toBeCloseTo(
          b!.end - b!.start,
          3,
        );
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        nowMs += 1000;
      }
    });
  }

  it('최소 길이 px를 ms 반올림 없이 보존한다', async () => {
    for (const [key, s, h] of [
      ['USER', USER, 30],
      ['HIGH_SPEED', HIGH_SPEED, 1],
    ] as const) {
      await render(s);
      const r = await play(key, h, s, true);
      expect(r).not.toBeNull();
      const lengthPx = ((r!.end - r!.start) * s.speed) / 1000;
      expect(lengthPx).toBeCloseTo(s.shortNoteMinLengthPx, 6);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      nowMs += 1000;
    }
  });

  it('실수 D와 동일한 램프 폭을 보존한다', () => {
    const userPolicy = oracle(USER);
    const legacyPolicy = oracle(LEGACY);

    expect(userPolicy.D).toBeCloseTo(12.857142857142858, 12);
    expect(userPolicy.W).toBeCloseTo(userPolicy.D, 12);
    expect(legacyPolicy.D).toBe(37.5);
    expect(legacyPolicy.W).toBe(37.5);
  });

  it('최소 길이를 트랙 높이로 제한하고 트랙 확장 시 저장값을 다시 적용한다', async () => {
    for (const [key, s, expectedPx] of [
      ['CAPPED', TRACK_CAPPED, 20],
      ['EXPANDED', TRACK_EXPANDED, 500],
    ] as const) {
      await render(s);
      const r = await play(key, 10, s, false);
      expect(r).not.toBeNull();
      const lengthPx = ((r!.end - r!.start) * s.speed) / 1000;
      expect(lengthPx).toBeCloseTo(expectedPx, 6);
      expect(s.shortNoteMinLengthPx).toBe(500);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      nowMs += 1000;
    }
  });

  it('degenerate T<=m: L(h)=max(m,h), 지연 0, 계단 없음', async () => {
    const s = DEGEN;
    const o = oracle(s);
    expect(o.T).toBeLessThanOrEqual(o.m);
    for (const h of [10, 40, 71, 100, 200]) {
      await render(s);
      const r = await play(`D${h}`, h, s, false);
      expect(r, `hold ${h}`).not.toBeNull();
      expect(r!.start, `hold ${h} start`).toBeCloseTo(0, 3);
      expect(r!.end - r!.start, `hold ${h}`).toBeCloseTo(Math.max(o.m, h), 3);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      nowMs += 1000;
    }
  });

  it('NoShrink: UP 전달이 D보다 늦어도 노트가 줄어들지 않는다', async () => {
    const s = USER;
    const o = oracle(s);
    await render(s);
    const down = nowMs;
    result.handleKeyDown('S', { displayTime: down, physTime: down });
    // 노트 생성 후 한참 자란 뒤에야 UP이 도착 - hold 자체는 평탄 구간(40ms)
    await advance(200);
    const shownAtUp = nowMs - (down + o.D);
    result.handleKeyUp('S', {
      displayTime: down + 40,
      physTime: down + 40,
      holdDurationMs: 40,
    });
    await advance(400);
    const n = noteOf('S');
    expect(n).toBeDefined();
    const finalLen = n!.endTime! - n!.startTime;
    // 이미 화면에 그려진 길이보다 짧아지면 시각적 shrink
    expect(finalLen).toBeGreaterThanOrEqual(shownAtUp - 1e-6);
  });
});
