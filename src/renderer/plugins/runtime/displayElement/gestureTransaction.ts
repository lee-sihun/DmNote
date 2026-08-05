import { gestureApi } from '@api/modules/gestureApi';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStatusStore } from '@stores/data/useHistoryStatusStore';
import { getPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';
import {
  getBackendPluginRevision,
  noteBackendPluginRevision,
} from '@plugins/rpc/pluginModelRevision';
import {
  applyCanonicalPluginInstances,
  notePluginInstancesMutation,
} from './instancesUndoSync';
import { buildSavedPluginInstances } from '../api/defineElement';
import {
  drainPluginInstancesCommitQueues,
  getStagedPluginInstancesGestureId,
  hasConflictingPluginInstancesGesture,
  stagePluginInstancesGesture,
  unstagePluginInstancesGesture,
} from './instancesCommitQueue';
import { schedulePluginPanelModelSync } from '@utils/plugin/panelModelSync';

import type { EditorPatchV1 } from '@src/types/editor';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

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

const buildCommittedElementProjection = (
  currentElements: readonly PluginDisplayElementInternal[],
  pluginElements: ReadonlyMap<string, PluginDisplayElementInternal[]>,
): PluginDisplayElementInternal[] => {
  const inserted = new Set<string>();
  const projected: PluginDisplayElementInternal[] = [];
  for (const element of currentElements) {
    const pluginId = element.definitionId;
    if (!pluginId || !pluginElements.has(pluginId)) {
      projected.push(element);
      continue;
    }
    if (!inserted.has(pluginId)) {
      projected.push(...(pluginElements.get(pluginId) ?? []));
      inserted.add(pluginId);
    }
  }
  for (const [pluginId, elements] of pluginElements) {
    if (!inserted.has(pluginId)) projected.push(...elements);
  }
  return projected;
};

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

export const commitMixedGestureTransaction = (
  gestureId: string,
  editorChanges: EditorPatchV1,
  pluginIds: readonly string[],
): Promise<void> => {
  const normalizedPluginIds = normalizePluginIds(pluginIds);
  beginMixedGestureTransaction(gestureId, normalizedPluginIds);
  const staged = stagedGestures.get(gestureId);
  if (staged) staged.committing = true;
  let gestureResult: Awaited<ReturnType<typeof gestureApi.commit>> | null =
    null;
  let committedElements: PluginDisplayElementInternal[] | null = null;
  let committedDefinitions: Map<string, PluginDefinitionInternal> | null = null;
  let commitWork: Promise<void>;

  try {
    commitWork = editorCoordinator
      .commitGesture(editorChanges, gestureId, async (context) => {
        await drainPluginInstancesCommitQueues(normalizedPluginIds);
        const { elements, definitions } =
          usePluginDisplayElementStore.getState();
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
        committedElements = buildCommittedElementProjection(
          elements,
          pluginElements,
        );
        committedDefinitions = definitions;
        notePluginInstancesMutation(context.mutationId);
        const result = await gestureApi.commit({
          gestureId,
          mutationId: context.mutationId,
          editorBaseRevision: context.editorBaseRevision,
          pluginBaseRevision: getBackendPluginRevision(),
          observedHistoryEpoch: useHistoryStatusStore.getState().historyEpoch,
          authorityGeneration: getPluginAuthorityGeneration(),
          editorChanges: context.editorChanges,
          pluginChanges,
        });
        noteBackendPluginRevision(result.pluginModelRevision);
        gestureResult = result;
        return {
          revision: result.editorRevision,
          changedFields: result.changedFields,
        };
      })
      .then(() => {
        if (
          gestureResult &&
          committedElements &&
          committedDefinitions &&
          gestureResult.changedPluginIds.length > 0
        ) {
          try {
            schedulePluginPanelModelSync(
              committedElements,
              committedDefinitions,
              gestureResult.pluginModelRevision,
            );
          } catch (error) {
            console.error('Failed to publish committed plugin model', error);
          }
        }
      });
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
