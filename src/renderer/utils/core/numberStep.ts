// 숫자 입력의 방향키 스텝 계산.
// 클램프와 자릿수 정규화는 각 입력이 이미 파서로 갖고 있어 여기서는 증분만 만든다

// Shift는 굵은 눈금. 에디터 계열 입력의 공통 관습이라 값을 노출하지 않는다
const COARSE_MULTIPLIER = 10;

export interface StepModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

// 눈금 크기. 플러그인 스키마가 준 값이라 신뢰하지 않는다 -
// 0이나 음수를 그대로 쓰면 방향키가 죽은 것처럼 보인다
const resolveStepSize = (step: number | undefined): number =>
  step !== undefined && Number.isFinite(step) && step > 0 ? step : 1;

// 방향키가 아니면 null - 호출부가 기존 키 허용 흐름을 그대로 태운다.
// Alt는 소수를 받는 필드에서만 최소 단위로 내려간다. 눈금이 아니라 자릿수를 따르므로
// step 격자에서 벗어날 수 있는데, 그게 미세 조정의 목적이다
export const resolveStepDelta = (
  key: string,
  { shiftKey, altKey }: StepModifiers,
  decimalScale: number,
  step?: number,
): number | null => {
  const direction = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  if (direction === 0) return null;
  if (altKey && decimalScale > 0 && !shiftKey) {
    return direction * 10 ** -decimalScale;
  }
  const size = resolveStepSize(step);
  return direction * (shiftKey ? size * COARSE_MULTIPLIER : size);
};

// 큐에서 묵은 반복 이벤트 판정.
//
// 메인 스레드가 막히면 OS가 만든 keydown이 큐에 쌓이고, 사용자가 손을 뗀 뒤에도
// 밀린 이벤트가 먼저 소비되면서 값이 계속 올라간다. keyup은 그 뒤에야 도착한다.
// 이벤트가 만들어진 시각은 event.timeStamp에 원래 간격 그대로 남아 있으므로,
// 지금과의 차이가 그 이벤트가 큐에서 기다린 시간이다.
//
// 이건 "손을 떼면 즉시 멈춘다"는 보장이 아니라 심하게 묵은 백로그를 버리는 것이다.
// 이 값 이하의 짧은 정체는 통과한다. 임계값을 더 내리면 GC나 큰 커밋 한 번에
// 정상 반복이 빠진다 (33ms 프레임 환경의 큐 지연 p95가 32ms 수준)
const STALE_REPEAT_MS = 100;

// 표준은 performance.now()와 같은 원점을 요구하지만 옛 엔진은 epoch를 준다.
// epoch를 그대로 빼면 큰 음수가 나와 모든 이벤트가 신선한 것으로 통과해버린다
const EPOCH_THRESHOLD_MS = 1e12;
// 두 시계의 정밀도 차이로 생길 수 있는 음수 폭. 이보다 크게 미래면 시각을 못 믿는다.
// 넉넉히 잡으면 그만큼 묵은 이벤트가 신선한 것으로 통과한다
const MAX_SKEW_MS = 16;

export const isStaleRepeat = (
  event: { repeat: boolean; timeStamp: number },
  now: number = performance.now(),
): boolean => {
  if (!event.repeat) return false;

  const raw = event.timeStamp;
  // 시각을 못 믿으면 버린다. 통과시키는 쪽이 값이 폭주하는 방향이라 fail-closed
  if (!Number.isFinite(raw) || raw <= 0) return true;

  const stamp = raw > EPOCH_THRESHOLD_MS ? raw - performance.timeOrigin : raw;
  const queueDelay = now - stamp;
  if (!Number.isFinite(queueDelay) || queueDelay < -MAX_SKEW_MS) return true;

  return queueDelay > STALE_REPEAT_MS;
};

// placeholder에 상속값이 보이는 필드는 그 값이 스텝 기준이다.
// '16px' -> 16, 'Auto' -> null
export const parseLeadingNumber = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(raw.trim());
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};
