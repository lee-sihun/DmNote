import { useCallback, useEffect, useRef, useState } from 'react';
import {
  prefersReducedMotion,
  readMotionDuration,
} from '@utils/animation/motionPreferences';

const FALLBACK_DURATION_MS = 220;
const FALLBACK_STAGGER_MS = 40;
// 스태거 상한. 999에서 1000처럼 자릿수가 통째로 바뀌어도 꼬리가 길어지지 않는다
const MAX_STAGGER_STEPS = 3;

export interface DigitPopSegment {
  text: string;
  /** 스태거 단계. null은 안 바뀐 구간이라 재생하지 않는다 */
  step: number | null;
}

export interface DigitPopState {
  /** 재생 대상 문자열. 필드의 현재 표시값과 어긋나면 호출부가 오버레이를 접는다 */
  text: string;
  /** 바뀐 구간과 안 바뀐 구간으로 자른 조각들 */
  segments: DigitPopSegment[];
  /** 진행 방향 배수. 값이 늘면 아래에서, 줄면 위에서 들어온다 */
  dir: 1 | -1;
  /** 재생마다 증가. 오버레이 key로 걸어 애니메이션을 처음부터 다시 시작시킨다 */
  cycle: number;
}

// 숫자는 오른쪽으로 자라므로 자릿수 대응도 오른쪽부터 맞춘다.
// 99에서 100으로 갈 때 왼쪽 정렬로 비교하면 안 바뀐 자리를 하나도 못 찾는다
const diffFromRight = (prev: string, next: string): boolean[] => {
  const offset = prev.length - next.length;
  return [...next].map((char, index) => {
    const prevIndex = offset + index;
    return prevIndex < 0 || prev[prevIndex] !== char;
  });
};

// 재생 단위로 자른다. 안 바뀐 구간은 통째로 묶고, 바뀐 자리는 하나씩 남긴다.
//
// 안 바뀐 쪽을 묶는 이유: 문자를 하나씩 쪼개면 한 덩어리로 셰이핑되던 텍스트가
// 조각마다 따로 래스터화된다. 숫자는 tabular-nums라 폭이 고정이지만 마이너스처럼
// 좁은 기호는 DPR 1에서 1픽셀 어긋난다. 정지해 보이는 글자가 그러면 안 된다.
// 바뀐 쪽을 안 묶는 이유: 99에서 100으로 갈 때 세 자리가 한 덩어리로 움직이면
// 자릿수 스태거가 사라진다. 움직이는 글자는 서브픽셀 차이가 보이지 않는다
const toSegments = (text: string, changed: boolean[]): DigitPopSegment[] => {
  const chars = [...text];
  const flags = [...changed];

  // 선행 부호는 뒤 문자와 한 몸. 부호만 조각으로 떨어지는 배치를 만들지 않는다
  if ((chars[0] === '-' || chars[0] === '+') && chars.length > 1) {
    chars.splice(0, 2, chars[0] + chars[1]);
    flags.splice(0, 2, flags[0] || flags[1]);
  }

  const segments: DigitPopSegment[] = [];
  let ordinal = -1;
  chars.forEach((char, index) => {
    if (flags[index]) {
      ordinal += 1;
      segments.push({ text: char, step: Math.min(ordinal, MAX_STAGGER_STEPS) });
      return;
    }
    const last = segments[segments.length - 1];
    if (last && last.step === null) {
      last.text += char;
      return;
    }
    segments.push({ text: char, step: null });
  });

  return segments;
};

// 오버레이가 살아 있어야 하는 시간. 재생 길이의 단일 소스는 CSS 토큰이다.
// 조금 이르거나 늦어도 안전하다 - 끝 상태가 input 글자와 같은 자리라
// 접히는 순간에 눈에 띄는 변화가 없다
const resolveLifeMs = (lastStep: number): number =>
  readMotionDuration('--ui-digit-duration', FALLBACK_DURATION_MS) +
  readMotionDuration('--ui-digit-stagger', FALLBACK_STAGGER_MS) * lastStep;

// 값이 바뀐 자릿수만 튀어오르게 하는 재생 상태.
// 호출부는 누를 때와 뗄 때만 재생한다 - 꾹 누르는 구간까지 재생하면
// 반복 간격이 재생보다 짧아 숫자가 계속 깜빡이고 값을 눈으로 좇을 수 없다
export const useDigitPop = () => {
  const [pop, setPop] = useState<DigitPopState | null>(null);
  const timerRef = useRef<number | null>(null);
  const cycleRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearTimer, []);

  const clear = useCallback(() => {
    clearTimer();
    setPop(null);
  }, []);

  const play = useCallback(
    (prevText: string, nextText: string, dir: 1 | -1) => {
      clearTimer();

      if (prefersReducedMotion()) {
        setPop(null);
        return;
      }

      const segments = toSegments(nextText, diffFromRight(prevText, nextText));
      const changedCount = segments.filter(
        (segment) => segment.step !== null,
      ).length;
      if (changedCount === 0) {
        setPop(null);
        return;
      }

      cycleRef.current += 1;
      setPop({ text: nextText, segments, dir, cycle: cycleRef.current });

      const lastStep = Math.min(changedCount - 1, MAX_STAGGER_STEPS);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPop(null);
      }, resolveLifeMs(lastStep));
    },
    [],
  );

  return { pop, play, clear };
};
