/**
 * 단노트 길이 일관성(delayed note) 모드의 표시 길이 정책
 *
 * 균일 구간을 threshold 앞에서 끝내고 램프로 이어붙여 경계 불연속을 없앤다.
 * 정확 구간(hold >= max(threshold, minLengthMs))은 실제 hold를 그대로 쓴다.
 * 여기서 threshold를 빼면 롱노트가 짧아지는 회귀가 재발한다.
 * threshold <= minLengthMs면 최소 길이 클램프가 우세해 정확 구간이 minLengthMs부터 시작한다
 *
 * 설계 근거: tasks/plan/note-length-continuity.md
 */

export interface NoteLengthPolicy {
  /** 단노트 최소 길이 (ms 환산) */
  minLengthMs: number;
  /** 단노트 구분 시간 - 이 이상은 실제 hold 그대로 */
  thresholdMs: number;
  /** 노트가 화면에 나타나기까지의 지연 */
  displayDelayMs: number;
  /** 균일 구간 끝 */
  constantEndMs: number;
  /** 램프 폭 */
  rampWidthMs: number;
}

/**
 * 트랙 높이를 넘는 최소 길이는 셰이더가 어차피 잘라내므로 계산에도 유효값만 쓴다.
 * 저장값은 건드리지 않아 트랙을 키우면 원래 설정이 다시 살아난다
 */
export const toEffectiveMinLengthPx = (
  minLengthPx: number,
  trackHeight: number,
): number => Math.min(minLengthPx, trackHeight);

/** 최소 길이(px)를 ms로 환산 */
export const toMinLengthMs = (
  minLengthPx: number,
  flowSpeed: number,
): number => {
  if (minLengthPx <= 0 || flowSpeed <= 0) return 0;
  return (minLengthPx * 1000) / flowSpeed;
};

/**
 * 표시 지연 D. 균일 구간 상한이 D + minLengthMs라서 남은 예산을
 * 지연과 램프 폭에 반씩 나눈다
 */
export const toDisplayDelayMs = (
  minLengthMs: number,
  thresholdMs: number,
): number => (thresholdMs > minLengthMs ? (thresholdMs - minLengthMs) / 2 : 0);

export const createNoteLengthPolicy = (
  minLengthMs: number,
  thresholdMs: number,
): NoteLengthPolicy => {
  const displayDelayMs = toDisplayDelayMs(minLengthMs, thresholdMs);
  const constantEndMs = minLengthMs + displayDelayMs;

  return {
    minLengthMs,
    thresholdMs,
    displayDelayMs,
    constantEndMs,
    rampWidthMs: thresholdMs - constantEndMs,
  };
};

/** hold(ms)에 대한 최종 표시 길이(ms) */
export const computeNoteLengthMs = (
  holdMs: number,
  policy: NoteLengthPolicy,
): number => {
  const {
    minLengthMs,
    thresholdMs,
    displayDelayMs,
    constantEndMs,
    rampWidthMs,
  } = policy;

  // 램프를 놓을 자리가 없는 설정 - 연속·단조만 지키고 폴백
  if (thresholdMs <= minLengthMs) {
    return Math.max(minLengthMs, holdMs);
  }
  if (holdMs <= constantEndMs) {
    return minLengthMs;
  }
  // 정확 구간은 hold 그대로. threshold나 지연을 빼지 않는다
  if (holdMs >= thresholdMs) {
    return holdMs;
  }

  const progress = (holdMs - constantEndMs) / rampWidthMs;
  const smoothstep = 3 * progress ** 2 - 2 * progress ** 3;
  return holdMs - displayDelayMs + displayDelayMs * smoothstep;
};
