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
  /**
   * 정산 시점에 런타임이 알고 있던 플러그인 id 전체. 대기자가 "내 대상이 그 사이
   * 지워졌는지"를 판정하는 근거. undefined면 판정 불가(구 호출부)라 적용하지 않는다
   */
  knownIds?: string[];
  publish: (
    outcome: PluginInjectionOutcome,
    health: PluginHealthMap,
    knownIds?: string[],
  ) => void;
}

export const usePluginHealthStore = create<PluginHealthState>((set) => ({
  health: {},
  outcome: 'skipped',
  revision: 0,
  knownIds: undefined,
  publish: (outcome, health, knownIds) =>
    set((state) => ({
      outcome,
      health,
      knownIds,
      revision: state.revision + 1,
    })),
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
 * expectedIds를 주면 그 대상이 실린 정산만 받는다 - 파일 다이얼로그가 열린 동안
 * 들어온 무관한 정산(전역 JS 토글, 프리셋 로드 재주입)을 내 결과로 오인하지 않게.
 * 단 대상이 knownIds에서 사라졌으면(대기 중 꺼졌거나 지워짐) 실패가 아니라
 * 주입 대상이 아니었다는 뜻이므로 즉시 정산한다 - 포함을 무조건 기다리면
 * 플러그인을 끄는 것만으로 정산을 영영 놓친다
 */
export function waitForPluginInjection(
  revision: number,
  expectedIds?: readonly string[],
): Promise<PluginInjectionResult> {
  const accepts = (state: {
    outcome: PluginInjectionOutcome;
    health: PluginHealthMap;
    knownIds?: string[];
  }): boolean => {
    if (!expectedIds?.length) return true;
    if (state.outcome !== 'settled') return true;
    if (expectedIds.some((id) => id in state.health)) return true;
    return (
      Array.isArray(state.knownIds) &&
      expectedIds.every((id) => !state.knownIds?.includes(id))
    );
  };

  const initial = usePluginHealthStore.getState();
  if (initial.revision !== revision && accepts(initial)) {
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
      if (!accepts(next)) return;
      settle({ outcome: next.outcome, health: next.health });
    });
  });
}
