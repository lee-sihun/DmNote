import {
  commitMixedGestureIntent,
  commitMixedGestureTransaction,
  type MixedIntentGeneration,
} from '@plugins/runtime/displayElement/gestureTransaction';

import {
  ElementIntentAbort,
  isElementIntentAbort,
  reportElementOpSkipped,
} from './elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { getPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

import { EDITOR_OPS_VERSION } from '@src/types/editor';

import type { CanonicalEditorDocumentV1, EditorOpV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import type { ElementIntentReceipt } from './elementIntent';

export const runMixedElementOpsIntent = async (options: {
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
        { opsVersion: EDITOR_OPS_VERSION, ops: options.ops },
        options.pluginIds,
        { onEnrolled },
      );
    }
  } catch (error) {
    if (!enrolled) options.receipt?.rollback();
    throw error;
  }
};

export const runMixedElementDeleteIntent = async (options: {
  gestureId: string;
  pluginIds: readonly string[];
  deletedPluginFullIds: readonly string[];
  ops: readonly EditorOpV1[];
  receipt: ElementIntentReceipt | null;
  expectedAuthorityGeneration?: number;
}): Promise<void> => {
  const assertAuthorityGeneration = () => {
    if (
      options.expectedAuthorityGeneration !== undefined &&
      options.expectedAuthorityGeneration !== getPluginAuthorityGeneration()
    ) {
      throw new Error('plugin authority generation changed');
    }
  };
  // 진입 동기 프레임 재검증은 중복 - preflight·post-commit assert가 보호
  const deleted = new Set(options.deletedPluginFullIds);
  let enrolled = false;
  let rolledBack = false;
  const rollbackOnce = () => {
    if (rolledBack) return;
    rolledBack = true;
    options.receipt?.rollback();
  };
  try {
    const onEnrolled = () => {
      enrolled = true;
    };
    if (options.pluginIds.length === 0) {
      await commitSemanticOps(options.ops, {
        gestureId: options.gestureId,
        preflight: assertAuthorityGeneration,
        onEnrolled,
      });
      assertAuthorityGeneration();
      return;
    }
    await commitMixedGestureIntent({
      gestureId: options.gestureId,
      initialPluginIds: options.pluginIds,
      pluginScope: () => options.pluginIds,
      generate: ({ pluginProjection }) => {
        // diff-patch undo는 같은 fullId를 되살린다 - 소멸 대상의 재출현은
        // undo 환생 신호라 무음 재삭제 대신 전체 중단한다
        if (pluginProjection.some((element) => deleted.has(element.fullId))) {
          throw new ElementIntentAbort('mixed delete settlement');
        }
        return {
          kind: 'ops',
          ops: options.ops,
          desiredPluginProjection: pluginProjection.filter(
            (element) => !deleted.has(element.fullId),
          ),
        };
      },
      onEnrolled,
      onFailureBeforeSettle: (error) => {
        // 전체 중단은 편입 후에도 eager를 복원해야 환생분이 살아남는다 -
        // staged 해제 전 동기 복원 (runMixedGestureElementIntent와 동일 규약)
        if (!enrolled || isElementIntentAbort(error)) rollbackOnce();
      },
      expectedAuthorityGeneration: options.expectedAuthorityGeneration,
    });
  } catch (error) {
    if (isElementIntentAbort(error)) {
      // 중단은 오류가 아니라 fail-closed 무커밋 - receipt 복원 후 skip 관측
      rollbackOnce();
      reportElementOpSkipped('mixed delete settlement');
      return;
    }
    if (!enrolled) rollbackOnce();
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
    base: CanonicalEditorDocumentV1;
    pluginProjection: readonly PluginDisplayElementInternal[];
  }) => MixedIntentGeneration;
  skipContext: string;
  retryEditorOnly?: boolean;
  expectedAuthorityGeneration?: number;
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
      retryEditorOnly: options.retryEditorOnly,
      expectedAuthorityGeneration: options.expectedAuthorityGeneration,
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
  const beforeIds = new Set(before.map((element) => element.fullId));
  const removed = before
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => wanted.has(element.fullId));
  const removedDefinitionIds = new Set(
    removed
      .map(({ element }) => element.definitionId)
      .filter((definitionId): definitionId is string => Boolean(definitionId)),
  );
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
      // diff-patch 재주입은 fullId를 보존하므로 이 감지는 undo 경로에선
      // 발화하지 않는다 - undo가 같은 fullId를 이미 되살린 경우는 아래
      // present 중복 검사가 이중 재삽입을 막는다. 플러그인 리로드 등으로
      // 캡처 시점에 없던 fullId가 출현한 경우만 복원을 포기한다 -
      // canonical이 진실을 소유
      const reinjected = current.some(
        (element) =>
          element.definitionId &&
          removedDefinitionIds.has(element.definitionId) &&
          !beforeIds.has(element.fullId),
      );
      if (reinjected) return;
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
