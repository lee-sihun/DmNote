import { create } from 'zustand';

export type PluginHealthStatus = 'ok' | 'failed';

export interface PluginHealthEntry {
  status: PluginHealthStatus;
  message?: string;
}

export type PluginHealthMap = Record<string, PluginHealthEntry>;

/**
 * settled - 주입이 실제로 돌았고 health가 판정 결과다
 * skipped - 전역 JS가 꺼져 주입 대상이 아니었다 (오류 아님)
 * aborted - 주입해야 했지만 authority reset 실패로 못 했다
 */
export type PluginInjectionOutcome = 'settled' | 'skipped' | 'aborted';

export interface PluginInjectionResult {
  outcome: PluginInjectionOutcome | 'timeout';
  health: PluginHealthMap;
}

interface PluginHealthState {
  /**
   * 주입 결과는 세션 파생값이다. 영속화하지 않고 창마다 독립이며,
   * 재시작하면 실제 주입 결과로 다시 채워진다
   */
  health: PluginHealthMap;
  outcome: PluginInjectionOutcome;
  /** 주입이 한 번 정산될 때마다 증가 */
  revision: number;
  publish: (outcome: PluginInjectionOutcome, health: PluginHealthMap) => void;
}

export const usePluginHealthStore = create<PluginHealthState>((set) => ({
  health: {},
  outcome: 'skipped',
  revision: 0,
  publish: (outcome, health) =>
    set((state) => ({ outcome, health, revision: state.revision + 1 })),
}));

// 주입 정산이 끝내 오지 않아도 호출부가 묶이지 않게 상한을 둔다
const INJECTION_WAIT_TIMEOUT_MS = 5000;

/** 대기 기준으로 쓸 현재 정산 회차 */
export function currentPluginHealthRevision(): number {
  return usePluginHealthStore.getState().revision;
}

/**
 * 기준 회차 이후의 주입 정산을 기다린다.
 * 요청을 보내기 전에 회차를 잡아 두면 대기를 걸기 전에 게시가 끝나도 놓치지 않는다.
 *
 * settled 결과는 그 시점에 주입된 플러그인 전체의 스냅샷이다.
 * 그래서 특정 id가 들어 있는지 따지지 않는다 - 빠진 id는 실패가 아니라
 * 그 사이에 꺼졌거나 지워져서 주입 대상이 아니었다는 뜻이다.
 * 대상 포함을 조건으로 걸면 대기 중 플러그인을 끄는 것만으로 정산을 영영 놓친다
 */
export function waitForPluginInjection(
  revision: number,
): Promise<PluginInjectionResult> {
  const initial = usePluginHealthStore.getState();
  if (initial.revision !== revision) {
    return Promise.resolve({
      outcome: initial.outcome,
      health: initial.health,
    });
  }

  return new Promise((resolve) => {
    const settle = (result: PluginInjectionResult): void => {
      unsubscribe();
      window.clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(() => {
      // 정산을 못 받은 것과 결과가 비어 있는 것은 다르다
      settle({
        outcome: 'timeout',
        health: usePluginHealthStore.getState().health,
      });
    }, INJECTION_WAIT_TIMEOUT_MS);

    const unsubscribe = usePluginHealthStore.subscribe((next) => {
      if (next.revision === revision) return;
      settle({ outcome: next.outcome, health: next.health });
    });
  });
}
