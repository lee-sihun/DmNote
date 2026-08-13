/**
 * Grid 선택 관련 로직 훅
 * - 선택된 요소들 이동
 * - 선택된 요소들 삭제
 * - 복사/붙여넣기
 */

import { newElementId } from '@src/renderer/editor/model/elementId';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  useGridSelectionStore,
  type SelectedElement,
  type ClipboardItem,
} from '@stores/grid/useGridSelectionStore';
import { PASTE_OFFSET } from './constants';
import type {
  KeyMappings,
  KeyPositions,
  KeyPosition,
  KeySlot,
} from '@src/types/key/keys';
import { cloneSlot } from '@utils/keySlot';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  normalizeLayerGroupsForMode,
  buildNextLayerGroupName,
  buildLayerItemsForMode,
  applyZIndexToLayerOrder,
  orderPastedItemsByFrozenZ,
} from '@utils/layerGroupUtils';
import { commitSelectedGeometryByIds } from '@src/renderer/editor/runtime/elementOps';
import {
  ElementIntentAbort,
  applySealedSliceMutation,
  captureIndexIntentBaseline,
  combineReceipts,
  createPropertyReceipt,
  generatePropertyIntentPatch,
  indexBaselineMatches,
  reportElementOpError,
  reportElementOpSkipped,
  runElementIntent,
  type ElementIntentReceipt,
  type PropertyIntents,
  type PropertyReceiptEntry,
} from '@src/renderer/editor/runtime/elementIntent';
import {
  applyPluginAdditionEagerly,
  applyPluginRemovalEagerly,
  runMixedElementIntent,
  runMixedGestureElementIntent,
} from '@src/renderer/editor/runtime/mixedElementIntent';
import { stableStringify } from '@utils/core/stableStringify';
import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { deletePluginElements } from '@plugins/rpc/pluginElementActions';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';

interface UseGridSelectionParams {
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  keyMappings: KeyMappings;
  positions: KeyPositions;
}

interface UseGridSelectionReturn {
  moveSelectedElements: (
    deltaX: number,
    deltaY: number,
    gestureId?: string,
    syncToOverlay?: boolean,
  ) => void;
  deleteSelectedElements: () => Promise<void>;
  copySelectedElements: () => void;
  pasteElements: () => Promise<void>;
  syncSelectedElementsToOverlay: (gestureId?: string) => void;
  clipboard: ClipboardItem[];
}

/**
 * 선택된 요소들 관리 훅
 */
export function useGridSelection({
  selectedElements,
  selectedKeyType,
  keyMappings: _keyMappings,
  positions: _positions,
}: UseGridSelectionParams): UseGridSelectionReturn {
  const clearSelection = useGridSelectionStore((state) => state.clearSelection);
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );
  const clipboard = useGridSelectionStore((state) => state.clipboard);
  const setClipboard = useGridSelectionStore((state) => state.setClipboard);

  // 선택된 요소들의 최종 위치를 한 번에 저장
  // 커밋 base는 canonical - rendered에는 다른 세션의 미커밋 프리뷰가 섞일 수 있음
  const syncSelectedElementsToOverlay = (gestureId?: string) => {
    const currentPositions = useKeyStore.getState().canonicalPositions;
    const currentStatPositions = useStatItemStore.getState().positions;
    const currentGraphPositions = useGraphItemStore.getState().positions;
    const currentKnobPositions = useKnobItemStore.getState().positions;
    const currentSelection = useGridSelectionStore.getState().selectedElements;
    const selectedPluginElementIds = new Set(
      currentSelection
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
    const pluginIds = [
      ...new Set(
        usePluginDisplayElementStore
          .getState()
          .elements.filter((element) =>
            selectedPluginElementIds.has(element.fullId),
          )
          .map((element) => element.pluginId),
      ),
    ];
    const isMixed =
      currentSelection.some((element) => element.type !== 'plugin') &&
      pluginIds.length > 0;
    // 안정 id native 선택은 기하 의도 커밋 - full-record 캡처는 배타
    // mutation 직후에 착지해 무관 필드 재작성을 되돌린다. 합성 id가 하나라도
    // 있으면 전체 legacy 폴백 (혼합 플러그인 트랜잭션도 기존 경로 유지)
    const nativeTargets = currentSelection
      .filter(
        (element): element is (typeof currentSelection)[number] =>
          element.type !== 'plugin',
      )
      .map((element) => ({
        type: element.type as 'key' | 'stat' | 'graph' | 'knob',
        id: element.id,
      }));
    const allStableIds =
      nativeTargets.length > 0 &&
      nativeTargets.every(
        (target) => target.id.length > 0 && !isSyntheticElementId(target.id),
      );
    // plugin-only 선택은 editor 의도가 없다 - editor 무커밋
    if (nativeTargets.length > 0) {
      if (!allStableIds) {
        // 합성 선택 정산은 시작 fingerprint 배관이 없어 fail-closed 무커밋.
        // v1 어댑터가 로드 시 id를 backfill하므로 실도달 불가 경로
        if (gestureId && isMixed) {
          // plugin 변경은 시작된 mixed 트랜잭션으로 커밋하되 editor는 생략
          reportElementOpSkipped('synthetic selection settlement');
          void runMixedElementIntent({
            gestureId,
            pluginIds,
            applyEager: () => null,
            generate: () => null,
            skipContext: 'synthetic selection settlement',
            expectNull: true,
          }).catch(reportElementOpError);
        } else {
          reportElementOpSkipped('synthetic selection settlement');
        }
      } else if (gestureId && isMixed) {
        // 이동 정산은 dx·dy만 동결 - width·height까지 실으면 병행 리사이즈를
        // 되돌린다. wire는 슬롯 generator가 최신 base에 id 의도를 재적용
        const geometryIntents: PropertyIntents = new Map(
          (['key', 'stat', 'graph', 'knob'] as const).map((type) => [
            type,
            new Map(
              nativeTargets
                .filter((target) => target.type === type)
                .flatMap((target) => {
                  const locator = resolveElementById(type, target.id);
                  const record =
                    type === 'key'
                      ? currentPositions
                      : type === 'stat'
                      ? currentStatPositions
                      : type === 'graph'
                      ? currentGraphPositions
                      : currentKnobPositions;
                  const position = locator
                    ? (
                        record as Record<
                          string,
                          Array<{ dx?: number; dy?: number }>
                        >
                      )[locator.mode]?.[locator.index]
                    : undefined;
                  if (!position) return [];
                  return [
                    [
                      target.id,
                      { dx: position.dx ?? 0, dy: position.dy ?? 0 },
                    ] as const,
                  ];
                }),
            ),
          ]),
        );
        // receipt before는 완료 시점 lastAck 값 - 드래그 중 이미 eager된
        // 스토어 값을 다시 읽으면 before===expected 무효 receipt가 된다
        const lastAck = editorCoordinator.getState().lastAck;
        const receiptEntries: PropertyReceiptEntry[] = [];
        if (lastAck) {
          for (const [type, byId] of geometryIntents) {
            const field =
              type === 'key'
                ? 'keyPositions'
                : type === 'stat'
                ? 'statPositions'
                : type === 'graph'
                ? 'graphPositions'
                : 'knobPositions';
            const collections = lastAck[field] as Record<
              string,
              Array<{ id?: string } & Record<string, unknown>>
            >;
            for (const list of Object.values(collections)) {
              for (const position of list) {
                const id = position.id;
                if (typeof id !== 'string') continue;
                const intent = byId.get(id);
                if (!intent) continue;
                for (const [fieldName, expected] of Object.entries(intent)) {
                  receiptEntries.push({
                    type,
                    id,
                    field: fieldName,
                    before: position[fieldName],
                    expected,
                  });
                }
              }
            }
          }
        }
        void runMixedElementIntent({
          gestureId,
          pluginIds,
          applyEager: () => createPropertyReceipt(receiptEntries),
          generate: (base) =>
            generatePropertyIntentPatch(base, geometryIntents),
          skipContext: 'mixed selection settlement',
        }).catch((error: Error) => {
          console.error('Failed to persist selected element positions', error);
        });
      } else {
        void commitSelectedGeometryByIds(nativeTargets, gestureId).catch(
          (error: Error) => {
            console.error(
              'Failed to persist selected element positions',
              error,
            );
          },
        );
      }
    }

    // 플러그인 요소도 명시적으로 동기화 (드래그 종료 시 skipSync로 인해 동기화되지 않았을 수 있음)
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;
    sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
      elements: currentPluginElements,
    });
  };

  // 선택된 요소들 일괄 이동 함수 (배치 업데이트)
  const moveSelectedElements = (
    deltaX: number,
    deltaY: number,
    gestureId?: string,
    syncToOverlay = true,
  ) => {
    if (selectedElements.length === 0) return;

    // 현재 상태 직접 가져오기 (클로저 문제 방지)
    // setPositions는 canonical 쓰기이므로 base도 canonical에서 읽는다
    const currentPositions = useKeyStore.getState().canonicalPositions;
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;

    // 키 위치 배치 업데이트
    const keyUpdates = selectedElements.filter(
      (el) => el.type === 'key' && el.index !== undefined,
    );
    if (keyUpdates.length > 0) {
      const newPositions = { ...currentPositions };
      const tabPositions = [...(newPositions[selectedKeyType] || [])];

      keyUpdates.forEach((el) => {
        if (el.index === undefined) return;
        const currentPos = tabPositions[el.index];
        if (currentPos) {
          tabPositions[el.index] = {
            ...currentPos,
            dx: currentPos.dx + deltaX,
            dy: currentPos.dy + deltaY,
          };
        }
      });

      newPositions[selectedKeyType] = tabPositions;
      useKeyStore.getState().setPositions(newPositions);
    }

    // 통계 요소 배치 업데이트
    const statUpdates = selectedElements.filter(
      (el) => el.type === 'stat' && el.index !== undefined,
    );
    if (statUpdates.length > 0) {
      const currentStatPositions = useStatItemStore.getState().positions;
      const newStatPositions = { ...currentStatPositions };
      const tabPositions = [...(newStatPositions[selectedKeyType] || [])];

      statUpdates.forEach((el) => {
        if (el.index === undefined) return;
        const currentPos = tabPositions[el.index];
        if (currentPos) {
          tabPositions[el.index] = {
            ...currentPos,
            dx: currentPos.dx + deltaX,
            dy: currentPos.dy + deltaY,
          };
        }
      });

      newStatPositions[selectedKeyType] = tabPositions;
      useStatItemStore.getState().setPositions(newStatPositions);
    }

    // 그래프 요소 배치 업데이트
    const graphUpdates = selectedElements.filter(
      (el) => el.type === 'graph' && el.index !== undefined,
    );
    if (graphUpdates.length > 0) {
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const newGraphPositions = { ...currentGraphPositions };
      const tabPositions = [...(newGraphPositions[selectedKeyType] || [])];

      graphUpdates.forEach((el) => {
        if (el.index === undefined) return;
        const currentPos = tabPositions[el.index];
        if (currentPos) {
          tabPositions[el.index] = {
            ...currentPos,
            dx: currentPos.dx + deltaX,
            dy: currentPos.dy + deltaY,
          };
        }
      });

      newGraphPositions[selectedKeyType] = tabPositions;
      useGraphItemStore.getState().setPositions(newGraphPositions);
    }

    // 노브 요소 배치 업데이트
    const knobUpdates = selectedElements.filter(
      (el) => el.type === 'knob' && el.index !== undefined,
    );
    if (knobUpdates.length > 0) {
      const currentKnobPositions = useKnobItemStore.getState().positions;
      const newKnobPositions = { ...currentKnobPositions };
      const tabPositions = [...(newKnobPositions[selectedKeyType] || [])];

      knobUpdates.forEach((el) => {
        if (el.index === undefined) return;
        const currentPos = tabPositions[el.index];
        if (currentPos) {
          tabPositions[el.index] = {
            ...currentPos,
            dx: currentPos.dx + deltaX,
            dy: currentPos.dy + deltaY,
          };
        }
      });

      newKnobPositions[selectedKeyType] = tabPositions;
      useKnobItemStore.getState().setPositions(newKnobPositions);
    }

    // 플러그인 요소 배치 업데이트
    const pluginUpdates = selectedElements.filter((el) => el.type === 'plugin');
    if (pluginUpdates.length > 0) {
      if (gestureId) {
        const selectedPluginIds = new Set(
          pluginUpdates.map((element) => element.id),
        );
        new Set(
          currentPluginElements
            .filter((element) => selectedPluginIds.has(element.fullId))
            .map((element) => element.pluginId),
        ).forEach((pluginId) => {
          rotatePluginInstancesEditSession(pluginId, gestureId);
        });
      }
      const newElements = currentPluginElements.map((pluginEl) => {
        const isSelected = pluginUpdates.some(
          (sel) => sel.id === pluginEl.fullId,
        );
        if (isSelected) {
          return {
            ...pluginEl,
            position: {
              x: pluginEl.position.x + deltaX,
              y: pluginEl.position.y + deltaY,
            },
          };
        }
        return pluginEl;
      });
      // syncToOverlay가 false이면 오버레이 동기화 스킵 (드래그 중)
      usePluginDisplayElementStore
        .getState()
        .setElements(newElements, { skipSync: !syncToOverlay });
    }

    if (syncToOverlay) {
      syncSelectedElementsToOverlay(gestureId);
    }
  };

  // 선택된 요소들 삭제 함수 (배치 삭제)
  // 선택된 요소들 삭제 (배치): 대상은 호출 시점 동결(안정 id 전역 재해석,
  // 합성은 invocation baseline), eager는 봉인 구조 receipt, wire는 슬롯
  // base에서 재생성. full-record 캡처 커밋 금지 - 대기 중 정산된 다른
  // 커밋을 되돌린다. destructive라 fingerprint 불일치는 전체 중단
  const deleteSelectedElements = async () => {
    if (selectedElements.length === 0) return;
    const gestureId = crypto.randomUUID();

    // 삭제 계획 동결
    const stableTargets: Array<{
      type: 'key' | 'stat' | 'graph' | 'knob';
      id: string;
    }> = [];
    const syntheticIndexTargets: Array<{
      type: 'key' | 'stat' | 'graph' | 'knob';
      index: number;
    }> = [];
    for (const element of selectedElements) {
      if (element.type === 'plugin') continue;
      const type = element.type as 'key' | 'stat' | 'graph' | 'knob';
      if (element.id.length > 0 && !isSyntheticElementId(element.id)) {
        stableTargets.push({ type, id: element.id });
      } else if (element.index !== undefined) {
        syntheticIndexTargets.push({ type, index: element.index });
      }
    }
    const pluginsToDelete = selectedElements
      .filter((el) => el.type === 'plugin')
      .map((el) => el.id);
    const pluginIdsToDelete = [
      ...new Set(
        usePluginDisplayElementStore
          .getState()
          .elements.filter((element) =>
            pluginsToDelete.includes(element.fullId),
          )
          .map((element) => element.pluginId),
      ),
    ];
    const hasEditorDeletion =
      stableTargets.length > 0 || syntheticIndexTargets.length > 0;

    // 합성 대상은 invocation 시점 구조 증명 아래에서만 index 삭제
    const syntheticBaseline =
      syntheticIndexTargets.length > 0
        ? captureIndexIntentBaseline(
            editorCoordinator.getState().lastAck,
            selectedKeyType,
            [
              'keys',
              'keyPositions',
              'statPositions',
              'graphPositions',
              'knobPositions',
              'layerGroups',
            ],
          )
        : null;
    if (syntheticIndexTargets.length > 0 && !syntheticBaseline) {
      reportElementOpSkipped('batch delete (no baseline)');
      return;
    }
    if (syntheticIndexTargets.length > 0 && syntheticBaseline) {
      // eager 게이트: 스토어 구조가 invocation baseline과 다르면 index
      // 신원이 무효 - 아무것도 적용하지 않고 전체 fail-closed
      const storeDocument = {
        keys: useKeyStore.getState().keyMappings,
        keyPositions: useKeyStore.getState().canonicalPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        knobPositions: useKnobItemStore.getState().positions,
        layerGroups: useLayerGroupStore.getState().layerGroups,
      } as unknown as Record<string, unknown>;
      if (!indexBaselineMatches(syntheticBaseline, storeDocument)) {
        reportElementOpSkipped('batch delete (baseline mismatch)');
        return;
      }
    }

    // 삭제 mask 계산: 문서(base 또는 스토어 뷰)에서 (type, mode) → index 집합
    const collectRemoval = (document: {
      keys: Record<string, unknown[]>;
      keyPositions: Record<string, Array<{ id?: string }>>;
      statPositions: Record<string, Array<{ id?: string }>>;
      graphPositions: Record<string, Array<{ id?: string }>>;
      knobPositions: Record<string, Array<{ id?: string }>>;
      layerGroups: Record<string, unknown[]>;
    }) => {
      const FIELD_OF = {
        key: 'keyPositions',
        stat: 'statPositions',
        graph: 'graphPositions',
        knob: 'knobPositions',
      } as const;
      const removal = new Map<
        'key' | 'stat' | 'graph' | 'knob',
        Map<string, Set<number>>
      >();
      let found = 0;
      const mark = (
        type: 'key' | 'stat' | 'graph' | 'knob',
        mode: string,
        index: number,
      ) => {
        const byMode = removal.get(type) ?? new Map<string, Set<number>>();
        const set = byMode.get(mode) ?? new Set<number>();
        set.add(index);
        byMode.set(mode, set);
        removal.set(type, byMode);
        found += 1;
      };
      for (const target of stableTargets) {
        const record = document[FIELD_OF[target.type]];
        for (const [mode, list] of Object.entries(record)) {
          const index = list.findIndex((position) => position.id === target.id);
          if (index !== -1) {
            mark(target.type, mode, index);
            break;
          }
        }
      }
      for (const target of syntheticIndexTargets) {
        const list = document[FIELD_OF[target.type]][selectedKeyType];
        if (list && target.index < list.length) {
          mark(target.type, selectedKeyType, target.index);
        }
      }
      return { removal, found };
    };

    const applyRemoval = (
      document: Parameters<typeof collectRemoval>[0],
      removal: ReadonlyMap<
        'key' | 'stat' | 'graph' | 'knob',
        ReadonlyMap<string, ReadonlySet<number>>
      >,
    ) => {
      const next = {
        keys: { ...document.keys },
        keyPositions: { ...document.keyPositions },
        statPositions: { ...document.statPositions },
        graphPositions: { ...document.graphPositions },
        knobPositions: { ...document.knobPositions },
        layerGroups: document.layerGroups,
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
            : 'knobPositions';
        for (const [mode, indexSet] of byMode) {
          affectedModes.add(mode);
          next[field] = {
            ...next[field],
            [mode]: (next[field][mode] ?? []).filter(
              (_, index) => !indexSet.has(index),
            ),
          };
          if (type === 'key') {
            // pair 결합: 같은 index mask를 keys에도 적용 - mask 전 길이
            // 일치와 index 유효성이 증명돼야 한다
            const pairLength = (next.keys[mode] ?? []).length;
            const positionLength = (document.keyPositions[mode] ?? []).length;
            if (pairLength !== positionLength) {
              throw new ElementIntentAbort('key pair length mismatch');
            }
            for (const index of indexSet) {
              if (index < 0 || index >= pairLength) {
                throw new ElementIntentAbort('key pair index out of range');
              }
            }
            next.keys = {
              ...next.keys,
              [mode]: (next.keys[mode] ?? []).filter(
                (_, index) => !indexSet.has(index),
              ),
            };
          }
        }
      }
      // 삭제가 발생한 모든 mode에 그룹 재정규화
      let layerGroups = document.layerGroups;
      let groupsChanged = false;
      for (const mode of affectedModes) {
        const normalized = normalizeLayerGroupsForMode({
          mode,
          keyPositions: next.keyPositions as never,
          statPositions: next.statPositions as never,
          graphPositions: next.graphPositions as never,
          knobPositions: next.knobPositions as never,
          layerGroups: layerGroups as never,
        });
        next.keyPositions = normalized.keyPositions as never;
        next.statPositions = normalized.statPositions as never;
        next.graphPositions = normalized.graphPositions as never;
        next.knobPositions = normalized.knobPositions as never;
        if (normalized.groupsChanged) {
          layerGroups = normalized.layerGroups as never;
          groupsChanged = true;
        }
      }
      return { next, layerGroups, groupsChanged, affectedModes };
    };

    // 먼저 선택 해제 (삭제된 참조 방지) - 실패 시 선택 미복원(기록된 정책)
    clearSelection();

    // eager 단계 동기 예외도 staged 정산 안전망을 거친다
    try {
      await deleteWithFrozenPlan();
    } finally {
      cancelUncommittedMixedGestureTransaction(gestureId);
    }

    async function deleteWithFrozenPlan(): Promise<void> {
      // eager 전에 삭제 대상 plugin scope를 stage - staging 전 스토어 변이는
      // debounce 저장이 abort보다 먼저 영속시킬 수 있다
      if (pluginIdsToDelete.length > 0) {
        beginMixedGestureTransaction(gestureId, pluginIdsToDelete);
      }
      // eager: 스토어 뷰에서 mask 계산·적용, 봉인 구조 receipt로 복원 소유
      const storeView = () => ({
        keys: useKeyStore.getState().keyMappings as Record<string, unknown[]>,
        keyPositions: useKeyStore.getState().canonicalPositions as Record<
          string,
          Array<{ id?: string }>
        >,
        statPositions: useStatItemStore.getState().positions as Record<
          string,
          Array<{ id?: string }>
        >,
        graphPositions: useGraphItemStore.getState().positions as Record<
          string,
          Array<{ id?: string }>
        >,
        knobPositions: useKnobItemStore.getState().positions as Record<
          string,
          Array<{ id?: string }>
        >,
        layerGroups: useLayerGroupStore.getState().layerGroups as Record<
          string,
          unknown[]
        >,
      });
      const eagerView = storeView();
      const eagerPlan = collectRemoval(eagerView);
      const eagerModes = new Set<string>([selectedKeyType]);
      for (const byMode of eagerPlan.removal.values()) {
        for (const mode of byMode.keys()) eagerModes.add(mode);
      }
      const editorReceipt = hasEditorDeletion
        ? applySealedSliceMutation({
            modes: [...eagerModes],
            fields: [
              'keys',
              'keyPositions',
              'statPositions',
              'graphPositions',
              'knobPositions',
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
        pluginReceipt = applyPluginRemovalEagerly(pluginsToDelete, () => {
          if (pluginsToDelete.length > 0) {
            deletePluginElements(pluginsToDelete, gestureId);
          }
        });
      } catch (error) {
        // plugin eager 실패 시 editor eager 잔존 방지
        editorReceipt?.rollback();
        throw error;
      }
      const receipt = combineReceipts(editorReceipt, pluginReceipt);

      // wire generator: 슬롯 base에서 동결 대상 재해석
      const generateDeletionPatch = (
        base: EditorDocumentV1,
      ): { patch: EditorPatchV1 | null; satisfied: boolean } => {
        const baseView = {
          keys: base.keys as Record<string, unknown[]>,
          keyPositions: base.keyPositions as never,
          statPositions: base.statPositions as never,
          graphPositions: base.graphPositions as never,
          knobPositions: base.knobPositions as never,
          layerGroups: base.layerGroups as Record<string, unknown[]>,
        };
        if (
          syntheticIndexTargets.length > 0 &&
          (!syntheticBaseline ||
            !indexBaselineMatches(
              syntheticBaseline,
              base as unknown as Record<string, unknown>,
            ))
        ) {
          throw new ElementIntentAbort('batch delete baseline mismatch');
        }
        const plan = collectRemoval(baseView);
        if (plan.found === 0) {
          // 전부 이미 삭제됨 - canonical 기실현
          return { patch: null, satisfied: true };
        }
        const applied = applyRemoval(baseView, plan.removal);
        const patch: EditorPatchV1 = {
          schemaVersion: 1,
          keys: applied.next.keys as never,
          keyPositions: applied.next.keyPositions as never,
          statPositions: applied.next.statPositions as never,
          graphPositions: applied.next.graphPositions as never,
          knobPositions: applied.next.knobPositions as never,
          ...(applied.groupsChanged
            ? { layerGroups: applied.layerGroups as never }
            : {}),
        };
        return { patch, satisfied: false };
      };

      try {
        if (pluginsToDelete.length > 0) {
          // 혼합: 삭제된 fullId를 뺀 desired projection을 transaction이 저장
          const deletedSet = new Set(pluginsToDelete);
          await runMixedGestureElementIntent({
            gestureId,
            initialPluginIds: pluginIdsToDelete,
            pluginScope: () => pluginIdsToDelete,
            receipt,
            generate: ({ base, pluginProjection }) => {
              const result = generateDeletionPatch(base);
              const desired = pluginProjection.filter(
                (element) => !deletedSet.has(element.fullId),
              );
              if (
                result.satisfied &&
                desired.length === pluginProjection.length
              ) {
                return { kind: 'satisfied' };
              }
              return {
                kind: 'patch',
                patch: result.patch,
                desiredPluginProjection: desired,
              };
            },
            skipContext: 'batch delete settlement',
          });
        } else if (hasEditorDeletion) {
          await runElementIntent({
            applyEager: () => receipt,
            generate: (base) => {
              const result = generateDeletionPatch(base);
              if (result.satisfied) return { kind: 'satisfied' };
              return result.patch
                ? { kind: 'patch', patch: result.patch }
                : { kind: 'satisfied' };
            },
            gestureId,
          }).then((result) => {
            if (!result.committed && !result.satisfied) {
              reportElementOpSkipped('batch delete settlement');
            }
          });
        }
      } catch (error) {
        console.error('Failed to persist selected element deletion', error);
      }
    }
  };

  // 선택된 요소들 복사
  const copySelectedElements = () => {
    if (selectedElements.length === 0) return;

    // 최신 상태를 직접 스토어에서 가져오기 (클로저 문제 방지)
    // 클립보드는 이후 paste 커밋의 원본이므로 canonical 기준으로 캡처
    const { keyMappings: km, canonicalPositions: pos } = useKeyStore.getState();
    const currentMappings = km[selectedKeyType] || [];
    const currentPositions = pos[selectedKeyType] || [];
    const currentStatPositions =
      useStatItemStore.getState().positions[selectedKeyType] || [];
    const currentGraphPositions =
      useGraphItemStore.getState().positions[selectedKeyType] || [];
    const currentKnobPositions =
      useKnobItemStore.getState().positions[selectedKeyType] || [];
    const currentPluginElements =
      usePluginDisplayElementStore.getState().elements;

    const clipboardItems: ClipboardItem[] = [];

    for (const element of selectedElements) {
      if (element.type === 'key' && element.index !== undefined) {
        const keyCode = currentMappings[element.index];
        const position = currentPositions[element.index];
        if (keyCode && position) {
          clipboardItems.push({
            type: 'key',
            keyCode: cloneSlot(keyCode),
            position: { ...position },
          });
        }
      } else if (element.type === 'stat' && element.index !== undefined) {
        const position = currentStatPositions[element.index];
        if (position) {
          clipboardItems.push({
            type: 'stat',
            position: { ...position },
          });
        }
      } else if (element.type === 'graph' && element.index !== undefined) {
        const position = currentGraphPositions[element.index];
        if (position) {
          clipboardItems.push({
            type: 'graph',
            position: { ...position },
          });
        }
      } else if (element.type === 'knob' && element.index !== undefined) {
        const position = currentKnobPositions[element.index];
        if (position) {
          clipboardItems.push({
            type: 'knob',
            position: { ...position },
          });
        }
      } else if (element.type === 'plugin') {
        const pluginElement = currentPluginElements.find(
          (el) => el.fullId === element.id,
        );
        if (pluginElement) {
          // fullId를 제외한 나머지 데이터 복사
          const { fullId: _fullId, ...elementData } = pluginElement;
          clipboardItems.push({
            type: 'plugin',
            element: elementData,
          });
        }
      }
    }

    if (clipboardItems.length > 0) {
      // 그룹 헤더가 선택된 경우 그룹 정보도 함께 저장
      const selectedGroupIds =
        useGridSelectionStore.getState().selectedGroupIds;
      const clipboardGroups: {
        id: string;
        name: string;
        collapsed?: boolean;
      }[] = [];

      if (selectedGroupIds.length > 0) {
        const layerGroups = useLayerGroupStore
          .getState()
          .getGroupsForMode(selectedKeyType);
        const collapsedGroups = useLayerGroupStore.getState().collapsedGroups;
        for (const gid of selectedGroupIds) {
          const group = layerGroups.find((g) => g.id === gid);
          if (group) {
            clipboardGroups.push({
              id: gid,
              name: group.name,
              collapsed: collapsedGroups.has(gid) || undefined,
            });
          }
        }
      }

      setClipboard(clipboardItems, clipboardGroups);
    }
  };

  // 클립보드에서 붙여넣기: 계획(신규 id·payload·그룹·plugin fullId·앵커)을
  // 호출 시점에 동결하고, eager는 결합 봉인 receipt, wire는 슬롯 base와
  // 봉인 plugin projection의 결합 순서에서 재생성한다. 초기 plugin이 없어도
  // 항상 mixed-capable primitive를 탄다 - 슬롯 대기 중 추가된 plugin이
  // z 재부여에서 빠지는 TOCTOU를 막는다
  const pasteElements = async () => {
    const currentClipboard = useGridSelectionStore.getState().clipboard;
    if (currentClipboard.length === 0) return;
    const gestureId = crypto.randomUUID();
    const clipboardGroups = useGridSelectionStore.getState().clipboardGroups;
    const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
    const currentSelectedElements =
      useGridSelectionStore.getState().selectedElements;
    const currentSelectedGroupIds =
      useGridSelectionStore.getState().selectedGroupIds;

    // 신규 그룹 동결 (스토어 쓰기는 eager 봉인 안에서)
    const groupIdMap = new Map<string, string>();
    const frozenNewGroups: Array<{
      id: string;
      name: string;
      collapsed: boolean;
    }> = [];
    if (clipboardGroups.length > 0) {
      const modeGroups = [...(currentLayerGroups[selectedKeyType] || [])];
      for (const clipboardGroup of clipboardGroups) {
        const newGroupId = crypto.randomUUID();
        const newGroupName = buildNextLayerGroupName(
          clipboardGroup.name,
          modeGroups,
        );
        groupIdMap.set(clipboardGroup.id, newGroupId);
        const frozen = {
          id: newGroupId,
          name: newGroupName,
          collapsed: Boolean(clipboardGroup.collapsed),
        };
        frozenNewGroups.push(frozen);
        modeGroups.push({ id: newGroupId, name: newGroupName });
      }
    }
    const callModeGroups = currentLayerGroups[selectedKeyType] || [];
    const remapGroupId = (groupId: string | undefined) => {
      if (!groupId) return groupId;
      if (groupIdMap.has(groupId)) return groupIdMap.get(groupId);
      return callModeGroups.some((group) => group.id === groupId)
        ? groupId
        : undefined;
    };

    // 신규 native payload 동결
    const keysToAdd: { keyCode: KeySlot; position: KeyPosition }[] = [];
    const statsToAdd: { position: StatItemPosition }[] = [];
    const graphsToAdd: { position: GraphItemPosition }[] = [];
    const knobsToAdd: { position: KnobItemPosition }[] = [];
    const pluginPayloads: Omit<PluginDisplayElementInternal, 'fullId'>[] = [];
    for (const item of currentClipboard) {
      if (item.type === 'key') {
        keysToAdd.push({
          keyCode: cloneSlot(item.keyCode),
          position: {
            ...item.position,
            id: newElementId(),
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'stat') {
        statsToAdd.push({
          position: {
            ...item.position,
            id: newElementId(),
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'graph') {
        graphsToAdd.push({
          position: {
            ...item.position,
            id: newElementId(),
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'knob') {
        knobsToAdd.push({
          position: {
            ...item.position,
            id: newElementId(),
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'plugin') {
        pluginPayloads.push({
          ...item.element,
          groupId: remapGroupId(item.element.groupId),
          position: {
            x: (item.element.position?.x || 0) + PASTE_OFFSET,
            y: (item.element.position?.y || 0) + PASTE_OFFSET,
          },
          tabId: selectedKeyType,
        });
      }
    }

    // plugin fullId 사전 동결 - eager 루프 생성은 retry·receipt를 비결정적으로 만든다
    const frozenPluginElements: PluginDisplayElementInternal[] =
      pluginPayloads.map((element) => ({
        ...element,
        fullId: `${element.pluginId}:${element.id}:${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 11)}`,
      }));
    const pluginIdsToAdd = [
      ...new Set(frozenPluginElements.map((element) => element.pluginId)),
    ];
    const hasEditorPaste =
      keysToAdd.length > 0 ||
      statsToAdd.length > 0 ||
      graphsToAdd.length > 0 ||
      knobsToAdd.length > 0 ||
      clipboardGroups.length > 0;
    if (!hasEditorPaste && frozenPluginElements.length === 0) return;

    // 앵커 동결: 호출 시점 결합 순서에서 삽입 위치의 기존 아이템 id
    const callOrderItems = buildLayerItemsForMode(
      selectedKeyType,
      useKeyStore.getState().canonicalPositions,
      useStatItemStore.getState().positions,
      useGraphItemStore.getState().positions,
      useKnobItemStore.getState().positions,
      usePluginDisplayElementStore.getState().elements,
    );
    // 앵커 descriptor: 선택 요소와 선택 그룹 최상단 중 더 위를 동결하되,
    // 그룹이 이기면 groupId로 동결한다 - 당시 최상단 자식이 삭제돼도 살아
    // 있는 그룹 경계를 재해석할 수 있다
    let anchorElementIdx = Number.POSITIVE_INFINITY;
    let anchorElementId: string | null = null;
    for (const element of currentSelectedElements) {
      const index = callOrderItems.findIndex((item) => item.id === element.id);
      if (index !== -1 && index < anchorElementIdx) {
        anchorElementIdx = index;
        anchorElementId = element.id;
      }
    }
    let anchorGroupIdx = Number.POSITIVE_INFINITY;
    let anchorGroupId: string | null = null;
    for (const groupId of currentSelectedGroupIds) {
      const index = callOrderItems.findIndex(
        (item) => item.groupId === groupId,
      );
      if (index !== -1 && index < anchorGroupIdx) {
        anchorGroupIdx = index;
        anchorGroupId = groupId;
      }
    }
    // tie는 그룹 우선 - 그룹 클릭은 자식 전체와 groupId를 함께 선택하므로
    // 최상단 자식 index와 그룹 index가 같다
    const frozenAnchor: { elementId?: string; groupId?: string } | null =
      anchorGroupIdx <= anchorElementIdx && anchorGroupId
        ? { groupId: anchorGroupId }
        : anchorElementId
        ? { elementId: anchorElementId }
        : null;

    // z 재부여는 mode 내 모든 plugin에 닿는다 - scope는 신규 ∪ mode 전체
    const pluginScope = (
      elements: readonly PluginDisplayElementInternal[],
    ): string[] => [
      ...new Set([
        ...pluginIdsToAdd,
        ...elements
          .filter((element) => element.tabId === selectedKeyType)
          .map((element) => element.pluginId)
          .filter((pluginId): pluginId is string => Boolean(pluginId)),
      ]),
    ];

    interface PasteDocView {
      keys: Record<string, KeySlot[]>;
      keyPositions: Record<string, KeyPosition[]>;
      statPositions: Record<string, StatItemPosition[]>;
      graphPositions: Record<string, GraphItemPosition[]>;
      knobPositions: Record<string, KnobItemPosition[]>;
      layerGroups: Record<string, Array<{ id: string; name: string }>>;
    }

    const payloadFingerprint = (value: unknown): string =>
      stableStringify({
        ...(value as Record<string, unknown>),
        zIndex: undefined,
      });

    // 문서 뷰(base 또는 스토어)에서 동결 계획을 재적용해 결과를 산출.
    // 충돌(같은 id에 다른 payload)은 전체 중단, 동일 payload는 skip(멱등)
    const computePaste = (
      view: PasteDocView,
      projection: readonly PluginDisplayElementInternal[],
    ): {
      appended: boolean;
      keys: Record<string, KeySlot[]>;
      zPatch: ReturnType<typeof applyZIndexToLayerOrder>;
      layerGroups: Record<string, Array<{ id: string; name: string }>>;
      groupsChanged: boolean;
      desiredProjection: PluginDisplayElementInternal[];
    } => {
      const mode = selectedKeyType;
      let appended = false;

      const findNativeById = (
        id: string,
      ): { field: keyof PasteDocView; mode: string; index: number } | null => {
        const fields = [
          'keyPositions',
          'statPositions',
          'graphPositions',
          'knobPositions',
        ] as const;
        for (const field of fields) {
          for (const [ownMode, list] of Object.entries(view[field])) {
            const index = (list as Array<{ id?: string }>).findIndex(
              (position) => position.id === id,
            );
            if (index !== -1) return { field, mode: ownMode, index };
          }
        }
        return null;
      };

      const nextKeys = { ...view.keys };
      const nextKeyPositions = { ...view.keyPositions };
      const nextStatPositions = { ...view.statPositions };
      const nextGraphPositions = { ...view.graphPositions };
      const nextKnobPositions = { ...view.knobPositions };

      const appendedNativeIds = new Set<string>();
      for (const entry of keysToAdd) {
        const existing = findNativeById(entry.position.id!);
        if (existing) {
          const position = (
            view[existing.field][existing.mode] as Array<
              Record<string, unknown>
            >
          )[existing.index];
          const pairedSlot = view.keys[existing.mode]?.[existing.index];
          if (
            existing.field !== 'keyPositions' ||
            payloadFingerprint(position) !==
              payloadFingerprint(entry.position) ||
            stableStringify(pairedSlot) !== stableStringify(entry.keyCode)
          ) {
            throw new ElementIntentAbort('paste id collision');
          }
          continue;
        }
        nextKeys[mode] = [...(nextKeys[mode] ?? []), entry.keyCode];
        nextKeyPositions[mode] = [
          ...(nextKeyPositions[mode] ?? []),
          entry.position,
        ];
        appendedNativeIds.add(entry.position.id!);
        appended = true;
      }
      const appendSimple = <T extends { id?: string }>(
        record: Record<string, T[]>,
        entries: Array<{ position: T }>,
        field: keyof PasteDocView,
      ): Record<string, T[]> => {
        let next = record;
        for (const entry of entries) {
          const existing = findNativeById(entry.position.id!);
          if (existing) {
            const position = (
              view[existing.field][existing.mode] as Array<
                Record<string, unknown>
              >
            )[existing.index];
            if (
              existing.field !== field ||
              payloadFingerprint(position) !==
                payloadFingerprint(entry.position)
            ) {
              throw new ElementIntentAbort('paste id collision');
            }
            continue;
          }
          next = { ...next, [mode]: [...(next[mode] ?? []), entry.position] };
          appendedNativeIds.add(entry.position.id!);
          appended = true;
        }
        return next;
      };
      const statNext = appendSimple(
        nextStatPositions,
        statsToAdd,
        'statPositions',
      );
      const graphNext = appendSimple(
        nextGraphPositions,
        graphsToAdd,
        'graphPositions',
      );
      const knobNext = appendSimple(
        nextKnobPositions,
        knobsToAdd,
        'knobPositions',
      );

      // 신규 그룹 append (id 기준 멱등)
      let layerGroups = view.layerGroups;
      let groupsChanged = false;
      if (frozenNewGroups.length > 0) {
        const modeGroups = [...(layerGroups[mode] ?? [])];
        for (const group of frozenNewGroups) {
          if (modeGroups.some((existing) => existing.id === group.id)) continue;
          modeGroups.push({ id: group.id, name: group.name });
          groupsChanged = true;
        }
        if (groupsChanged) {
          layerGroups = { ...layerGroups, [mode]: modeGroups };
        }
      }

      // plugin append (fullId 멱등·충돌 검사)
      const appendedPlugins: PluginDisplayElementInternal[] = [];
      for (const element of frozenPluginElements) {
        const existing = projection.find(
          (candidate) => candidate.fullId === element.fullId,
        );
        if (existing) {
          if (payloadFingerprint(existing) !== payloadFingerprint(element)) {
            throw new ElementIntentAbort('paste plugin fullId collision');
          }
          continue;
        }
        appendedPlugins.push(element);
        appended = true;
      }
      const combinedProjection = [...projection, ...appendedPlugins];

      // 결합 순서 재구성 + 동결 앵커 재해석 (소실 시 최상단 fallback)
      const allItems = buildLayerItemsForMode(
        mode,
        nextKeyPositions as never,
        statNext as never,
        graphNext as never,
        knobNext as never,
        combinedProjection,
      );
      const newIdSet = new Set<string>([
        ...appendedNativeIds,
        ...appendedPlugins.map((element) => element.fullId),
      ]);
      const existingItems = allItems.filter((item) => !newIdSet.has(item.id));
      const pastedById = new Map(
        allItems
          .filter((item) => newIdSet.has(item.id))
          .map((item) => [item.id, item]),
      );
      // 블록 내부는 원본의 상대 스택을 따른다 - payload는 타입별로 묶인
      // 순서라 그대로 쓰면 복사본의 위아래가 뒤집힌다
      const pastedOrdered = orderPastedItemsByFrozenZ(
        [
          ...keysToAdd.map((entry) => entry.position.id!),
          ...statsToAdd.map((entry) => entry.position.id!),
          ...graphsToAdd.map((entry) => entry.position.id!),
          ...knobsToAdd.map((entry) => entry.position.id!),
          ...frozenPluginElements.map((element) => element.fullId),
        ]
          .map((id) => pastedById.get(id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      );
      let anchorIndex = 0;
      if (frozenAnchor?.groupId) {
        const index = existingItems.findIndex(
          (item) => item.groupId === frozenAnchor.groupId,
        );
        anchorIndex = index !== -1 ? index : 0;
      } else if (frozenAnchor?.elementId) {
        const index = existingItems.findIndex(
          (item) => item.id === frozenAnchor.elementId,
        );
        anchorIndex = index !== -1 ? index : 0;
      }
      const reordered = [
        ...existingItems.slice(0, anchorIndex),
        ...pastedOrdered,
        ...existingItems.slice(anchorIndex),
      ];
      const zPatch = applyZIndexToLayerOrder(
        reordered,
        mode,
        nextKeyPositions as never,
        statNext as never,
        graphNext as never,
        knobNext as never,
      );
      const zByFullId = new Map(
        zPatch.pluginUpdates.map((update) => [update.fullId, update.zIndex]),
      );
      const desiredProjection = combinedProjection.map((element) => {
        const zIndex = zByFullId.get(element.fullId);
        return zIndex === undefined ? element : { ...element, zIndex };
      });

      return {
        appended,
        keys: nextKeys,
        zPatch,
        layerGroups,
        groupsChanged,
        desiredProjection,
      };
    };

    try {
      await pasteWithFrozenPlan();
    } finally {
      cancelUncommittedMixedGestureTransaction(gestureId);
    }

    async function pasteWithFrozenPlan(): Promise<void> {
      // eager 전에 초기 scope를 stage - staging 전 스토어 변이는 200ms
      // debounce 저장이 abort보다 먼저 영속시킬 수 있다
      const initialScope = pluginScope(
        usePluginDisplayElementStore.getState().elements,
      );
      if (initialScope.length > 0) {
        beginMixedGestureTransaction(gestureId, initialScope);
      }
      // 기존 plugin의 zIndex eager도 이 게스처 세션으로 - 별도 세션이 생기면
      // 편입 후 실패의 canonical pull이 외부 충돌로 오판해 건너뛴다
      initialScope.forEach((pluginId) => {
        rotatePluginInstancesEditSession(pluginId, gestureId);
      });

      // eager 계획을 쓰기 전에 확정 (충돌 abort가 쓰기 전에 발생)
      const eagerElementsBefore =
        usePluginDisplayElementStore.getState().elements;
      const eagerPlan = computePaste(
        {
          keys: useKeyStore.getState().keyMappings as never,
          keyPositions: useKeyStore.getState().canonicalPositions as never,
          statPositions: useStatItemStore.getState().positions as never,
          graphPositions: useGraphItemStore.getState().positions as never,
          knobPositions: useKnobItemStore.getState().positions as never,
          layerGroups: useLayerGroupStore.getState().layerGroups as never,
        },
        eagerElementsBefore,
      );
      // editor와 plugin은 독립 소유권 - 결합 봉인은 무관한 plugin 변경
      // 하나로 editor 복원까지 거부한다
      const editorReceipt = applySealedSliceMutation({
        modes: [selectedKeyType],
        fields: [
          'keys',
          'keyPositions',
          'statPositions',
          'graphPositions',
          'knobPositions',
          'layerGroups',
        ],
        mutate: () => {
          useKeyStore
            .getState()
            .setKeyMappingsAndPositions(
              eagerPlan.keys as never,
              eagerPlan.zPatch.keyPositions as never,
            );
          useStatItemStore
            .getState()
            .setPositions(eagerPlan.zPatch.statPositions as never);
          useGraphItemStore
            .getState()
            .setPositions(eagerPlan.zPatch.graphPositions as never);
          useKnobItemStore
            .getState()
            .setPositions(eagerPlan.zPatch.knobPositions as never);
          if (eagerPlan.groupsChanged) {
            useLayerGroupStore
              .getState()
              .setLayerGroups(eagerPlan.layerGroups as never);
          }
        },
      });
      // plugin semantic receipt: 신규 fullId membership + 기존 zIndex CAS
      const beforeZByFullId = new Map(
        eagerElementsBefore.map((element) => [element.fullId, element.zIndex]),
      );
      // 멱등 skip된 동결 id를 receipt가 소유하면 실패 rollback이 기존
      // 요소를 삭제한다 - eager 전에 없던 id만 membership 대상
      const eagerBeforeIds = new Set(
        eagerElementsBefore.map((element) => element.fullId),
      );
      const addedFullIds = frozenPluginElements
        .map((element) => element.fullId)
        .filter((fullId) => !eagerBeforeIds.has(fullId));
      const addedSet = new Set(addedFullIds);
      const zChanges = eagerPlan.desiredProjection
        .filter((element) => !addedSet.has(element.fullId))
        .filter(
          (element) => beforeZByFullId.get(element.fullId) !== element.zIndex,
        )
        .map((element) => ({
          fullId: element.fullId,
          before: beforeZByFullId.get(element.fullId),
          expected: element.zIndex as number,
        }));
      let pluginReceipt: ElementIntentReceipt | null = null;
      try {
        pluginReceipt = applyPluginAdditionEagerly(
          addedFullIds,
          zChanges,
          () => {
            usePluginDisplayElementStore
              .getState()
              .setElements(eagerPlan.desiredProjection, { skipSync: true });
          },
        );
      } catch (error) {
        // plugin eager 실패 시 editor eager 잔존 방지
        editorReceipt.rollback();
        throw error;
      }
      const receipt = combineReceipts(editorReceipt, pluginReceipt);

      // 접힘 상태는 문서 밖 UI - 즉시 적용, 실패 미복원(기록된 정책)
      for (const group of frozenNewGroups) {
        if (group.collapsed) {
          useLayerGroupStore.getState().setCollapsed(group.id, true);
        }
      }

      // 선택 이동은 eager 직후 동기 구간에서 - await 뒤로 미루면 라운드트립
      // 동안 선택이 원본에 남아 Delete 같은 후속 조작이 원본을 지운다.
      // 실패로 eager가 롤백되면 다음 문서 적용의 선택 재조정이 정리한다
      const newSelectedElements: SelectedElement[] = [];
      const collect = (
        type: 'key' | 'stat' | 'graph' | 'knob',
        record: Record<string, Array<{ id?: string }>>,
        ids: readonly string[],
      ) => {
        const list = record[selectedKeyType] ?? [];
        for (const id of ids) {
          const index = list.findIndex((position) => position.id === id);
          if (index !== -1) {
            newSelectedElements.push({ type, id, index });
          }
        }
      };
      collect(
        'key',
        useKeyStore.getState().canonicalPositions as never,
        keysToAdd.map((entry) => entry.position.id!),
      );
      collect(
        'stat',
        useStatItemStore.getState().positions as never,
        statsToAdd.map((entry) => entry.position.id!),
      );
      collect(
        'graph',
        useGraphItemStore.getState().positions as never,
        graphsToAdd.map((entry) => entry.position.id!),
      );
      collect(
        'knob',
        useKnobItemStore.getState().positions as never,
        knobsToAdd.map((entry) => entry.position.id!),
      );
      const presentPluginIds = new Set(
        usePluginDisplayElementStore
          .getState()
          .elements.map((element) => element.fullId),
      );
      for (const element of frozenPluginElements) {
        if (presentPluginIds.has(element.fullId)) {
          newSelectedElements.push({ type: 'plugin', id: element.fullId });
        }
      }
      if (newSelectedElements.length > 0) {
        useGridSelectionStore.getState().setSkipPanelModeSwitch(true);
        if (groupIdMap.size > 0) {
          useGridSelectionStore
            .getState()
            .setFullSelection(newSelectedElements, [...groupIdMap.values()]);
        } else {
          setSelectedElements(newSelectedElements);
        }
      }

      let result: { committed: boolean; satisfied: boolean };
      try {
        result = await runMixedGestureElementIntent({
          gestureId,
          initialPluginIds: pluginScope(
            usePluginDisplayElementStore.getState().elements,
          ),
          pluginScope,
          receipt,
          generate: ({ base, pluginProjection }) => {
            const plan = computePaste(
              {
                keys: base.keys as never,
                keyPositions: base.keyPositions as never,
                statPositions: base.statPositions as never,
                graphPositions: base.graphPositions as never,
                knobPositions: base.knobPositions as never,
                layerGroups: base.layerGroups as never,
              },
              pluginProjection,
            );
            if (!plan.appended) {
              // 전부 이미 반영됨(재시도 멱등) - z 재부여도 이전 성공분
              return { kind: 'satisfied' };
            }
            return {
              kind: 'patch',
              patch: {
                schemaVersion: 1,
                keys: plan.keys as never,
                keyPositions: plan.zPatch.keyPositions as never,
                statPositions: plan.zPatch.statPositions as never,
                graphPositions: plan.zPatch.graphPositions as never,
                knobPositions: plan.zPatch.knobPositions as never,
                ...(plan.groupsChanged
                  ? { layerGroups: plan.layerGroups as never }
                  : {}),
              },
              desiredPluginProjection: plan.desiredProjection,
            };
          },
          skipContext: 'paste settlement',
        });
      } catch (error) {
        // 편입 후 실패의 상태 정합은 projection·canonical pull이 소유 -
        // 호출부 경계에서는 기록만 (삭제 경로와 대칭)
        console.error('Failed to persist pasted elements', error);
        result = { committed: false, satisfied: false };
      }

      sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
        elements: usePluginDisplayElementStore.getState().elements,
      });
    }
  };

  return {
    moveSelectedElements,
    deleteSelectedElements,
    copySelectedElements,
    pasteElements,
    syncSelectedElementsToOverlay,
    clipboard,
  };
}
