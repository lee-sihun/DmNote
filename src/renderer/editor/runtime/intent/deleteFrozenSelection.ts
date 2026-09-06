import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { deletePluginElements } from '@plugins/runtime/displayElement/pluginElementActions';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { isNativeElementId } from '../../model/elementId';
import { unloadedPluginGroupMembers } from './pluginGroupMembers';
import {
  ElementIntentAbort,
  applySealedSliceMutation,
  combineReceipts,
  reportElementOpSkipped,
  type ElementIntentReceipt,
} from './elementIntent';
import {
  applyPluginRemovalEagerly,
  runMixedElementDeleteIntent,
  runMixedGestureElementIntent,
} from './mixedElementIntent';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { EditorOpV1 } from '@src/types/editor';

type NativeType = 'key' | 'stat' | 'graph' | 'knob' | 'sprite';

interface DeleteDocumentView {
  keys: Record<string, unknown[]>;
  keyPositions: Record<string, Array<{ id: string }>>;
  statPositions: Record<string, Array<{ id: string }>>;
  graphPositions: Record<string, Array<{ id: string }>>;
  knobPositions: Record<string, Array<{ id: string }>>;
  spritePositions: Record<string, Array<{ id: string }>>;
  layerGroups: Record<string, unknown[]>;
}

const storeView = (): DeleteDocumentView => ({
  keys: useKeyStore.getState().keyMappings as Record<string, unknown[]>,
  keyPositions: useKeyStore.getState().canonicalPositions as never,
  statPositions: useStatItemStore.getState().positions as never,
  graphPositions: useGraphItemStore.getState().positions as never,
  knobPositions: useKnobItemStore.getState().positions as never,
  spritePositions: useSpriteStore.getState().positions as never,
  layerGroups: useLayerGroupStore.getState().layerGroups as never,
});

export const deleteFrozenSelection = async (
  selectedElements: readonly SelectedElement[],
  options: {
    expectedAuthorityGeneration?: number;
    propagateErrors?: boolean;
  } = {},
): Promise<void> => {
  if (selectedElements.length === 0) return;

  // 동기 프레임 내 authority 세대 재검증은 중복 - 실제 보호는 await 경계 assert가 수행
  const gestureId = crypto.randomUUID();
  const stableTargets: Array<{ type: NativeType; id: string }> = [];
  const seenNativeIds = new Set<string>();
  for (const element of selectedElements) {
    if (element.type === 'plugin') continue;
    if (!isNativeElementId(element.id) || seenNativeIds.has(element.id)) {
      reportElementOpSkipped('batch delete (invalid native target)');
      return;
    }
    seenNativeIds.add(element.id);
    const type = element.type as NativeType;
    stableTargets.push({ type, id: element.id });
  }
  const pluginFullIds = selectedElements
    .filter((element) => element.type === 'plugin')
    .map((element) => element.id);
  // eager 제거 전 스토어의 전체 fullId - 정산 시점 projection에 이 집합에
  // 없는 fullId가 보이면 재주입(undo·재로드)으로 신원이 갈린 것이다
  const sealedKnownFullIds = new Set(
    usePluginDisplayElementStore
      .getState()
      .elements.map((element) => element.fullId),
  );
  const pluginIds = [
    ...new Set(
      usePluginDisplayElementStore
        .getState()
        .elements.filter((element) => pluginFullIds.includes(element.fullId))
        .map((element) => element.pluginId),
    ),
  ];
  const hasNative = stableTargets.length > 0;

  const collectRemoval = (document: DeleteDocumentView) => {
    const fields = {
      key: 'keyPositions',
      stat: 'statPositions',
      graph: 'graphPositions',
      knob: 'knobPositions',
      sprite: 'spritePositions',
    } as const;
    const removal = new Map<NativeType, Map<string, Set<number>>>();
    let found = 0;
    const mark = (type: NativeType, mode: string, index: number) => {
      const byMode = removal.get(type) ?? new Map<string, Set<number>>();
      const indices = byMode.get(mode) ?? new Set<number>();
      indices.add(index);
      byMode.set(mode, indices);
      removal.set(type, byMode);
      found += 1;
    };
    for (const target of stableTargets) {
      for (const [mode, list] of Object.entries(
        document[fields[target.type]],
      )) {
        const index = list.findIndex((position) => position.id === target.id);
        if (index >= 0) {
          mark(target.type, mode, index);
          break;
        }
      }
    }
    return { removal, found };
  };

  const applyRemoval = (
    document: DeleteDocumentView,
    removal: ReadonlyMap<NativeType, ReadonlyMap<string, ReadonlySet<number>>>,
  ) => {
    const next = {
      keys: { ...document.keys },
      keyPositions: { ...document.keyPositions },
      statPositions: { ...document.statPositions },
      graphPositions: { ...document.graphPositions },
      knobPositions: { ...document.knobPositions },
      spritePositions: { ...document.spritePositions },
    };
    const affectedModes = new Set<string>();
    for (const [type, byMode] of removal) {
      const field =
        type === 'key'
          ? 'keyPositions'
          : type === 'stat'
          ? 'statPositions'
          : type === 'graph'
          ? 'graphPositions'
          : type === 'knob'
          ? 'knobPositions'
          : 'spritePositions';
      for (const [mode, indices] of byMode) {
        affectedModes.add(mode);
        next[field] = {
          ...next[field],
          [mode]: (next[field][mode] ?? []).filter(
            (_, index) => !indices.has(index),
          ),
        };
        if (type === 'key') {
          const pairLength = (next.keys[mode] ?? []).length;
          if (pairLength !== (document.keyPositions[mode] ?? []).length) {
            throw new ElementIntentAbort('key pair length mismatch');
          }
          for (const index of indices) {
            if (index < 0 || index >= pairLength) {
              throw new ElementIntentAbort('key pair index out of range');
            }
          }
          next.keys = {
            ...next.keys,
            [mode]: (next.keys[mode] ?? []).filter(
              (_, index) => !indices.has(index),
            ),
          };
        }
      }
    }
    let layerGroups = document.layerGroups;
    let groupsChanged = false;
    // 삭제 후 남는 플러그인만 그룹 생존에 기여 - 삭제 대상 포함 집계는
    // 백엔드(plugin_changes 반영)와 어긋나 빈 그룹을 되살린다
    const deletedPluginIds = new Set(pluginFullIds);
    // 삭제분을 뺀 런타임 멤버 + 미로드 플러그인의 미러 참조.
    // 백엔드 생존 판정은 전 plugin_data 인스턴스를 보므로 모집단을 맞춘다
    const remainingPluginElements = [
      ...usePluginDisplayElementStore
        .getState()
        .elements.filter((element) => !deletedPluginIds.has(element.fullId)),
      ...unloadedPluginGroupMembers(),
    ];
    for (const mode of affectedModes) {
      const normalized = normalizeLayerGroupsForMode({
        mode,
        keyPositions: next.keyPositions as never,
        statPositions: next.statPositions as never,
        graphPositions: next.graphPositions as never,
        knobPositions: next.knobPositions as never,
        spritePositions: next.spritePositions as never,
        layerGroups: layerGroups as never,
        pluginElements: remainingPluginElements,
      });
      next.keyPositions = normalized.keyPositions as never;
      next.statPositions = normalized.statPositions as never;
      next.graphPositions = normalized.graphPositions as never;
      next.knobPositions = normalized.knobPositions as never;
      next.spritePositions = normalized.spritePositions as never;
      if (normalized.groupsChanged) {
        layerGroups = normalized.layerGroups as never;
        groupsChanged = true;
      }
    }
    return { next, layerGroups, groupsChanged, affectedModes };
  };

  useGridSelectionStore.getState().clearSelection();
  try {
    if (pluginIds.length > 0) {
      beginMixedGestureTransaction(gestureId, pluginIds);
    }
    const eagerView = storeView();
    const eagerPlan = collectRemoval(eagerView);
    const eagerModes = new Set<string>();
    for (const byMode of eagerPlan.removal.values()) {
      for (const mode of byMode.keys()) eagerModes.add(mode);
    }
    const editorReceipt = hasNative
      ? applySealedSliceMutation({
          modes: [...eagerModes],
          fields: [
            'keys',
            'keyPositions',
            'statPositions',
            'graphPositions',
            'knobPositions',
            'spritePositions',
            'layerGroups',
          ],
          mutate: () => {
            if (eagerPlan.found === 0) return;
            const applied = applyRemoval(eagerView, eagerPlan.removal);
            useKeyStore
              .getState()
              .setKeyMappingsAndPositions(
                applied.next.keys as never,
                applied.next.keyPositions as never,
              );
            useStatItemStore
              .getState()
              .setPositions(applied.next.statPositions as never);
            useGraphItemStore
              .getState()
              .setPositions(applied.next.graphPositions as never);
            useKnobItemStore
              .getState()
              .setPositions(applied.next.knobPositions as never);
            useSpriteStore
              .getState()
              .setPositions(applied.next.spritePositions as never);
            if (applied.groupsChanged) {
              useLayerGroupStore
                .getState()
                .setLayerGroups(applied.layerGroups as never);
            }
          },
        })
      : null;
    let pluginReceipt: ElementIntentReceipt | null = null;
    try {
      pluginReceipt = applyPluginRemovalEagerly(pluginFullIds, () => {
        if (pluginFullIds.length > 0) {
          deletePluginElements(pluginFullIds, gestureId);
        }
      });
    } catch (error) {
      editorReceipt?.rollback();
      throw error;
    }
    const receipt = combineReceipts(editorReceipt, pluginReceipt);
    if (stableTargets.length > 0) {
      const ops: EditorOpV1[] = stableTargets.map((target) => ({
        kind: 'deleteElement',
        elementType: target.type,
        id: target.id,
      }));
      try {
        await runMixedElementDeleteIntent({
          gestureId,
          pluginIds,
          deletedPluginFullIds: pluginFullIds,
          ops,
          receipt,
          expectedAuthorityGeneration: options.expectedAuthorityGeneration,
        });
      } catch (error) {
        if (options.propagateErrors) throw error;
        console.error('Failed to persist selected element deletion', error);
      }
      return;
    }

    try {
      if (pluginFullIds.length > 0) {
        const deleted = new Set(pluginFullIds);
        const settlement = await runMixedGestureElementIntent({
          gestureId,
          initialPluginIds: pluginIds,
          pluginScope: () => pluginIds,
          receipt,
          // 여기는 stableTargets가 빈 plugin 전용 경로다. native 삭제 대상이
          // 없어 editor patch는 항상 비고, plugin projection만 정산한다
          generate: ({ pluginProjection }) => {
            // 동결 이후 낯선 fullId 출현(플러그인 리로드 등)은 신원이 갈린
            // 것이다 - 성공 위장 대신 중단해 skip 관측에 맡긴다 (방어 존치).
            // 게스처 스코프로 좁힌다 - projection은 스토어 전량이라, 무관한
            // 플러그인이 정산 대기 창에 요소를 추가하면 이 삭제와 상관없이
            // 전체가 중단됐다
            if (
              pluginProjection.some(
                (element) =>
                  pluginIds.includes(element.pluginId) &&
                  !sealedKnownFullIds.has(element.fullId),
              )
            ) {
              throw new ElementIntentAbort('batch delete settlement');
            }
            // diff-patch undo는 같은 fullId를 되살린다 - 소멸 대상의 재출현은
            // undo 환생 신호라 재삭제 정산 대신 중단한다
            if (
              pluginProjection.some((element) => deleted.has(element.fullId))
            ) {
              throw new ElementIntentAbort('batch delete settlement');
            }
            const desired = pluginProjection.filter(
              (element) => !deleted.has(element.fullId),
            );
            if (desired.length === pluginProjection.length) {
              return { kind: 'satisfied' };
            }
            return {
              kind: 'patch',
              patch: null,
              desiredPluginProjection: desired,
            };
          },
          skipContext: 'batch delete settlement',
          expectedAuthorityGeneration: options.expectedAuthorityGeneration,
        });
        // 정산이 중단됐는데(abort 흡수) 반환값을 버리면 패널 RPC 경계에서
        // 성공으로 응답한다. 형제 op(remove·setHidden)가 대상 소실을 거절하는
        // 것과 같은 취지로 실패를 전파한다 (RPC는 DELETE_SELECTION_FAILED로 응답)
        if (!settlement.committed && !settlement.satisfied) {
          throw new ElementIntentAbort('batch delete settlement');
        }
      }
    } catch (error) {
      if (options.propagateErrors) throw error;
      // abort도 여기서 남긴다. 러너의 skip 보고는 컨텍스트 문자열뿐이라
      // 중단 원인(error)을 잃는다
      console.error('Failed to persist selected element deletion', error);
    }
  } finally {
    cancelUncommittedMixedGestureTransaction(gestureId);
  }
};
