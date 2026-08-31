import { signal, type Signal } from '@preact/signals-react';

// globalKey -> Signal<boolean> 매핑
const keySignals = new Map<string, Signal<boolean>>();

export function getKeySignal(key: string): Signal<boolean> {
  let s = keySignals.get(key);
  if (!s) {
    s = signal(false);
    keySignals.set(key, s);
  }
  return s;
}

export function setKeyActive(key: string, isActive: boolean) {
  getKeySignal(key).value = isActive;
}

export function resetAllKeySignals() {
  for (const s of keySignals.values()) s.value = false;
  // 리셋은 전체 재구성 - 이벤트 레벨도 비워 다음 실제 DOWN이 edge가 되게 한다
  eventKeyDownStates.clear();
}

// 실제 입력 DOWN edge 구독 - 하이드레이션·리싱크의 시그널 세팅과 분리된 채널.
// 시그널 레벨(false→true)로 edge를 만들면 부트스트랩·OBS 재연결·탭 전환의
// 재수화가 전부 유령 edge가 되므로, 이벤트 경로만 emit을 호출한다
const pressEdgeListeners = new Map<string, Set<() => void>>();

export function subscribeKeyPressEdge(
  key: string,
  listener: () => void,
): () => void {
  let listeners = pressEdgeListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    pressEdgeListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) pressEdgeListeners.delete(key);
  };
}

function emitKeyPressEdge(key: string) {
  const listeners = pressEdgeListeners.get(key);
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}

// 이벤트 경로가 마지막으로 적용한 레벨 - edge 판정 전용.
// 시그널 값으로 판정하면 OBS 리싱크·하이드레이션이 지연 대기 중인 실제 DOWN의
// 레벨을 선점해 edge를 삼킨다 (시그널은 표시용, 이 맵은 이벤트 이력용)
const eventKeyDownStates = new Map<string, boolean>();

// 이벤트 경로 전용 세팅 - 이벤트 이력 기준 상승 전이에만 edge를 발화해
// OS 반복 DOWN을 무시한다. 하이드레이션·리싱크는 setKeyActive를 그대로 쓴다
export function applyEventKeyState(key: string, isDown: boolean) {
  const rising = isDown && eventKeyDownStates.get(key) !== true;
  eventKeyDownStates.set(key, isDown);
  getKeySignal(key).value = isDown;
  if (rising) emitKeyPressEdge(key);
}
