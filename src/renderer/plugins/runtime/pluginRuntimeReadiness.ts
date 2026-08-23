/**
 * 플러그인 런타임 준비 상태
 *
 * 오버레이 초기 리빌 게이트가 "플러그인 요소까지 나올 준비가 끝났는가"를 판단하는 근거.
 * - 로컬 준비: 초기 조회(js.get / js.getUse) 완료 + 진행 중인 주입·복구 작업 없음
 * - 메인 준비: 요소 권위인 메인 윈도우가 보내온 신호 (오버레이에서만 사용, 1회성)
 */

type ReadinessListener = () => void;

// 초기 조회 2건 - js.get / js.getUse
const INITIAL_FETCH_COUNT = 2;

let pendingInitialFetches = INITIAL_FETCH_COUNT;
let pendingWork = 0;
let enabledPluginCount = 0;
let mainReady = false;

const listeners = new Set<ReadinessListener>();

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[Plugin] 준비 상태 구독자 실행 실패', error);
    }
  });
};

/** 초기 조회 1건 완료 (성공·실패 무관 - 실패는 fail-open) */
export const notePluginFetchSettled = () => {
  if (pendingInitialFetches === 0) return;
  pendingInitialFetches -= 1;
  notify();
};

/** 활성 플러그인 수 - 0이면 플러그인 요소를 기다릴 필요가 없다 */
export const noteEnabledPluginCount = (count: number) => {
  const next = Math.max(0, count);
  if (enabledPluginCount === next) return;
  enabledPluginCount = next;
  notify();
};

/** 진행 중 작업 등록 - 반환된 종료 콜백은 중복 호출에 안전 */
export const beginPluginWork = (): (() => void) => {
  pendingWork += 1;
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    pendingWork = Math.max(0, pendingWork - 1);
    notify();
  };
};

/** 프라미스 기반 작업 추적 - 실패해도 준비 상태를 막지 않는다 */
export const trackPluginWork = (work: Promise<unknown>): void => {
  const endWork = beginPluginWork();
  void work.then(endWork, endWork);
};

/** 메인 윈도우의 플러그인 요소 준비 완료 수신 - 되돌리지 않는다 */
export const noteMainPluginsReady = () => {
  if (mainReady) return;
  mainReady = true;
  notify();
};

export const isLocalPluginRuntimeReady = (): boolean =>
  pendingInitialFetches === 0 && pendingWork === 0;

export const hasEnabledPlugins = (): boolean => enabledPluginCount > 0;

export const isMainPluginsReady = (): boolean => mainReady;

export const subscribePluginReadiness = (
  listener: ReadinessListener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const resetPluginRuntimeReadiness = () => {
  pendingInitialFetches = INITIAL_FETCH_COUNT;
  pendingWork = 0;
  enabledPluginCount = 0;
  mainReady = false;
  notify();
};
