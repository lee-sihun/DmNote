/**
 * Grid 선택 관련 로직 훅
 * - 선택된 요소들 이동
 * - 선택된 요소들 삭제
 * - 복사/붙여넣기
 */

import { useRef } from 'react';
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
import type { KeyMappings, KeySlot } from '@src/types/key/keys';
import { cloneSlot } from '@utils/keySlot';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  buildNextLayerGroupName,
  buildLayerItemsForMode,
  applyZIndexToLayerOrder,
} from '@utils/layerGroupUtils';
import { commitGeneratedSemanticOps } from '@src/renderer/editor/runtime/editorSemanticOps';
import {
  ElementIntentAbort,
  applySealedSliceMutation,
  combineReceipts,
  createPropertyReceipt,
  generateGeometryIntentOps,
  reportElementOpSkipped,
  type ElementIntentReceipt,
  type PropertyIntents,
  type PropertyReceiptEntry,
} from '@src/renderer/editor/runtime/elementIntent';
import {
  applyPluginAdditionEagerly,
  runMixedGestureElementIntent,
} from '@src/renderer/editor/runtime/mixedElementIntent';
import { stableStringify } from '@utils/core/stableStringify';
import type {
  CanonicalEditorDocumentV1,
  CanonicalKeyPosition,
  CanonicalStatItemPosition,
  CanonicalGraphItemPosition,
  CanonicalKnobItemPosition,
  EditorInsertFrozenElementsOpV1,
} from '@src/types/editor';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { reissueDisplayElementHandlers } from '@plugins/runtime/displayElement/displayElementApi';
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/deleteFrozenSelection';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';

// 붙여넣기 블록의 스택 순서 결정. 배열 위치가 곧 최종 z이므로 원본의 상대
// 스택(동결 payload zIndex 내림차순)을 따르고, 동률은 payload 순서로 안정
// 정렬한다. zIndex 없는 레거시 항목은 직전 항목의 z를 이어받아 payload 내
// 원본 상대 순서를 지킨다 - append 후 배열 위치를 쓰면 블록 최상단으로 튄다
const orderPastedItemsByFrozenZ = <T>(
  entries: ReadonlyArray<{ item: T; zIndex: number | undefined }>,
): T[] => {
  let carry = Number.POSITIVE_INFINITY;
  return entries
    .map(({ item, zIndex }, order) => {
      carry = zIndex ?? carry;
      return { item, order, z: carry };
    })
    .sort((a, b) => b.z - a.z || a.order - b.order)
    .map((entry) => entry.item);
};

interface UseGridSelectionParams {
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  keyMappings: KeyMappings;
  positions: CanonicalEditorDocumentV1['keyPositions'];
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
  syncSelectedElementsToOverlay: (
    gestureId?: string,
    frozenTargets?: readonly SelectedElement[],
  ) => void;
  // 게스처 시작 시점 대상 동결. 정산이 완료 시점 live 선택을 다시 읽으면
  // 대기 중 선택 해제가 eager 이동을 통째로 삼킨다
  freezeSelectionForGesture: () => void;
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
  const setSelectedElements = useGridSelectionStore(
    (state) => state.setSelectedElements,
  );
  const clipboard = useGridSelectionStore((state) => state.clipboard);
  const setClipboard = useGridSelectionStore((state) => state.setClipboard);

  // 훅이 동결을 소유한다 - 호출부가 정산에 인자를 넘기는 것을 잊어도
  // live 재조회로 떨어지지 않게 한다
  const frozenGestureTargetsRef = useRef<readonly SelectedElement[] | null>(
    null,
  );
  const freezeSelectionForGesture = () => {
    frozenGestureTargetsRef.current =
      useGridSelectionStore.getState().selectedElements;
  };

  // 선택된 요소들의 최종 위치를 한 번에 저장
  // 커밋 base는 canonical - rendered에는 다른 세션의 미커밋 프리뷰가 섞일 수 있음
  // 정산 대상은 호출부가 동결한 집합 우선 - eager를 적용한 집합과 커밋 대상이
  // 어긋나면 옛 대상의 이동이 wire에 실리지 않아 다음 canonical 적용에서 소실
  const syncSelectedElementsToOverlay = (
    gestureId?: string,
    frozenTargets?: readonly SelectedElement[],
  ) => {
    const currentPositions = useKeyStore.getState().canonicalPositions;
    const currentStatPositions = useStatItemStore.getState().positions;
    const currentGraphPositions = useGraphItemStore.getState().positions;
    const currentKnobPositions = useKnobItemStore.getState().positions;
    const frozen = frozenTargets ?? frozenGestureTargetsRef.current;
    frozenGestureTargetsRef.current = null;
    const currentSelection =
      frozen ?? useGridSelectionStore.getState().selectedElements;
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
    // mutation 직후에 착지해 무관 필드 재작성을 되돌린다
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
        (target) => target.id.length > 0 && isNativeElementId(target.id),
      );
    // 게스처 정산인데 대상이 하나도 없다 - 호출부가 시작 시점 대상을 동결하지
    // 않아 대기 중 선택 해제가 eager 이동을 통째로 삼킨 경우다. plugin-only
    // 선택(editor 무커밋 계약)과 구분해 관측 가능하게 남긴다
    if (gestureId && currentSelection.length === 0) {
      reportElementOpSkipped('drag settlement without frozen targets');
    }
    // plugin-only 선택은 editor 의도가 없다 - editor 무커밋
    if (nativeTargets.length > 0) {
      if (!allStableIds) {
        reportElementOpSkipped('invalid native selection settlement');
      } else {
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
              Array<{ id: string } & Record<string, unknown>>
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
        const receipt = createPropertyReceipt(receiptEntries);
        if (gestureId && isMixed) {
          void runMixedGestureElementIntent({
            gestureId,
            initialPluginIds: pluginIds,
            // 이동 정산은 plugin 요소를 추가·제거하지 않아 scope가 고정이다
            pluginScope: () => pluginIds,
            receipt,
            generate: ({ base }) => {
              const ops = generateGeometryIntentOps(base, geometryIntents);
              // 전량 소실은 무커밋 - abort가 receipt 복원과 skip 관측을 소유한다
              if (ops.length === 0) {
                throw new ElementIntentAbort('mixed selection settlement');
              }
              return { kind: 'ops', ops };
            },
            skipContext: 'mixed selection settlement',
          }).catch((error: Error) => {
            console.error(
              'Failed to persist selected element positions',
              error,
            );
          });
        } else {
          // native 단독 정산도 같은 setBounds ops 경로 - 전량 소실은 null
          // 무커밋 후 receipt 복원, 실패는 편입 전에만 복원 (mixed와 동일 규약)
          let enrolled = false;
          void commitGeneratedSemanticOps(
            (base) => {
              const ops = generateGeometryIntentOps(base, geometryIntents);
              return ops.length > 0 ? ops : null;
            },
            {
              ...(gestureId ? { gestureId } : {}),
              onEnrolled: () => {
                enrolled = true;
              },
            },
          )
            .then((outcome) => {
              if (!outcome) {
                receipt?.rollback();
                reportElementOpSkipped('native selection settlement');
              }
            })
            .catch((error: Error) => {
              if (!enrolled) receipt?.rollback();
              console.error(
                'Failed to persist selected element positions',
                error,
              );
            });
        }
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
    const keyUpdates = selectedElements.filter((el) => el.type === 'key');
    if (keyUpdates.length > 0) {
      const newPositions = { ...currentPositions };
      const tabPositions = [...(newPositions[selectedKeyType] || [])];

      keyUpdates.forEach((el) => {
        const index = tabPositions.findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return;
        const currentPos = tabPositions[index];
        if (currentPos) {
          tabPositions[index] = {
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
    const statUpdates = selectedElements.filter((el) => el.type === 'stat');
    if (statUpdates.length > 0) {
      const currentStatPositions = useStatItemStore.getState().positions;
      const newStatPositions = { ...currentStatPositions };
      const tabPositions = [...(newStatPositions[selectedKeyType] || [])];

      statUpdates.forEach((el) => {
        const index = tabPositions.findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return;
        const currentPos = tabPositions[index];
        if (currentPos) {
          tabPositions[index] = {
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
    const graphUpdates = selectedElements.filter((el) => el.type === 'graph');
    if (graphUpdates.length > 0) {
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const newGraphPositions = { ...currentGraphPositions };
      const tabPositions = [...(newGraphPositions[selectedKeyType] || [])];

      graphUpdates.forEach((el) => {
        const index = tabPositions.findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return;
        const currentPos = tabPositions[index];
        if (currentPos) {
          tabPositions[index] = {
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
    const knobUpdates = selectedElements.filter((el) => el.type === 'knob');
    if (knobUpdates.length > 0) {
      const currentKnobPositions = useKnobItemStore.getState().positions;
      const newKnobPositions = { ...currentKnobPositions };
      const tabPositions = [...(newKnobPositions[selectedKeyType] || [])];

      knobUpdates.forEach((el) => {
        const index = tabPositions.findIndex(
          (position) => position.id === el.id,
        );
        if (index < 0) return;
        const currentPos = tabPositions[index];
        if (currentPos) {
          tabPositions[index] = {
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
    let stagedBeforeEagerWrite = false;
    if (pluginUpdates.length > 0) {
      if (gestureId) {
        const selectedPluginIds = new Set(
          pluginUpdates.map((element) => element.id),
        );
        const movedPluginIds = [
          ...new Set(
            currentPluginElements
              .filter((element) => selectedPluginIds.has(element.fullId))
              .map((element) => element.pluginId),
          ),
        ];
        const hasNativeUpdates =
          keyUpdates.length > 0 ||
          statUpdates.length > 0 ||
          graphUpdates.length > 0 ||
          knobUpdates.length > 0;
        // 혼합 이동은 staging을 eager 쓰기 앞에 세운다 - 쓰기 시점에 예약되는
        // debounce 커밋이 settle의 gesture 커밋보다 먼저 착지하면 같은
        // 제스처의 히스토리가 두 엔트리로 쪼개진다
        if (syncToOverlay && hasNativeUpdates && movedPluginIds.length > 0) {
          beginMixedGestureTransaction(gestureId, movedPluginIds);
          stagedBeforeEagerWrite = true;
        }
        movedPluginIds.forEach((pluginId) => {
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
      // 정산은 이 호출이 eager를 적용한 클로저의 선택 집합으로 - RAF flush가
      // 선택 변경 뒤에 돌아도 옛 대상 이동이 그대로 커밋된다
      syncSelectedElementsToOverlay(gestureId, selectedElements);
      // settle이 mixed 커밋을 시작하지 못한 경로의 사전 staging 정산 -
      // 커밋이 소유권을 가져간 staged는 건드리지 않는다
      if (stagedBeforeEagerWrite && gestureId) {
        cancelUncommittedMixedGestureTransaction(gestureId);
      }
    }
  };

  // 선택된 요소들 삭제 함수 (배치 삭제)
  // 대상은 호출 시점의 canonical id로 동결하고 eager는 봉인 구조 receipt,
  // wire는 슬롯 base에서 재생성. full-record 캡처 커밋 금지 - 대기 중
  // 정산된 다른 커밋을 되돌린다
  const deleteSelectedElements = async () => {
    await deleteFrozenSelection(selectedElements);
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
      if (element.type === 'key') {
        const index = currentPositions.findIndex(
          (position) => position.id === element.id,
        );
        const keyCode = index >= 0 ? currentMappings[index] : undefined;
        const position = index >= 0 ? currentPositions[index] : undefined;
        if (keyCode && position) {
          clipboardItems.push({
            type: 'key',
            keyCode: cloneSlot(keyCode),
            position: { ...position },
          });
        }
      } else if (element.type === 'stat') {
        const position = currentStatPositions.find(
          (candidate) => candidate.id === element.id,
        );
        if (position) {
          clipboardItems.push({
            type: 'stat',
            position: { ...position },
          });
        }
      } else if (element.type === 'graph') {
        const position = currentGraphPositions.find(
          (candidate) => candidate.id === element.id,
        );
        if (position) {
          clipboardItems.push({
            type: 'graph',
            position: { ...position },
          });
        }
      } else if (element.type === 'knob') {
        const position = currentKnobPositions.find(
          (candidate) => candidate.id === element.id,
        );
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
    const keysToAdd: {
      keyCode: KeySlot;
      position: CanonicalKeyPosition;
    }[] = [];
    const statsToAdd: { position: CanonicalStatItemPosition }[] = [];
    const graphsToAdd: { position: CanonicalGraphItemPosition }[] = [];
    const knobsToAdd: { position: CanonicalKnobItemPosition }[] = [];
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

    // maxInstances 사전 검증 - add 경로(생성 메뉴)와 동일하게 상한 도달 시
    // 거부·경고. 혼합 선택도 destructive 관례(부분 성공 금지)에 따라 전체 중단
    const frozenInstanceCaps: Array<{
      definitionId: string;
      pluginId: string;
      maxInstances: number;
      pastedCount: number;
    }> = [];
    if (pluginPayloads.length > 0) {
      const pastedCountByDefinition = new Map<string, number>();
      for (const element of pluginPayloads) {
        if (!element.definitionId) continue;
        pastedCountByDefinition.set(
          element.definitionId,
          (pastedCountByDefinition.get(element.definitionId) ?? 0) + 1,
        );
      }
      const { definitions, elements: currentElements } =
        usePluginDisplayElementStore.getState();
      for (const [definitionId, pastedCount] of pastedCountByDefinition) {
        const definition = definitions.get(definitionId);
        const maxInstances = definition?.maxInstances;
        if (!definition || !maxInstances || maxInstances <= 0) continue;
        frozenInstanceCaps.push({
          definitionId,
          pluginId: definition.pluginId,
          maxInstances,
          pastedCount,
        });
        const currentCount = currentElements.filter(
          (element) =>
            element.definitionId === definitionId &&
            element.tabId === selectedKeyType,
        ).length;
        if (currentCount + pastedCount > maxInstances) {
          console.warn(
            `[Plugin ${definition.pluginId}] Max instances (${maxInstances}) reached for ${definitionId} in tab ${selectedKeyType}`,
          );
          reportElementOpSkipped('paste max instances');
          return;
        }
      }
    }

    // plugin id·fullId 사전 동결 - eager 루프 생성은 retry·receipt를 비결정적으로
    // 만든다. 붙여넣기는 새 인스턴스이므로 id 재발급 - 복사 원본 id를 유지하면
    // 영구 instanceId가 중복되어 백엔드 커밋이 거절된다. 핸들러 등록도 원본과
    // 공유하지 않도록 재발급 - _onXxxId 공유는 한쪽 제거가 다른 쪽을 죽인다
    const frozenPluginElements: PluginDisplayElementInternal[] =
      pluginPayloads.map((element) => {
        const id = crypto.randomUUID();
        return {
          ...reissueDisplayElementHandlers(element),
          id,
          fullId: `${element.pluginId}::${id}`,
        };
      });
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
      keyPositions: CanonicalEditorDocumentV1['keyPositions'];
      statPositions: CanonicalEditorDocumentV1['statPositions'];
      graphPositions: CanonicalEditorDocumentV1['graphPositions'];
      knobPositions: CanonicalEditorDocumentV1['knobPositions'];
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
      nativeBatchState: 'fresh' | 'realized' | 'partial';
      frozenGroupConflict: boolean;
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
            const index = (list as Array<{ id: string }>).findIndex(
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
      let realizedFrozenNativeParts = 0;
      let missingFrozenNativeParts = 0;
      let frozenGroupConflict = false;
      for (const entry of keysToAdd) {
        const existing = findNativeById(entry.position.id);
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
          realizedFrozenNativeParts += 1;
          continue;
        }
        nextKeys[mode] = [...(nextKeys[mode] ?? []), entry.keyCode];
        nextKeyPositions[mode] = [
          ...(nextKeyPositions[mode] ?? []),
          entry.position,
        ];
        appendedNativeIds.add(entry.position.id);
        missingFrozenNativeParts += 1;
        appended = true;
      }
      const appendSimple = <T extends { id: string }>(
        record: Record<string, T[]>,
        entries: Array<{ position: T }>,
        field: keyof PasteDocView,
      ): Record<string, T[]> => {
        let next = record;
        for (const entry of entries) {
          const existing = findNativeById(entry.position.id);
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
            realizedFrozenNativeParts += 1;
            continue;
          }
          next = { ...next, [mode]: [...(next[mode] ?? []), entry.position] };
          appendedNativeIds.add(entry.position.id);
          missingFrozenNativeParts += 1;
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
          const existing = modeGroups.find(
            (candidate) => candidate.id === group.id,
          );
          if (existing) {
            if (existing.name !== group.name) {
              frozenGroupConflict = true;
            }
            realizedFrozenNativeParts += 1;
            continue;
          }
          modeGroups.push({ id: group.id, name: group.name });
          missingFrozenNativeParts += 1;
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

      // 상한 재검증 - 동결과 정산 사이 추가된 인스턴스와의 TOCTOU 차단.
      // 초과는 부분 성공 대신 전체 중단 (사전 검증과 동일한 fail-closed)
      for (const cap of frozenInstanceCaps) {
        const count = combinedProjection.filter(
          (element) =>
            element.definitionId === cap.definitionId && element.tabId === mode,
        ).length;
        if (count > cap.maxInstances) {
          throw new ElementIntentAbort('paste max instances exceeded');
        }
      }

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
      // 순서라 그대로 쓰면 복사본의 위아래가 뒤집힌다. 정렬 키는 동결
      // payload의 zIndex 원본값 (append 후 대체값이 아니라)
      const pastedOrdered = orderPastedItemsByFrozenZ([
        ...keysToAdd.map((entry) => ({
          item: entry.position.id,
          zIndex: entry.position.zIndex,
        })),
        ...statsToAdd.map((entry) => ({
          item: entry.position.id,
          zIndex: entry.position.zIndex,
        })),
        ...graphsToAdd.map((entry) => ({
          item: entry.position.id,
          zIndex: entry.position.zIndex,
        })),
        ...knobsToAdd.map((entry) => ({
          item: entry.position.id,
          zIndex: entry.position.zIndex,
        })),
        ...frozenPluginElements.map((element) => ({
          item: element.fullId,
          zIndex: element.zIndex,
        })),
      ])
        .map((id) => pastedById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
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
        nativeBatchState:
          realizedFrozenNativeParts > 0 && missingFrozenNativeParts > 0
            ? 'partial'
            : realizedFrozenNativeParts > 0
            ? 'realized'
            : 'fresh',
        frozenGroupConflict,
      };
    };

    const buildFrozenInsertOp = (
      view: PasteDocView,
      plan: ReturnType<typeof computePaste>,
    ): { kind: 'ops'; op: EditorInsertFrozenElementsOpV1 | null } => {
      const mode = selectedKeyType;
      const frozenNativeIds = new Set([
        ...keysToAdd.map((entry) => entry.position.id),
        ...statsToAdd.map((entry) => entry.position.id),
        ...graphsToAdd.map((entry) => entry.position.id),
        ...knobsToAdd.map((entry) => entry.position.id),
      ]);
      const finalById = <T extends { id: string }>(
        record: Record<string, T[]>,
      ) =>
        new Map(
          (record[mode] ?? []).map((position) => [position.id, position]),
        );
      const finalKeys = finalById(plan.zPatch.keyPositions);
      const finalStats = finalById(plan.zPatch.statPositions);
      const finalGraphs = finalById(plan.zPatch.graphPositions);
      const finalKnobs = finalById(plan.zPatch.knobPositions);
      const elements: EditorInsertFrozenElementsOpV1['elements'] = [
        ...keysToAdd.map((entry) => ({
          elementType: 'key' as const,
          slot: entry.keyCode,
          position: finalKeys.get(entry.position.id) ?? entry.position,
        })),
        ...statsToAdd.map((entry) => ({
          elementType: 'stat' as const,
          position: finalStats.get(entry.position.id) ?? entry.position,
        })),
        ...graphsToAdd.map((entry) => ({
          elementType: 'graph' as const,
          position: finalGraphs.get(entry.position.id) ?? entry.position,
        })),
        ...knobsToAdd.map((entry) => ({
          elementType: 'knob' as const,
          position: finalKnobs.get(entry.position.id) ?? entry.position,
        })),
      ];
      const zUpdates: EditorInsertFrozenElementsOpV1['zUpdates'] = [];
      const collectZUpdates = (
        elementType: 'key' | 'stat' | 'graph' | 'knob',
        current: Array<{ id: string }>,
        final: Map<string, { id: string; zIndex?: number }>,
      ) => {
        for (const position of current) {
          const id = position.id;
          if (!id || !isNativeElementId(id)) return false;
          if (frozenNativeIds.has(id)) continue;
          const zIndex = final.get(id)?.zIndex;
          if (!Number.isSafeInteger(zIndex)) return false;
          zUpdates.push({ elementType, id, zIndex: zIndex! });
        }
        return true;
      };
      const stable =
        collectZUpdates('key', view.keyPositions[mode] ?? [], finalKeys) &&
        collectZUpdates('stat', view.statPositions[mode] ?? [], finalStats) &&
        collectZUpdates(
          'graph',
          view.graphPositions[mode] ?? [],
          finalGraphs,
        ) &&
        collectZUpdates('knob', view.knobPositions[mode] ?? [], finalKnobs);
      if (!stable) {
        throw new ElementIntentAbort('paste source document is not canonical');
      }
      if (plan.frozenGroupConflict) {
        throw new ElementIntentAbort('paste group id collision');
      }
      if (plan.nativeBatchState === 'partial') {
        throw new ElementIntentAbort('paste partial state collision');
      }
      if (elements.length === 0 && zUpdates.length === 0) {
        return { kind: 'ops', op: null };
      }
      return {
        kind: 'ops',
        op: {
          kind: 'insertFrozenElements',
          mode,
          elements,
          groups: frozenNewGroups.map(({ id, name }) => ({ id, name })),
          zUpdates,
        },
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
      // 편입 전 abort로 롤백되면 정산 뒤 pruneRolledBackPasteSelection이 정리한다
      const newSelectedElements: SelectedElement[] = [];
      const collect = (
        type: 'key' | 'stat' | 'graph' | 'knob',
        record: Record<string, Array<{ id: string }>>,
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
        keysToAdd.map((entry) => entry.position.id),
      );
      collect(
        'stat',
        useStatItemStore.getState().positions as never,
        statsToAdd.map((entry) => entry.position.id),
      );
      collect(
        'graph',
        useGraphItemStore.getState().positions as never,
        graphsToAdd.map((entry) => entry.position.id),
      );
      collect(
        'knob',
        useKnobItemStore.getState().positions as never,
        knobsToAdd.map((entry) => entry.position.id),
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
        if (groupIdMap.size > 0) {
          useGridSelectionStore
            .getState()
            .setFullSelection(newSelectedElements, [...groupIdMap.values()]);
        } else {
          setSelectedElements(newSelectedElements);
        }
      }

      // 편입 전 abort는 문서 적용 없이 eager만 되돌아가 선택 재조정이 없다 -
      // 이번 paste가 발급한 id 중 스토어에서 사라진 것만 선택에서 걷어낸다
      // (편입 후 실패의 eager 유지분은 스토어에 살아 있으므로 그대로 유지)
      const pruneRolledBackPasteSelection = () => {
        const newElementIds = new Set([
          ...keysToAdd.map((entry) => entry.position.id),
          ...statsToAdd.map((entry) => entry.position.id),
          ...graphsToAdd.map((entry) => entry.position.id),
          ...knobsToAdd.map((entry) => entry.position.id),
          ...frozenPluginElements.map((element) => element.fullId),
        ]);
        const presentIds = new Set<string>([
          ...(
            useKeyStore.getState().canonicalPositions[selectedKeyType] ?? []
          ).map((position) => position.id),
          ...(useStatItemStore.getState().positions[selectedKeyType] ?? []).map(
            (position) => position.id,
          ),
          ...(
            useGraphItemStore.getState().positions[selectedKeyType] ?? []
          ).map((position) => position.id),
          ...(useKnobItemStore.getState().positions[selectedKeyType] ?? []).map(
            (position) => position.id,
          ),
          ...usePluginDisplayElementStore
            .getState()
            .elements.map((element) => element.fullId),
        ]);
        const selection = useGridSelectionStore.getState();
        const keptElements = selection.selectedElements.filter(
          (element) =>
            !newElementIds.has(element.id) || presentIds.has(element.id),
        );
        const newGroupIds = new Set(groupIdMap.values());
        const presentGroupIds = new Set(
          (
            useLayerGroupStore.getState().layerGroups[selectedKeyType] ?? []
          ).map((group) => group.id),
        );
        const keptGroupIds = selection.selectedGroupIds.filter(
          (groupId) =>
            !newGroupIds.has(groupId) || presentGroupIds.has(groupId),
        );
        if (
          keptElements.length !== selection.selectedElements.length ||
          keptGroupIds.length !== selection.selectedGroupIds.length
        ) {
          selection.setFullSelection(keptElements, keptGroupIds);
        }
      };

      try {
        const result = await runMixedGestureElementIntent({
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
            const insert = buildFrozenInsertOp(
              {
                keys: base.keys as never,
                keyPositions: base.keyPositions as never,
                statPositions: base.statPositions as never,
                graphPositions: base.graphPositions as never,
                knobPositions: base.knobPositions as never,
                layerGroups: base.layerGroups as never,
              },
              plan,
            );
            if (insert.op) {
              return {
                kind: 'ops',
                ops: [insert.op],
                desiredPluginProjection: plan.desiredProjection,
              };
            }
            if (!plan.appended) return { kind: 'satisfied' };
            return {
              kind: 'patch',
              patch: null,
              desiredPluginProjection: plan.desiredProjection,
            };
          },
          skipContext: 'paste settlement',
        });
        if (!result.committed && !result.satisfied) {
          pruneRolledBackPasteSelection();
        }
      } catch (error) {
        // 편입 후 실패의 상태 정합은 projection·canonical pull이 소유 -
        // 호출부 경계에서는 기록만 (삭제 경로와 대칭)
        console.error('Failed to persist pasted elements', error);
        pruneRolledBackPasteSelection();
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
    freezeSelectionForGesture,
    clipboard,
  };
}
