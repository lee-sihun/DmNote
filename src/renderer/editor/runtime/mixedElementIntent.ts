import {
  commitMixedGestureIntent,
  commitMixedGestureTransaction,
  type MixedIntentGeneration,
} from '@plugins/runtime/displayElement/gestureTransaction';

import { isElementIntentAbort, reportElementOpSkipped } from './elementIntent';
import { commitSemanticOps } from './editorSemanticOps';

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

import type {
  EditorDocumentV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import type { ElementIntentReceipt } from './elementIntent';

// 혼합 게스처용 러너: runElementIntent의 편입 3상태 계약을 mixed
// transaction에 적용한다. generator는 coordinator 직렬 슬롯 안에서 최신
// base로 평가되고, null은 editorChanges 없음(plugin 변경만 커밋)이다.
//
// 복원 판정은 generatedNull이 enrolled보다 우선한다 - editor 의도가
// fail-closed로 무커밋된 뒤 plugin callback이 실패해도 eager 잔존은
// 이 러너가 복원해야 한다
export const runMixedElementIntent = async (options: {
  gestureId: string;
  pluginIds: readonly string[];
  applyEager: () => ElementIntentReceipt | null;
  generate: (base: EditorDocumentV1) => EditorPatchV1 | null;
  skipContext: string;
  // 의도적으로 editor를 생략하는 호출자(plugin만 커밋)는 skip 관측 생략
  expectNull?: boolean;
}): Promise<void> => {
  const receipt = options.applyEager();
  let generatedNull = false;
  let enrolled = false;
  try {
    await commitMixedGestureTransaction(
      options.gestureId,
      (base) => {
        const patch = options.generate(base);
        if (patch === null) generatedNull = true;
        return patch;
      },
      options.pluginIds,
      {
        onEnrolled: () => {
          enrolled = true;
        },
      },
    );
    if (generatedNull) {
      receipt?.rollback();
      if (!options.expectNull) reportElementOpSkipped(options.skipContext);
    }
  } catch (error) {
    if (generatedNull || !enrolled) receipt?.rollback();
    throw error;
  }
};

export const runMixedElementBoundsIntent = async (options: {
  gestureId: string;
  pluginIds: readonly string[];
  ops: readonly EditorOpV1[];
  receipt: ElementIntentReceipt | null;
}): Promise<void> => {
  let enrolled = false;
  try {
    const onEnrolled = () => {
      enrolled = true;
    };
    if (options.pluginIds.length === 0) {
      await commitSemanticOps(options.ops, {
        gestureId: options.gestureId,
        onEnrolled,
      });
    } else {
      await commitMixedGestureTransaction(
        options.gestureId,
        { opsVersion: 1, ops: options.ops },
        options.pluginIds,
        { onEnrolled },
      );
    }
  } catch (error) {
    if (!enrolled) options.receipt?.rollback();
    throw error;
  }
};

// destructive(삭제·paste) 혼합 러너: 슬롯 정합 projection 위에서 3상태
// generator를 실행하고, 전체 중단(sentinel)·prepare 실패의 receipt 복원을
// staged 해제 전에 완료한다. targetLost 대신 sentinel을 쓰는 이유:
// null 반환은 plugin 변경만 커밋하는 슬라이스 A 의미론이라 destructive의
// 부분 성공(plugin만 삭제·추가)을 만든다 - 전체 중단이 안전하다
export const runMixedGestureElementIntent = async (options: {
  gestureId: string;
  initialPluginIds: readonly string[];
  pluginScope: (
    elements: readonly PluginDisplayElementInternal[],
  ) => readonly string[];
  // eager는 호출 직전 이미 적용됨 - receipt만 전달
  receipt: ElementIntentReceipt | null;
  generate: (context: {
    base: EditorDocumentV1;
    pluginProjection: readonly PluginDisplayElementInternal[];
  }) => MixedIntentGeneration;
  skipContext: string;
}): Promise<{ committed: boolean; satisfied: boolean }> => {
  let enrolled = false;
  let lastKind: MixedIntentGeneration['kind'] | null = null;
  let rolledBack = false;
  const rollbackOnce = () => {
    if (rolledBack) return;
    rolledBack = true;
    options.receipt?.rollback();
  };
  try {
    await commitMixedGestureIntent({
      gestureId: options.gestureId,
      initialPluginIds: options.initialPluginIds,
      pluginScope: options.pluginScope,
      generate: (context) => {
        const generation = options.generate(context);
        lastKind = generation.kind;
        return generation;
      },
      onEnrolled: () => {
        enrolled = true;
      },
      onFailureBeforeSettle: (error) => {
        // 편입 전 실패·전체 중단만 이 러너가 소유 - staged 해제가
        // stagedSavePending 재저장을 예약하기 전에 동기 복원
        if (!enrolled || isElementIntentAbort(error)) rollbackOnce();
      },
    });
    if (lastKind === 'satisfied') {
      return { committed: false, satisfied: true };
    }
    return { committed: true, satisfied: true };
  } catch (error) {
    if (isElementIntentAbort(error)) {
      rollbackOnce();
      reportElementOpSkipped(options.skipContext);
      return { committed: false, satisfied: false };
    }
    if (!enrolled) rollbackOnce();
    throw error;
  }
};

// ---------------------------------------------------------------------------
// plugin eager semantic receipt: staged 해제가 stagedSavePending 재저장을
// 예약하므로 plugin UI 스토어의 eager도 편입 전 실패에서 동기 복원해야
// 영속 유출이 없다. canonical pull은 편입 후 실패의 보조 복구
// ---------------------------------------------------------------------------

// 제거 membership: mutate 직전 원본·index를 캡처, 복원은 fullId 부재 시 재삽입
export const applyPluginRemovalEagerly = (
  fullIds: readonly string[],
  mutate: () => void,
): ElementIntentReceipt | null => {
  const wanted = new Set(fullIds);
  if (wanted.size === 0) {
    mutate();
    return null;
  }
  const before = usePluginDisplayElementStore.getState().elements;
  const removed = before
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => wanted.has(element.fullId));
  try {
    mutate();
  } catch (error) {
    // 부분 적용·리스너 실패 잔존 방지 - 캡처본 통복원 후 원 오류 전파
    usePluginDisplayElementStore
      .getState()
      .setElements([...before], { skipSync: true });
    throw error;
  }
  if (removed.length === 0) return null;
  return {
    rollback: () => {
      const store = usePluginDisplayElementStore.getState();
      const current = [...store.elements];
      const present = new Set(current.map((element) => element.fullId));
      let touched = false;
      for (const { element, index } of removed) {
        if (present.has(element.fullId)) continue;
        current.splice(Math.min(index, current.length), 0, element);
        touched = true;
      }
      if (touched) store.setElements(current, { skipSync: true });
    },
  };
};

// 추가 membership + 기존 요소 zIndex CAS: 신규 fullId는 제거로, 기존 요소의
// zIndex 변경은 expected 일치 시에만 before로 복원
export const applyPluginAdditionEagerly = (
  addedFullIds: readonly string[],
  zChanges: ReadonlyArray<{
    fullId: string;
    before: number | undefined;
    expected: number;
  }>,
  mutate: () => void,
): ElementIntentReceipt | null => {
  const before = usePluginDisplayElementStore.getState().elements;
  try {
    mutate();
  } catch (error) {
    // 부분 적용·리스너 실패 잔존 방지 - 캡처본 통복원 후 원 오류 전파
    usePluginDisplayElementStore
      .getState()
      .setElements([...before], { skipSync: true });
    throw error;
  }
  if (addedFullIds.length === 0 && zChanges.length === 0) return null;
  const added = new Set(addedFullIds);
  return {
    rollback: () => {
      const store = usePluginDisplayElementStore.getState();
      let current = store.elements;
      let touched = false;
      if (added.size > 0) {
        const filtered = current.filter(
          (element) => !added.has(element.fullId),
        );
        if (filtered.length !== current.length) {
          current = filtered;
          touched = true;
        }
      }
      if (zChanges.length > 0) {
        const byId = new Map(zChanges.map((change) => [change.fullId, change]));
        current = current.map((element) => {
          const change = byId.get(element.fullId);
          if (!change) return element;
          // CAS: 우리가 쓴 값 그대로일 때만 복원
          if (element.zIndex !== change.expected) return element;
          touched = true;
          return { ...element, zIndex: change.before };
        }) as typeof current;
      }
      if (touched) store.setElements([...current], { skipSync: true });
    },
  };
};
