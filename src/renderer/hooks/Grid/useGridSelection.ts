/**
 * Grid 선택 관련 로직 훅
 * - 선택된 요소들 이동
 * - 선택된 요소들 삭제
 * - 복사/붙여넣기
 */

import { useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  useGridSelectionStore,
  type SelectedElement,
  type ClipboardItem,
} from '@stores/grid/useGridSelectionStore';
import type { KeyMappings } from '@src/types/key/keys';
import { commitGeneratedSemanticOps } from '@src/renderer/editor/runtime/editorSemanticOps';
import {
  ElementIntentAbort,
  createPropertyReceipt,
  generateGeometryIntentOps,
  reportElementOpSkipped,
  type PropertyIntents,
  type PropertyReceiptEntry,
} from '@src/renderer/editor/runtime/elementIntent';
import {
  runMixedElementOpsIntent,
  runMixedGestureElementIntent,
} from '@src/renderer/editor/runtime/mixedElementIntent';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/deleteFrozenSelection';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import {
  moveSelectedNativePositions,
  moveSelectedPluginElements,
  selectedPluginIds,
} from '@utils/grid/selectionMovement';
import { createSelectionClipboardSnapshot } from '@utils/grid/selectionClipboard';
import { pasteSelection } from './pasteSelection';

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
    const currentSpritePositions = useSpriteStore.getState().positions;
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
        type: element.type as 'key' | 'stat' | 'graph' | 'knob' | 'sprite',
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
          (['key', 'stat', 'graph', 'knob', 'sprite'] as const).map((type) => [
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
                      : type === 'knob'
                      ? currentKnobPositions
                      : currentSpritePositions;
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
                : type === 'knob'
                ? 'knobPositions'
                : 'spritePositions';
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
    } else if (gestureId && pluginIds.length > 0) {
      void runMixedElementOpsIntent({
        gestureId,
        pluginIds,
        ops: [],
        receipt: null,
      }).catch((error: Error) => {
        console.error('Failed to persist selected plugin positions', error);
      });
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

    const selectedNativeIds = (
      type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite',
    ): Set<string> =>
      new Set(
        selectedElements
          .filter((element) => element.type === type)
          .map((element) => element.id),
      );

    const keyIds = selectedNativeIds('key');
    if (keyIds.size > 0) {
      useKeyStore
        .getState()
        .setPositions(
          moveSelectedNativePositions(
            currentPositions,
            selectedKeyType,
            keyIds,
            deltaX,
            deltaY,
          ),
        );
    }

    const statIds = selectedNativeIds('stat');
    if (statIds.size > 0) {
      const current = useStatItemStore.getState().positions;
      useStatItemStore
        .getState()
        .setPositions(
          moveSelectedNativePositions(
            current,
            selectedKeyType,
            statIds,
            deltaX,
            deltaY,
          ),
        );
    }

    const graphIds = selectedNativeIds('graph');
    if (graphIds.size > 0) {
      const current = useGraphItemStore.getState().positions;
      useGraphItemStore
        .getState()
        .setPositions(
          moveSelectedNativePositions(
            current,
            selectedKeyType,
            graphIds,
            deltaX,
            deltaY,
          ),
        );
    }

    const knobIds = selectedNativeIds('knob');
    if (knobIds.size > 0) {
      const current = useKnobItemStore.getState().positions;
      useKnobItemStore
        .getState()
        .setPositions(
          moveSelectedNativePositions(
            current,
            selectedKeyType,
            knobIds,
            deltaX,
            deltaY,
          ),
        );
    }

    const spriteIds = selectedNativeIds('sprite');
    if (spriteIds.size > 0) {
      const current = useSpriteStore.getState().positions;
      useSpriteStore
        .getState()
        .setPositions(
          moveSelectedNativePositions(
            current,
            selectedKeyType,
            spriteIds,
            deltaX,
            deltaY,
          ),
        );
    }

    // 플러그인 요소 배치 업데이트
    const pluginUpdateIds = new Set(
      selectedElements
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
    let stagedBeforeEagerWrite = false;
    if (pluginUpdateIds.size > 0) {
      if (gestureId) {
        const movedPluginIds = selectedPluginIds(
          currentPluginElements,
          pluginUpdateIds,
        );
        // 화살표 이동은 pointer 시작 경계가 없으므로 여기서 staging을 eager
        // 쓰기 앞에 세운다. 드래그는 Grid의 시작 경계가 이미 같은 id로 stage함
        if (syncToOverlay && movedPluginIds.length > 0) {
          beginMixedGestureTransaction(gestureId, movedPluginIds);
          stagedBeforeEagerWrite = true;
        }
        movedPluginIds.forEach((pluginId) => {
          rotatePluginInstancesEditSession(pluginId, gestureId);
        });
      }
      const newElements = moveSelectedPluginElements(
        currentPluginElements,
        pluginUpdateIds,
        deltaX,
        deltaY,
      );
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

    const keyState = useKeyStore.getState();
    const layerGroupState = useLayerGroupStore.getState();
    const selectionState = useGridSelectionStore.getState();
    const snapshot = createSelectionClipboardSnapshot({
      selectedElements,
      keyMappings: keyState.keyMappings[selectedKeyType] || [],
      keyPositions: keyState.canonicalPositions[selectedKeyType] || [],
      statPositions:
        useStatItemStore.getState().positions[selectedKeyType] || [],
      graphPositions:
        useGraphItemStore.getState().positions[selectedKeyType] || [],
      knobPositions:
        useKnobItemStore.getState().positions[selectedKeyType] || [],
      spritePositions:
        useSpriteStore.getState().positions[selectedKeyType] || [],
      pluginElements: usePluginDisplayElementStore.getState().elements,
      selectedGroupIds: selectionState.selectedGroupIds,
      layerGroups: layerGroupState.getGroupsForMode(selectedKeyType),
      collapsedGroupIds: layerGroupState.collapsedGroups,
    });
    if (snapshot.items.length > 0) {
      // 복사 원본 탭 - 다른 탭에 붙일 때 스프라이트 트리거 재결합 판정에 쓴다
      setClipboard(snapshot.items, snapshot.groups, selectedKeyType);
    }
  };

  const pasteElements = () =>
    pasteSelection({ selectedKeyType, setSelectedElements });

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
