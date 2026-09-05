import { newElementId } from '@src/renderer/editor/model/elementId';
import {
  applySealedSliceMutation,
  combineReceipts,
  reportElementOpSkipped,
  type ElementIntentReceipt,
} from '@src/renderer/editor/runtime/intent/elementIntent';
import {
  applyPluginAdditionEagerly,
  runMixedGestureElementIntent,
} from '@src/renderer/editor/runtime/intent/mixedElementIntent';
import type {
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { reissueDisplayElementHandlers } from '@plugins/runtime/displayElement/displayElementApi';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  useGridSelectionStore,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { cloneSlot } from '@utils/keySlot';
import {
  buildLayerItemsForMode,
  buildNextLayerGroupName,
} from '@utils/layerGroupUtils';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { createFrozenPasteModel } from '@utils/grid/selectionPasteModel';
import { PASTE_OFFSET } from '../constants';

interface PasteSelectionOptions {
  selectedKeyType: string;
  setSelectedElements: (elements: SelectedElement[]) => void;
}

// 클립보드에서 붙여넣기: 계획(신규 id·payload·그룹·plugin fullId·앵커)을
// 호출 시점에 동결하고, eager는 결합 봉인 receipt, wire는 슬롯 base와
// 봉인 plugin projection의 결합 순서에서 재생성한다. 초기 plugin이 없어도
// 항상 mixed-capable primitive를 탄다 - 슬롯 대기 중 추가된 plugin이
// z 재부여에서 빠지는 TOCTOU를 막는다
export const pasteSelection = async ({
  selectedKeyType,
  setSelectedElements,
}: PasteSelectionOptions) => {
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
    const index = callOrderItems.findIndex((item) => item.groupId === groupId);
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

  const { pluginScope, computePaste, buildFrozenInsertOp } =
    createFrozenPasteModel({
      selectedKeyType,
      keysToAdd,
      statsToAdd,
      graphsToAdd,
      knobsToAdd,
      frozenPluginElements,
      pluginIdsToAdd,
      frozenNewGroups,
      frozenInstanceCaps,
      frozenAnchor,
    });

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
      pluginReceipt = applyPluginAdditionEagerly(addedFullIds, zChanges, () => {
        usePluginDisplayElementStore
          .getState()
          .setElements(eagerPlan.desiredProjection, { skipSync: true });
      });
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
        ...(useGraphItemStore.getState().positions[selectedKeyType] ?? []).map(
          (position) => position.id,
        ),
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
        (useLayerGroupStore.getState().layerGroups[selectedKeyType] ?? []).map(
          (group) => group.id,
        ),
      );
      const keptGroupIds = selection.selectedGroupIds.filter(
        (groupId) => !newGroupIds.has(groupId) || presentGroupIds.has(groupId),
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
