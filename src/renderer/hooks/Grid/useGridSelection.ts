/**
 * Grid 선택 관련 로직 훅
 * - 선택된 요소들 이동
 * - 선택된 요소들 삭제
 * - 복사/붙여넣기
 */

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
import type {
  StatItemPosition,
  StatItemPositions,
} from '@src/types/key/statItems';
import type {
  GraphItemPosition,
  GraphItemPositions,
} from '@src/types/key/graphItems';
import type { KnobItemPosition, KnobItemPositions } from '@src/types/key/knobs';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  normalizeLayerGroupsForMode,
  buildNextLayerGroupName,
  buildLayerItemsForMode,
  findPasteAnchorIndex,
  applyZIndexToLayerOrder,
} from '@utils/layerGroupUtils';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { deletePluginElements } from '@plugins/rpc/pluginElementActions';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
  commitMixedGestureTransaction,
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
    const editorChanges = {
      schemaVersion: 1 as const,
      keyPositions: currentPositions,
      statPositions: currentStatPositions,
      graphPositions: currentGraphPositions,
      knobPositions: currentKnobPositions,
    };
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
    const persisted =
      gestureId && isMixed
        ? commitMixedGestureTransaction(gestureId, editorChanges, pluginIds)
        : editorCoordinator.commitPatch(
            editorChanges,
            gestureId ? { gestureId } : undefined,
          );
    void persisted.catch((error: Error) => {
      console.error('Failed to persist selected element positions', error);
    });

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
  const deleteSelectedElements = async () => {
    if (selectedElements.length === 0) return;

    const keysToDelete = selectedElements
      .filter((el) => el.type === 'key' && el.index !== undefined)
      .map((el) => el.index as number);

    const statsToDelete = selectedElements
      .filter((el) => el.type === 'stat' && el.index !== undefined)
      .map((el) => el.index as number);

    const graphsToDelete = selectedElements
      .filter((el) => el.type === 'graph' && el.index !== undefined)
      .map((el) => el.index as number);

    const knobsToDelete = selectedElements
      .filter((el) => el.type === 'knob' && el.index !== undefined)
      .map((el) => el.index as number);

    const pluginsToDelete = selectedElements
      .filter((el) => el.type === 'plugin')
      .map((el) => el.id);
    const gestureId = crypto.randomUUID();
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
      keysToDelete.length > 0 ||
      statsToDelete.length > 0 ||
      graphsToDelete.length > 0 ||
      knobsToDelete.length > 0;
    const isMixedDeletion = hasEditorDeletion && pluginIdsToDelete.length > 0;
    try {
      if (isMixedDeletion) {
        pluginIdsToDelete.forEach((pluginId) => {
          rotatePluginInstancesEditSession(pluginId, gestureId);
        });
        beginMixedGestureTransaction(gestureId, pluginIdsToDelete);
      }

      // 먼저 선택 해제 (삭제된 인덱스 참조 방지)
      clearSelection();

      // 키 배치 삭제 (atomic update로 한 번의 리렌더링만 발생)
      if (keysToDelete.length > 0) {
        const { keyMappings: km, canonicalPositions: pos } =
          useKeyStore.getState();
        const mapping = km[selectedKeyType] || [];
        const posArray = pos[selectedKeyType] || [];

        // 삭제할 인덱스를 Set으로 변환 (O(1) 조회)
        const deleteSet = new Set(keysToDelete);

        const updatedMappings = {
          ...km,
          [selectedKeyType]: mapping.filter(
            (_, index) => !deleteSet.has(index),
          ),
        };

        const updatedPositions = {
          ...pos,
          [selectedKeyType]: posArray.filter(
            (_, index) => !deleteSet.has(index),
          ),
        };

        // Atomic update: mappings, positions 동시 업데이트로 중간 상태 방지
        useKeyStore
          .getState()
          .setKeyMappingsAndPositions(updatedMappings, updatedPositions);
      }

      // 플러그인 요소 배치 삭제
      if (pluginsToDelete.length > 0) {
        deletePluginElements(pluginsToDelete, gestureId);
      }

      // 통계 요소 배치 삭제
      if (statsToDelete.length > 0) {
        const current = useStatItemStore.getState().positions;
        const tabPositions = current[selectedKeyType] || [];
        const deleteSet = new Set(statsToDelete);
        const updatedPositions = {
          ...current,
          [selectedKeyType]: tabPositions.filter(
            (_, idx) => !deleteSet.has(idx),
          ),
        };

        useStatItemStore.getState().setPositions(updatedPositions);
      }

      // 그래프 요소 배치 삭제
      if (graphsToDelete.length > 0) {
        const current = useGraphItemStore.getState().positions;
        const tabPositions = current[selectedKeyType] || [];
        const deleteSet = new Set(graphsToDelete);
        const updatedPositions = {
          ...current,
          [selectedKeyType]: tabPositions.filter(
            (_, idx) => !deleteSet.has(idx),
          ),
        };

        useGraphItemStore.getState().setPositions(updatedPositions);
      }

      // 노브 요소 배치 삭제
      if (knobsToDelete.length > 0) {
        const current = useKnobItemStore.getState().positions;
        const tabPositions = current[selectedKeyType] || [];
        const deleteSet = new Set(knobsToDelete);
        const updatedPositions = {
          ...current,
          [selectedKeyType]: tabPositions.filter(
            (_, idx) => !deleteSet.has(idx),
          ),
        };

        useKnobItemStore.getState().setPositions(updatedPositions);
      }

      const normalized = normalizeLayerGroupsForMode({
        mode: selectedKeyType,
        keyPositions: useKeyStore.getState().canonicalPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        knobPositions: useKnobItemStore.getState().positions,
        layerGroups: useLayerGroupStore.getState().layerGroups,
      });

      if (normalized.positionsChanged || normalized.groupsChanged) {
        useKeyStore.getState().setPositions(normalized.keyPositions);
        useStatItemStore.getState().setPositions(normalized.statPositions);
        useGraphItemStore.getState().setPositions(normalized.graphPositions);
        useKnobItemStore.getState().setPositions(normalized.knobPositions);
        if (normalized.groupsChanged) {
          useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
        }
      }

      if (
        hasEditorDeletion ||
        normalized.positionsChanged ||
        normalized.groupsChanged
      ) {
        const keyState = useKeyStore.getState();
        const editorChanges = {
          schemaVersion: 1 as const,
          ...(keysToDelete.length > 0 ? { keys: keyState.keyMappings } : {}),
          keyPositions: keyState.canonicalPositions,
          statPositions: useStatItemStore.getState().positions,
          graphPositions: useGraphItemStore.getState().positions,
          knobPositions: useKnobItemStore.getState().positions,
          layerGroups: useLayerGroupStore.getState().layerGroups,
        };
        try {
          if (isMixedDeletion) {
            await commitMixedGestureTransaction(
              gestureId,
              editorChanges,
              pluginIdsToDelete,
            );
          } else {
            await editorCoordinator.commitPatch(editorChanges, { gestureId });
          }
        } catch (error) {
          console.error('Failed to persist selected element deletion', error);
        }
      }
    } finally {
      if (isMixedDeletion) {
        cancelUncommittedMixedGestureTransaction(gestureId);
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

  // 클립보드에서 붙여넣기
  const pasteElements = async () => {
    // 최신 클립보드 상태를 직접 스토어에서 가져오기 (클로저 문제 방지)
    const currentClipboard = useGridSelectionStore.getState().clipboard;
    if (currentClipboard.length === 0) return;
    const gestureId = crypto.randomUUID();
    const clipboardGroups = useGridSelectionStore.getState().clipboardGroups;

    // 최신 상태를 직접 스토어에서 가져오기 (클로저 문제 방지)
    const currentLayerGroups = useLayerGroupStore.getState().layerGroups;

    // 현재 선택 상태 캡처 (paste 후 선택이 바뀌기 전에 앵커 계산용)
    const currentSelectedElements =
      useGridSelectionStore.getState().selectedElements;
    const currentSelectedGroupIds =
      useGridSelectionStore.getState().selectedGroupIds;

    // 그룹 복사인 경우: 새 그룹 생성 + groupId 매핑
    const groupIdMap = new Map<string, string>();
    if (clipboardGroups.length > 0) {
      const modeGroups = [...(currentLayerGroups[selectedKeyType] || [])];
      for (const cg of clipboardGroups) {
        const newGroupId = crypto.randomUUID();
        const newGroupName = buildNextLayerGroupName(cg.name, modeGroups);
        groupIdMap.set(cg.id, newGroupId);
        modeGroups.push({ id: newGroupId, name: newGroupName });
      }
      const updatedLayerGroups = {
        ...currentLayerGroups,
        [selectedKeyType]: modeGroups,
      };
      useLayerGroupStore.getState().setLayerGroups(updatedLayerGroups);

      // 원본 그룹의 collapsed 상태 복원
      for (const cg of clipboardGroups) {
        if (cg.collapsed) {
          const newGroupId = groupIdMap.get(cg.id);
          if (newGroupId) {
            useLayerGroupStore.getState().setCollapsed(newGroupId, true);
          }
        }
      }
    }

    // groupId 리매핑 헬퍼 (삭제된 그룹 참조 방지)
    const modeGroups = currentLayerGroups[selectedKeyType] || [];
    const remapGroupId = (groupId: string | undefined) => {
      if (!groupId) return groupId;
      if (groupIdMap.has(groupId)) return groupIdMap.get(groupId);
      return modeGroups.some((g) => g.id === groupId) ? groupId : undefined;
    };

    const keysToAdd: { keyCode: KeySlot; position: KeyPosition }[] = [];
    const statsToAdd: { position: StatItemPosition }[] = [];
    const graphsToAdd: { position: GraphItemPosition }[] = [];
    const knobsToAdd: { position: KnobItemPosition }[] = [];
    const pluginsToAdd: Omit<PluginDisplayElementInternal, 'fullId'>[] = [];

    for (const item of currentClipboard) {
      if (item.type === 'key') {
        keysToAdd.push({
          keyCode: cloneSlot(item.keyCode),
          position: {
            ...item.position,
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'stat') {
        statsToAdd.push({
          position: {
            ...item.position,
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'graph') {
        graphsToAdd.push({
          position: {
            ...item.position,
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'knob') {
        knobsToAdd.push({
          position: {
            ...item.position,
            groupId: remapGroupId(item.position.groupId),
            dx: (item.position.dx || 0) + PASTE_OFFSET,
            dy: (item.position.dy || 0) + PASTE_OFFSET,
          },
        });
      } else if (item.type === 'plugin') {
        pluginsToAdd.push({
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

    const pluginIdsToAdd = [
      ...new Set(pluginsToAdd.map((element) => element.pluginId)),
    ];
    const hasEditorPaste =
      keysToAdd.length > 0 ||
      statsToAdd.length > 0 ||
      graphsToAdd.length > 0 ||
      knobsToAdd.length > 0 ||
      clipboardGroups.length > 0;
    const isMixedPaste = hasEditorPaste && pluginIdsToAdd.length > 0;
    try {
      if (isMixedPaste) {
        pluginIdsToAdd.forEach((pluginId) => {
          rotatePluginInstancesEditSession(pluginId, gestureId);
        });
        beginMixedGestureTransaction(gestureId, pluginIdsToAdd);
      }

      // 새로 추가된 요소들의 선택을 위한 인덱스 추적
      const newSelectedElements: SelectedElement[] = [];

      // 붙여넣은 키 매핑 — 저장은 zIndex 확정 후 마지막에 1회만 (중간 저장은 순서 역전·패딩 위험)
      let pastedKeyMappings: KeyMappings | null = null;

      // 키 추가
      if (keysToAdd.length > 0) {
        const km = useKeyStore.getState().keyMappings;
        const pos = useKeyStore.getState().canonicalPositions;
        const mapping = [...(km[selectedKeyType] || [])];
        const posArray = [...(pos[selectedKeyType] || [])];

        const startIndex = mapping.length;

        for (let i = 0; i < keysToAdd.length; i++) {
          mapping.push(keysToAdd[i].keyCode);
          posArray.push(keysToAdd[i].position);
          newSelectedElements.push({
            type: 'key',
            id: `key-${startIndex + i}`,
            index: startIndex + i,
          });
        }

        const updatedMappings = { ...km, [selectedKeyType]: mapping };
        const updatedPositions = { ...pos, [selectedKeyType]: posArray };

        useKeyStore
          .getState()
          .setKeyMappingsAndPositions(updatedMappings, updatedPositions);

        pastedKeyMappings = updatedMappings;
      }

      // 통계 요소 추가
      if (statsToAdd.length > 0) {
        const current = useStatItemStore.getState().positions;
        const posArray = [...(current[selectedKeyType] || [])];
        const startIndex = posArray.length;

        for (let i = 0; i < statsToAdd.length; i++) {
          posArray.push(statsToAdd[i].position);
          newSelectedElements.push({
            type: 'stat',
            id: `stat-${startIndex + i}`,
            index: startIndex + i,
          });
        }

        const updatedPositions: StatItemPositions = {
          ...current,
          [selectedKeyType]: posArray,
        };
        useStatItemStore.getState().setPositions(updatedPositions);
      }

      // 그래프 요소 추가
      if (graphsToAdd.length > 0) {
        const current = useGraphItemStore.getState().positions;
        const posArray = [...(current[selectedKeyType] || [])];
        const startIndex = posArray.length;

        for (let i = 0; i < graphsToAdd.length; i++) {
          posArray.push(graphsToAdd[i].position);
          newSelectedElements.push({
            type: 'graph',
            id: `graph-${startIndex + i}`,
            index: startIndex + i,
          });
        }

        const updatedPositions: GraphItemPositions = {
          ...current,
          [selectedKeyType]: posArray,
        };
        useGraphItemStore.getState().setPositions(updatedPositions);
      }

      // 노브 요소 추가 (zIndex 레이어 재배치 대상 외 — 별도 영속/동기화)
      if (knobsToAdd.length > 0) {
        const current = useKnobItemStore.getState().positions;
        const posArray = [...(current[selectedKeyType] || [])];
        const startIndex = posArray.length;

        for (let i = 0; i < knobsToAdd.length; i++) {
          posArray.push(knobsToAdd[i].position);
          newSelectedElements.push({
            type: 'knob',
            id: `knob-${startIndex + i}`,
            index: startIndex + i,
          });
        }

        const updatedPositions: KnobItemPositions = {
          ...current,
          [selectedKeyType]: posArray,
        };
        useKnobItemStore.getState().setPositions(updatedPositions);
      }

      // 플러그인 요소 추가
      if (pluginsToAdd.length > 0) {
        new Set(pluginsToAdd.map((element) => element.pluginId)).forEach(
          (pluginId) => {
            rotatePluginInstancesEditSession(pluginId, gestureId);
          },
        );
        const currentElements =
          usePluginDisplayElementStore.getState().elements;
        const newElements = [...currentElements];

        for (const elementData of pluginsToAdd) {
          // 새로운 고유 ID 생성
          const newFullId = `${elementData.pluginId}:${
            elementData.id
          }:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const newElement = {
            ...elementData,
            fullId: newFullId,
          };
          newElements.push(newElement);
          newSelectedElements.push({
            type: 'plugin',
            id: newFullId,
          });
        }

        usePluginDisplayElementStore.getState().setElements(newElements);
      }

      // === Phase 2: paste 위치 결정 + zIndex 재계산 ===
      const freshKeyPos = useKeyStore.getState().canonicalPositions;
      const freshStatPos = useStatItemStore.getState().positions;
      const freshGraphPos = useGraphItemStore.getState().positions;
      const freshKnobPos = useKnobItemStore.getState().positions;
      const freshPluginEls = usePluginDisplayElementStore.getState().elements;

      // 전체 레이어 목록 구성 (새로 push된 아이템 포함)
      const allItems = buildLayerItemsForMode(
        selectedKeyType,
        freshKeyPos,
        freshStatPos,
        freshGraphPos,
        freshKnobPos,
        freshPluginEls,
      );

      // 새 아이템과 기존 아이템 분리
      const newIds = new Set(newSelectedElements.map((el) => el.id));
      const existing = allItems.filter((item) => !newIds.has(item.id));
      const pasted = allItems.filter((item) => newIds.has(item.id));

      // 앵커 위치 계산 (paste 전 선택 기준)
      const anchor = findPasteAnchorIndex(
        existing,
        currentSelectedElements,
        currentSelectedGroupIds,
      );

      // 새 아이템을 앵커 위치에 삽입
      const reordered = [
        ...existing.slice(0, anchor),
        ...pasted,
        ...existing.slice(anchor),
      ];

      // zIndex 일괄 재부여
      const patch = applyZIndexToLayerOrder(
        reordered,
        selectedKeyType,
        freshKeyPos,
        freshStatPos,
        freshGraphPos,
        freshKnobPos,
      );

      // 스토어 업데이트 (동기 — 배칭으로 한 번에 렌더)
      useKeyStore.getState().setPositions(patch.keyPositions);
      useStatItemStore.getState().setPositions(patch.statPositions);
      useGraphItemStore.getState().setPositions(patch.graphPositions);
      useKnobItemStore.getState().setPositions(patch.knobPositions);
      for (const { fullId, zIndex } of patch.pluginUpdates) {
        usePluginDisplayElementStore
          .getState()
          .updateElement(fullId, { zIndex }, { skipSync: true });
      }

      // 선택 업데이트도 동기 구간에서 처리 (await 전에 실행해야 깜빡임 방지)
      if (newSelectedElements.length > 0) {
        useGridSelectionStore.getState().setSkipPanelModeSwitch(true);
        if (groupIdMap.size > 0) {
          const newGroupIds = Array.from(groupIdMap.values());
          useGridSelectionStore
            .getState()
            .setFullSelection(newSelectedElements, newGroupIds);
        } else {
          setSelectedElements(newSelectedElements);
        }
      }

      // 붙여넣기 전체를 한 revision으로 저장
      const editorChanges = {
        schemaVersion: 1 as const,
        ...(pastedKeyMappings ? { keys: pastedKeyMappings } : {}),
        keyPositions: patch.keyPositions,
        statPositions: patch.statPositions,
        graphPositions: patch.graphPositions,
        knobPositions: patch.knobPositions,
        layerGroups: useLayerGroupStore.getState().layerGroups,
      };
      try {
        if (isMixedPaste) {
          await commitMixedGestureTransaction(
            gestureId,
            editorChanges,
            pluginIdsToAdd,
          );
        } else {
          await editorCoordinator.commitPatch(editorChanges, { gestureId });
        }
      } catch (error) {
        console.error('Failed to persist pasted elements', error);
      }
      const pluginEls = usePluginDisplayElementStore.getState().elements;
      sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
        elements: pluginEls,
      });
    } finally {
      if (isMixedPaste) {
        cancelUncommittedMixedGestureTransaction(gestureId);
      }
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
