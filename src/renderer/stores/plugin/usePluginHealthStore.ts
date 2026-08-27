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
 * expectedIds를 주면 대상 전부가 실린 정산만 받는다 - 파일 다이얼로그가 열린 동안
 * 들어온 무관한 정산(전역 JS 토글, 프리셋 로드 재주입)을 내 결과로 오인하지 않게.
 * 대상 일부만 실린 정산도 거른다 - 나머지가 무오류로 집계된다.
 * 단 "한 번 실렸다가 knownIds에서 사라진" 대상은 대기 중 꺼졌거나 지워진 것이므로
 * 기다리지 않고 정산한다. 처음부터 없던 id(막 추가한 플러그인)에는 이 탈출구를 주지
 * 않는다 - 그러면 무관한 정산이 전부 수용돼 상관 자체가 무의미해진다
 */
export function waitForPluginInjection(
  revision: number,
  expectedIds?: readonly string[],
): Promise<PluginInjectionResult> {
  // 한 번이라도 주입 목록에 실렸던 대상 - 사라짐 판정의 전제
  const everKnown = new Set<string>();
  const noteKnown = (knownIds?: string[]): void => {
    if (!Array.isArray(knownIds)) return;
    expectedIds?.forEach((id) => {
      if (knownIds.includes(id)) everKnown.add(id);
    });
  };

  const accepts = (state: {
    outcome: PluginInjectionOutcome;
    health: PluginHealthMap;
    knownIds?: string[];
  }): boolean => {
    if (!expectedIds?.length) return true;
    if (state.outcome !== 'settled') return true;
    const knownIds = Array.isArray(state.knownIds) ? state.knownIds : undefined;
    noteKnown(knownIds);
    if (!knownIds) {
      // knownIds가 없는 구 게시는 상관이 불가능하다 - 하나라도 실렸으면 수용
      return expectedIds.some((id) => id in state.health);
    }
    return expectedIds.every(
      (id) =>
        id in state.health || (everKnown.has(id) && !knownIds.includes(id)),
    );
  };

  const initial = usePluginHealthStore.getState();
  // 대기 시작 시점의 주입 목록을 전제로 깐다 - 이미 주입돼 있던 플러그인만
  // "사라짐"으로 정산될 수 있다
  noteKnown(initial.knownIds);
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
