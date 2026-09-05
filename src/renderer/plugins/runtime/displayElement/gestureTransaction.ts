import { gestureApi } from '@api/modules/gestureApi';
import { editorApi } from '@api/modules/editorApi';
import { editorCoordinator } from '@src/renderer/editor/runtime/coordinator/editorStateCoordinator';
import { trackEditorWrite } from '@src/renderer/editor/runtime/lifecycle/editorWriteBarrier';
import { ElementIntentAbort } from '@src/renderer/editor/runtime/intent/elementIntent';
import { stableStringify } from '@utils/core/stableStringify';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStatusStore } from '@stores/data/useHistoryStatusStore';
import { getPluginAuthorityGeneration } from '@plugins/runtime/pluginAuthorityGeneration';
import {
  getBackendPluginRevision,
  noteBackendPluginRevision,
} from '@plugins/runtime/pluginModelRevision';
import {
  applyCanonicalPluginInstances,
  notePluginInstancesMutation,
} from './instancesUndoSync';
import { buildSavedPluginInstances } from '../api/defineElement';
import {
  drainPluginInstancesCommitQueues,
  getStagedPluginInstancesGestureId,
  hasConflictingPluginInstancesGesture,
  rotatePluginInstancesEditSession,
  stagePluginInstancesGesture,
  unstagePluginInstancesGesture,
} from './instancesCommitQueue';
import { EDITOR_OPS_VERSION } from '@src/types/editor';

import type {
  EditorGestureOpsMutation,
  EditorPatchGenerator,
} from '@src/renderer/editor/runtime/coordinator/editorCoordinator';
import type {
  CanonicalEditorDocumentV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

interface StagedGesture {
  pluginIds: Set<string>;
  sealedPluginElements: Map<string, PluginDisplayElementInternal[]>;
  resolve: () => void;
  // commit이 소유권을 가져간 staged는 취소 안전망이 건드리지 않음
  committing: boolean;
}

const stagedGestures = new Map<string, StagedGesture>();

const normalizePluginIds = (pluginIds: readonly string[]): string[] =>
  [...new Set(pluginIds)].sort();

export const beginMixedGestureTransaction = (
  gestureId: string,
  pluginIds: readonly string[],
): void => {
  const normalized = normalizePluginIds(pluginIds);
  if (normalized.length === 0) return;

  let staged = stagedGestures.get(gestureId);
  if (!staged) {
    let resolve!: () => void;
    const pending = new Promise<void>((resolvePending) => {
      resolve = resolvePending;
    });
    trackEditorWrite(pending);
    staged = {
      pluginIds: new Set(),
      sealedPluginElements: new Map(),
      resolve,
      committing: false,
    };
    stagedGestures.set(gestureId, staged);
  }
  const currentElements = usePluginDisplayElementStore.getState().elements;
  normalized.forEach((pluginId) => {
    const previousGestureId = getStagedPluginInstancesGestureId(pluginId);
    if (previousGestureId && previousGestureId !== gestureId) {
      const previous = stagedGestures.get(previousGestureId);
      if (previous && !previous.sealedPluginElements.has(pluginId)) {
        previous.sealedPluginElements.set(
          pluginId,
          currentElements.filter(
            (element) => element.definitionId === pluginId,
          ),
        );
      }
    }
    staged.pluginIds.add(pluginId);
    stagePluginInstancesGesture(pluginId, gestureId);
  });
};

const settleMixedGestureTransaction = (gestureId: string): void => {
  const staged = stagedGestures.get(gestureId);
  if (!staged) return;
  staged.pluginIds.forEach((pluginId) => {
    unstagePluginInstancesGesture(pluginId, gestureId);
  });
  stagedGestures.delete(gestureId);
  staged.resolve();
};

export const cancelMixedGestureTransaction = (gestureId: string): void => {
  settleMixedGestureTransaction(gestureId);
};

// 제스처 경계 cleanup용 안전망 - 종료 경로가 혼합 커밋을 타지 않아
// staged가 남으면 barrier가 영구 대기하므로, 커밋이 시작되지 않은 것만 정산
export const cancelUncommittedMixedGestureTransaction = (
  gestureId: string,
): void => {
  const staged = stagedGestures.get(gestureId);
  if (!staged || staged.committing) return;
  settleMixedGestureTransaction(gestureId);
};

// 슬롯 정합 mixed 의도 커밋: prepare 고정점이 plugin 큐를 drain하고 스코프를
// 확정한 뒤 projection을 봉인하면, generator가 editor base와 같은 시점의
// projection으로 patch와 desired plugin 상태를 함께 산출한다. transaction은
// raw 봉인본이 아니라 desired를 저장한다 - 호출 시점 스냅샷과 슬롯 base를
// 섞으면 stale z-order가 재발한다
export interface MixedIntentGeneration {
  kind: 'patch' | 'ops' | 'satisfied';
  patch?: EditorPatchV1 | null;
  ops?: readonly EditorOpV1[];
  // 계약: scope 전체 projection을 표현해야 한다 - 성공 후 3-way 정렬이
  // "봉인에 있었고 desired에 없음"을 커밋된 삭제로 해석하므로, 부분
  // projection을 반환하면 scope 요소가 조용히 삭제된다
  desiredPluginProjection?: PluginDisplayElementInternal[];
}

export const commitMixedGestureIntent = (options: {
  gestureId: string;
  initialPluginIds: readonly string[];
  // prepare 고정점에서 스코프 재계산 (예: 현재 mode의 전체 definition id).
  // drain 사이 신규 definition 출현을 흡수한다
  pluginScope: (
    elements: readonly PluginDisplayElementInternal[],
  ) => readonly string[];
  generate: (context: {
    base: CanonicalEditorDocumentV1;
    pluginProjection: readonly PluginDisplayElementInternal[];
  }) => MixedIntentGeneration;
  onEnrolled?: () => void;
  // 실패 시 staged 해제·canonical pull 전에 동기 실행 - eager receipt
  // 복원의 소유 지점 (해제 후 복원은 stagedSavePending 재저장과 경합)
  onFailureBeforeSettle?: (error: unknown) => void;
  retryEditorOnly?: boolean;
  expectedAuthorityGeneration?: number;
}): Promise<void> => {
  const assertAuthorityGeneration = () => {
    if (
      options.expectedAuthorityGeneration !== undefined &&
      options.expectedAuthorityGeneration !== getPluginAuthorityGeneration()
    ) {
      throw new ElementIntentAbort('plugin authority generation changed');
    }
  };
  assertAuthorityGeneration();
  const scope = new Set(normalizePluginIds(options.initialPluginIds));
  const gestureId = options.gestureId;
  if (scope.size > 0) {
    beginMixedGestureTransaction(gestureId, [...scope]);
    const staged = stagedGestures.get(gestureId);
    if (staged) staged.committing = true;
  }

  let sealedProjection: readonly PluginDisplayElementInternal[] = [];
  let lastGeneration: MixedIntentGeneration | null = null;
  let editorOnlyCommit = false;

  const prepare = async (): Promise<void> => {
    // 고정점: drain 중 나타난 신규 definition을 stage하고 다시 drain.
    // 상한 도달 = 고정점 미성립 - 미drain 스코프를 봉인하면 fail-open이므로
    // 전체 중단한다
    for (let round = 0; round < 8; round += 1) {
      assertAuthorityGeneration();
      if (scope.size > 0) {
        await drainPluginInstancesCommitQueues([...scope]);
        assertAuthorityGeneration();
      }
      const elements = usePluginDisplayElementStore.getState().elements;
      const wanted = normalizePluginIds([
        ...options.pluginScope(elements),
        ...scope,
      ]);
      const grew = wanted.some((pluginId) => !scope.has(pluginId));
      if (!grew) {
        assertAuthorityGeneration();
        sealedProjection = elements;
        return;
      }
      const discovered = wanted.filter((pluginId) => !scope.has(pluginId));
      wanted.forEach((pluginId) => scope.add(pluginId));
      beginMixedGestureTransaction(gestureId, wanted);
      // 발견 전에 예약된 debounce는 아직 큐에 없다 - 같은 게스처로 rotate해
      // 큐로 밀어 넣어야 다음 라운드 drain이 관측한다
      discovered.forEach((pluginId) => {
        rotatePluginInstancesEditSession(pluginId, gestureId);
      });
      const staged = stagedGestures.get(gestureId);
      if (staged) staged.committing = true;
    }
    throw new ElementIntentAbort('plugin scope fixed point not reached');
  };

  let commitWork: Promise<void>;
  try {
    commitWork = editorCoordinator
      .commitGesture(
        (base) => {
          assertAuthorityGeneration();
          const generation = options.generate({
            base,
            pluginProjection: sealedProjection,
          });
          lastGeneration = generation;
          if (generation.kind === 'patch') return generation.patch ?? null;
          if (generation.kind === 'ops') {
            return {
              opsVersion: EDITOR_OPS_VERSION,
              ops: generation.ops ?? [],
            };
          }
          return null;
        },
        gestureId,
        async (context) => {
          assertAuthorityGeneration();
          const projectionSource =
            lastGeneration?.desiredPluginProjection ?? sealedProjection;
          const scopeIds = normalizePluginIds([...scope]);
          if (scopeIds.length === 0) {
            editorOnlyCommit = true;
            if ('editorOps' in context) {
              const result = await editorApi.commit({
                baseRevision: context.editorBaseRevision,
                mutationId: context.mutationId,
                opsVersion: context.editorOpsVersion,
                ops: context.editorOps,
                gestureId,
              });
              assertAuthorityGeneration();
              return result;
            }
            if (!context.editorChanges) {
              return {
                revision: context.editorBaseRevision,
                changedFields: [],
              };
            }
            const result = await editorApi.commit({
              baseRevision: context.editorBaseRevision,
              mutationId: context.mutationId,
              changes: context.editorChanges,
              gestureId,
            });
            assertAuthorityGeneration();
            return result;
          }
          const pluginElements = new Map(
            scopeIds.map((pluginId) => [
              pluginId,
              projectionSource.filter(
                (element) => element.definitionId === pluginId,
              ),
            ]),
          );
          const pluginChanges = scopeIds.map((pluginId) => ({
            pluginId,
            instances: buildSavedPluginInstances(
              pluginElements.get(pluginId) ?? [],
              pluginId,
            ),
          }));
          notePluginInstancesMutation(context.mutationId);
          const result = await gestureApi.commit({
            gestureId,
            mutationId: context.mutationId,
            editorBaseRevision: context.editorBaseRevision,
            pluginBaseRevision: getBackendPluginRevision(),
            observedHistoryEpoch: useHistoryStatusStore.getState().historyEpoch,
            authorityGeneration:
              options.expectedAuthorityGeneration ??
              getPluginAuthorityGeneration(),
            ...('editorOps' in context
              ? {
                  editorOpsVersion: context.editorOpsVersion,
                  editorOps: context.editorOps,
                }
              : context.editorChanges
              ? { editorChanges: context.editorChanges }
              : {}),
            pluginChanges,
          });
          assertAuthorityGeneration();
          noteBackendPluginRevision(result.pluginModelRevision);
          return {
            revision: result.editorRevision,
            changedFields: result.changedFields,
            ...('editorOps' in context
              ? { opResults: result.editorOpResults }
              : {}),
          };
        },
        {
          onEnrolled: options.onEnrolled,
          prepare,
          reconcileRetryableEditorIntent: () =>
            editorOnlyCommit && options.retryEditorOnly !== false,
        },
      )
      .then(() => {
        assertAuthorityGeneration();
        // prepare가 동적으로 편입한 plugin의 재계산 상태를 main store에도
        // 정렬 - 자기 mutation 이벤트는 무시되므로 여기서 반영하지 않으면
        // main·overlay·backend가 갈라진다. 3-way 정렬의 소유 단위는 영속
        // 필드(defineElement의 saved projection)다 - 전체 객체 비교는
        // 봉인 후 state·핸들러 갱신만으로 소유 판정을 깨뜨린다.
        // membership 삭제(봉인에 있었고 desired에 없음)는 커밋된 canonical
        // 사실이라 소유 증명 없이 제거하고, 봉인 후 신규 요소는 보존한다
        const PERSISTED_FIELDS = [
          'position',
          'settings',
          'measuredSize',
          'tabId',
          'hidden',
          'zIndex',
          'groupId',
        ] as const;
        const desired = lastGeneration?.desiredPluginProjection;
        if (desired) {
          const store = usePluginDisplayElementStore.getState();
          const scopeIds = new Set(scope);
          const desiredById = new Map(
            desired.map((element) => [element.fullId, element]),
          );
          const sealedById = new Map(
            sealedProjection.map((element) => [element.fullId, element]),
          );
          let touched = false;
          const merged: PluginDisplayElementInternal[] = [];
          for (const element of store.elements) {
            if (!element.definitionId || !scopeIds.has(element.definitionId)) {
              merged.push(element);
              continue;
            }
            const want = desiredById.get(element.fullId);
            if (!want) {
              if (sealedById.has(element.fullId)) {
                // 커밋된 삭제 - 재주입 잔존 제거
                touched = true;
                continue;
              }
              merged.push(element);
              continue;
            }
            const sealed = sealedById.get(element.fullId);
            if (!sealed) {
              merged.push(element);
              continue;
            }
            // 영속 필드별 CAS: 의도가 실제로 바꾼 필드만, 현재 값이 봉인과
            // 같을 때(우리 소유 증명) desired로
            let next = element;
            let changed = false;
            for (const field of PERSISTED_FIELDS) {
              const sealedValue = (sealed as Record<string, unknown>)[field];
              const wantValue = (want as Record<string, unknown>)[field];
              if (stableStringify(sealedValue) === stableStringify(wantValue)) {
                continue;
              }
              const currentValue = (element as Record<string, unknown>)[field];
              if (
                stableStringify(currentValue) !== stableStringify(sealedValue)
              ) {
                continue;
              }
              next = { ...next, [field]: wantValue };
              changed = true;
            }
            if (changed) touched = true;
            merged.push(next);
          }
          if (touched) {
            // overlay까지 정렬 - skipSync로 main만 갱신하면 삭제 재주입의
            // ghost가 overlay에 남는다
            store.setElements(merged);
          }
        }
      });
  } catch (error) {
    commitWork = Promise.reject(error);
  }

  const committed = commitWork
    .catch(async (error) => {
      // eager 복원은 staged 해제 전에 - 해제가 stagedSavePending 재저장을
      // 예약해 eager 잔존을 영속시킬 수 있다
      try {
        options.onFailureBeforeSettle?.(error);
      } catch (rollbackError) {
        console.error('mixed intent rollback failed', rollbackError);
      }
      await Promise.allSettled(
        [...scope].map(async (pluginId) => {
          if (hasConflictingPluginInstancesGesture(pluginId, gestureId)) {
            return;
          }
          await applyCanonicalPluginInstances(pluginId, true);
        }),
      );
      throw error;
    })
    .finally(() => {
      settleMixedGestureTransaction(gestureId);
    });

  return trackEditorWrite(committed);
};

export const commitMixedGestureTransaction = (
  gestureId: string,
  // generator는 coordinator 직렬 슬롯 안에서 최신 base로 평가된다 -
  // 호출 시점 캡처 full-record는 대기 중 정산된 커밋을 되돌린다.
  // null 반환 시 editorChanges 없이 plugin 변경만 커밋
  editorChanges:
    | EditorPatchV1
    | EditorPatchGenerator
    | EditorGestureOpsMutation,
  pluginIds: readonly string[],
  meta?: { onEnrolled?: () => void },
): Promise<void> => {
  const normalizedPluginIds = normalizePluginIds(pluginIds);
  beginMixedGestureTransaction(gestureId, normalizedPluginIds);
  const staged = stagedGestures.get(gestureId);
  if (staged) staged.committing = true;
  let commitWork: Promise<void>;

  try {
    commitWork = editorCoordinator
      .commitGesture(
        editorChanges,
        gestureId,
        async (context) => {
          await drainPluginInstancesCommitQueues(normalizedPluginIds);
          const { elements } = usePluginDisplayElementStore.getState();
          const stagedAtCommit = stagedGestures.get(gestureId);
          const pluginElements = new Map(
            normalizedPluginIds.map((pluginId) => [
              pluginId,
              stagedAtCommit?.sealedPluginElements.get(pluginId) ??
                elements.filter((element) => element.definitionId === pluginId),
            ]),
          );
          const pluginChanges = normalizedPluginIds.map((pluginId) => ({
            pluginId,
            instances: buildSavedPluginInstances(
              pluginElements.get(pluginId) ?? [],
              pluginId,
            ),
          }));
          notePluginInstancesMutation(context.mutationId);
          const request = {
            gestureId,
            mutationId: context.mutationId,
            editorBaseRevision: context.editorBaseRevision,
            pluginBaseRevision: getBackendPluginRevision(),
            observedHistoryEpoch: useHistoryStatusStore.getState().historyEpoch,
            authorityGeneration: getPluginAuthorityGeneration(),
            ...('editorOps' in context
              ? {
                  editorOpsVersion: context.editorOpsVersion,
                  editorOps: context.editorOps,
                }
              : context.editorChanges
              ? { editorChanges: context.editorChanges }
              : {}),
            pluginChanges,
          };
          const result = await gestureApi.commit(request);
          noteBackendPluginRevision(result.pluginModelRevision);
          return {
            revision: result.editorRevision,
            changedFields: result.changedFields,
            ...('editorOps' in context
              ? { opResults: result.editorOpResults }
              : {}),
          };
        },
        meta,
      )
      .then(() => undefined);
  } catch (error) {
    commitWork = Promise.reject(error);
  }

  const committed = commitWork
    .catch(async (error) => {
      await Promise.allSettled(
        normalizedPluginIds.map(async (pluginId) => {
          if (hasConflictingPluginInstancesGesture(pluginId, gestureId)) {
            return;
          }
          await applyCanonicalPluginInstances(pluginId, true);
        }),
      );
      throw error;
    })
    .finally(() => {
      settleMixedGestureTransaction(gestureId);
    });

  return trackEditorWrite(committed);
};
