import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

import { resolveElementById } from '../model/elementIdMap';
import { isNativeElementId } from '../model/elementId';
import { currentPluginGroupMembers } from './pluginGroupMembers';
import {
  cloneKeyPositionForDuplicate,
  createDefaultKeyPosition,
} from '../model/keys';
import { newElementId } from '../model/elementId';
import { cloneSlot } from '@utils/keySlot';
import { stableStringify } from '@utils/core/stableStringify';
import {
  normalizeLayerGroupsForMode,
  projectLayerGroupRename,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import {
  applyPropertyIntentsEagerly,
  createPropertyReceipt,
  type ElementIntentReceipt,
  type PropertyIntents,
} from './elementIntent';
import {
  commitGeneratedSemanticOps,
  commitSemanticOps,
} from './editorSemanticOps';
import {
  captureEditorDocument,
  editorCoordinator,
} from './editorStateCoordinator';
import {
  computeBatchGeometryPlan,
  type BatchGeometryOperation,
} from './batchGeometryPlan';

import type {
  CanonicalEditorDocumentV1,
  EditorBoundsV1,
  EditorFrozenElementV1,
  EditorElementPropertyPatchV1,
  EditorCounterBooleanPropertyPatchV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorFontColorPropertyPatchV1,
  EditorCounterAnimationPresetIntentV1,
  EditorFontFamilyPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
  EditorElementGroupTargetV1,
  EditorTargetLayerGroupV1,
  EditorOpV1,
} from '@src/types/editor';
import {
  isEditorPaintPropertyPatchV1,
  isEditorShadowPropertyPatchV1,
} from '@src/types/editor';

import type { NativeElementType } from '../model/elementIdMap';
import type { KeyPosition, KeySlot } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  isNotePaintPropertyPatchV1,
  projectNotePaintPatch,
} from '@src/types/key/notePaint';
import {
  isCounterFillPropertyPatchV1,
  projectCounterFillPatch,
} from '@src/types/key/counterFill';
import {
  isFontColorPropertyPatchV1,
  projectFontColorPatch,
} from '@src/types/key/fontColor';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';

// 메뉴·확인 모달처럼 대상 확정과 실행 사이가 긴 파괴적 액션의 semantic op.
// 대상은 {type, id}로 받고, eager 반영과 wire 생성 각각이 실행 시점의
// 문서에서 id를 다시 찾아 적용한다. 못 찾으면(삭제·모드 소실) 조용히
// 중단한다 - index를 들고 있다가 다른 요소를 지우는 창을 없애는 것이 목적

type LooseRecord = Record<
  string,
  Array<{ id: string } & Record<string, unknown>>
>;

const findInRecord = (
  record: LooseRecord,
  id: string,
): { mode: string; index: number } | null => {
  for (const [mode, list] of Object.entries(record)) {
    const index = list.findIndex((position) => position.id === id);
    if (index >= 0) return { mode, index };
  }
  return null;
};

const removeAt = (
  record: LooseRecord,
  mode: string,
  index: number,
): LooseRecord => ({
  ...record,
  [mode]: (record[mode] ?? []).filter((_, i) => i !== index),
});

// 삭제: 키는 keys와 keyPositions의 인덱스 결합을 함께 제거, 아이템은 해당
// 컬렉션만. 반환 false = 실행 시점에 대상 없음(이미 삭제).
// 오류는 전파된다 - 편입 전 실패는 receipt가 로컬 삭제를 되돌린다.
// 선택 보정은 정책상 eager와 함께 즉시 수행하고 실패해도 복구하지 않는다
export const deleteElementById = (
  type: NativeElementType,
  id: string,
): Promise<boolean> => {
  if (!isNativeElementId(id)) return Promise.resolve(false);

  const applyEager = (): ElementIntentReceipt | null => {
    const locator = resolveElementById(type, id);
    if (!locator) return null;
    const layerGroupsBefore = useLayerGroupStore.getState().layerGroups;
    let removedGroups: Array<{ id: string; name: string; index: number }> = [];

    let removedSlot: unknown;
    let removedPosition: Record<string, unknown> | undefined;
    if (type === 'key') {
      const state = useKeyStore.getState();
      removedSlot = state.keyMappings[locator.mode]?.[locator.index];
      removedPosition = (state.canonicalPositions as unknown as LooseRecord)[
        locator.mode
      ]?.[locator.index];
      const nextMappings = {
        ...state.keyMappings,
        [locator.mode]: (state.keyMappings[locator.mode] ?? []).filter(
          (_, i) => i !== locator.index,
        ),
      };
      const nextPositions = removeAt(
        state.canonicalPositions as unknown as LooseRecord,
        locator.mode,
        locator.index,
      );
      state.setKeyMappingsAndPositions(nextMappings, nextPositions as never);
    } else {
      const state =
        type === 'stat'
          ? useStatItemStore.getState()
          : type === 'graph'
          ? useGraphItemStore.getState()
          : useKnobItemStore.getState();
      removedPosition = (state.positions as unknown as LooseRecord)[
        locator.mode
      ]?.[locator.index];
      state.setPositions(
        removeAt(
          state.positions as unknown as LooseRecord,
          locator.mode,
          locator.index,
        ) as never,
      );
    }
    // 선택 보정은 현재 모드 배열 기준 - 다른 모드로 이동한 대상의 index로
    // 현재 모드의 무관한 선택을 지우면 안 된다
    if (locator.mode === useKeyStore.getState().selectedKeyType) {
      useGridSelectionStore.getState().deselectElement(id);
    }

    const keyState = useKeyStore.getState();
    const normalized = normalizeLayerGroupsForMode({
      mode: locator.mode,
      keyPositions: keyState.canonicalPositions,
      statPositions: useStatItemStore.getState().positions,
      graphPositions: useGraphItemStore.getState().positions,
      knobPositions: useKnobItemStore.getState().positions,
      layerGroups: useLayerGroupStore.getState().layerGroups,
      pluginElements: currentPluginGroupMembers(),
    });
    if (normalized.positionsChanged) {
      keyState.setKeyMappingsAndPositions(
        keyState.keyMappings,
        normalized.keyPositions,
      );
      useStatItemStore.getState().setPositions(normalized.statPositions);
      useGraphItemStore.getState().setPositions(normalized.graphPositions);
      useKnobItemStore.getState().setPositions(normalized.knobPositions);
    }
    if (normalized.groupsChanged) {
      const remaining = new Set(
        (normalized.layerGroups[locator.mode] ?? []).map((group) => group.id),
      );
      removedGroups = (layerGroupsBefore[locator.mode] ?? [])
        .map((group, index) => ({ ...group, index }))
        .filter((group) => !remaining.has(group.id));
      useLayerGroupStore.getState().setLayerGroups(normalized.layerGroups);
    }

    return {
      rollback: () => {
        const canonical = editorCoordinator.getState().lastAck;
        const canonicalRecord = canonical?.[
          type === 'key'
            ? 'keyPositions'
            : type === 'stat'
            ? 'statPositions'
            : type === 'graph'
            ? 'graphPositions'
            : 'knobPositions'
        ] as LooseRecord | undefined;
        if (canonicalRecord && !findInRecord(canonicalRecord, id)) return;
        const currentRecord =
          type === 'key'
            ? (useKeyStore.getState()
                .canonicalPositions as unknown as LooseRecord)
            : type === 'stat'
            ? (useStatItemStore.getState().positions as unknown as LooseRecord)
            : type === 'graph'
            ? (useGraphItemStore.getState().positions as unknown as LooseRecord)
            : (useKnobItemStore.getState().positions as unknown as LooseRecord);
        // 다른 경로가 같은 ID를 이미 복원·갱신했으면 그룹까지 그 경로 소유
        if (findInRecord(currentRecord, id)) return;
        if (removedGroups.length > 0) {
          const layerGroupState = useLayerGroupStore.getState();
          const currentMode = [
            ...(layerGroupState.layerGroups[locator.mode] ?? []),
          ];
          let restored = false;
          for (const group of removedGroups) {
            if (currentMode.some((candidate) => candidate.id === group.id))
              continue;
            currentMode.splice(Math.min(group.index, currentMode.length), 0, {
              id: group.id,
              name: group.name,
            });
            restored = true;
          }
          if (restored) {
            layerGroupState.setLayerGroups({
              ...layerGroupState.layerGroups,
              [locator.mode]: currentMode,
            });
          }
        }
        if (!removedPosition) return;
        // membership CAS: id가 이미 돌아와 있으면(다른 경로 복원) 중복 금지
        if (type === 'key') {
          const state = useKeyStore.getState();
          const record = state.canonicalPositions as unknown as LooseRecord;
          if (findInRecord(record, id)) return;
          const list = record[locator.mode] ?? [];
          const at = Math.min(locator.index, list.length);
          const mappings = state.keyMappings[locator.mode] ?? [];
          state.setKeyMappingsAndPositions(
            {
              ...state.keyMappings,
              [locator.mode]: [
                ...mappings.slice(0, at),
                removedSlot as never,
                ...mappings.slice(at),
              ],
            },
            {
              ...record,
              [locator.mode]: [
                ...list.slice(0, at),
                removedPosition,
                ...list.slice(at),
              ],
            } as never,
          );
          return;
        }
        const state =
          type === 'stat'
            ? useStatItemStore.getState()
            : type === 'graph'
            ? useGraphItemStore.getState()
            : useKnobItemStore.getState();
        const record = state.positions as unknown as LooseRecord;
        if (findInRecord(record, id)) return;
        const list = record[locator.mode] ?? [];
        const at = Math.min(locator.index, list.length);
        state.setPositions({
          ...record,
          [locator.mode]: [
            ...list.slice(0, at),
            removedPosition,
            ...list.slice(at),
          ],
        } as never);
      },
    };
  };

  const receipt = applyEager();
  let enrolled = false;
  return commitSemanticOps([{ kind: 'deleteElement', elementType: type, id }], {
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(() => true)
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

// 복제 배치: 시작 시점에 동결한 payload(slot + position)를 현재 모드에 새
// 요소로 추가한다. sourceIndex 재조회 금지 - 고스트를 따라다니는 동안의
// 재정렬이 다른 키를 복제하게 만든다
export interface FrozenKeyDuplicate {
  slot: unknown;
  position: KeyPosition;
}

const documentHasElementId = (
  document: CanonicalEditorDocumentV1,
  id: string,
) =>
  [
    document.keyPositions,
    document.statPositions,
    document.graphPositions,
    document.knobPositions,
  ].some((record) => findInRecord(record as unknown as LooseRecord, id));

const documentHasExactFrozenElement = (
  document: CanonicalEditorDocumentV1,
  mode: string,
  element: EditorFrozenElementV1,
) => {
  const field =
    element.elementType === 'key'
      ? 'keyPositions'
      : element.elementType === 'stat'
      ? 'statPositions'
      : element.elementType === 'graph'
      ? 'graphPositions'
      : 'knobPositions';
  const index = document[field][mode]?.findIndex(
    (position) => position.id === element.position.id,
  );
  if (index == null || index < 0) return false;
  if (
    stableStringify(document[field][mode][index]) !==
    stableStringify(element.position)
  ) {
    return false;
  }
  return (
    element.elementType !== 'key' ||
    stableStringify(document.keys[mode]?.[index]) ===
      stableStringify(element.slot)
  );
};

const insertFrozenElement = (
  mode: string,
  source: EditorFrozenElementV1,
): Promise<boolean> => {
  const element = structuredClone(source);
  const id = element.position.id;
  if (!mode || typeof id !== 'string' || !id || !isNativeElementId(id)) {
    return Promise.resolve(false);
  }
  if (documentHasElementId(captureEditorDocument(), id)) {
    return Promise.resolve(false);
  }

  const applyEager = (): ElementIntentReceipt => {
    if (element.elementType === 'key') {
      const state = useKeyStore.getState();
      state.setKeyMappingsAndPositions(
        {
          ...state.keyMappings,
          [mode]: [...(state.keyMappings[mode] ?? []), cloneSlot(element.slot)],
        },
        {
          ...state.canonicalPositions,
          [mode]: [
            ...(state.canonicalPositions[mode] ?? []),
            structuredClone(element.position),
          ],
        },
      );
    } else {
      const state =
        element.elementType === 'stat'
          ? useStatItemStore.getState()
          : element.elementType === 'graph'
          ? useGraphItemStore.getState()
          : useKnobItemStore.getState();
      const positions = state.positions as unknown as LooseRecord;
      state.setPositions({
        ...positions,
        [mode]: [...(positions[mode] ?? []), structuredClone(element.position)],
      } as never);
    }

    return {
      rollback: () => {
        const canonical = editorCoordinator.getState().lastAck;
        if (canonical && documentHasElementId(canonical, id)) {
          return;
        }
        if (
          !documentHasExactFrozenElement(captureEditorDocument(), mode, element)
        ) {
          return;
        }
        if (element.elementType === 'key') {
          const state = useKeyStore.getState();
          const positions = state.canonicalPositions as unknown as LooseRecord;
          const located = findInRecord(positions, id);
          if (!located) return;
          state.setKeyMappingsAndPositions(
            {
              ...state.keyMappings,
              [located.mode]: (state.keyMappings[located.mode] ?? []).filter(
                (_, index) => index !== located.index,
              ),
            },
            removeAt(positions, located.mode, located.index) as never,
          );
          return;
        }
        const state =
          element.elementType === 'stat'
            ? useStatItemStore.getState()
            : element.elementType === 'graph'
            ? useGraphItemStore.getState()
            : useKnobItemStore.getState();
        const positions = state.positions as unknown as LooseRecord;
        const located = findInRecord(positions, id);
        if (!located) return;
        state.setPositions(
          removeAt(positions, located.mode, located.index) as never,
        );
      },
    };
  };

  const receipt = applyEager();
  let enrolled = false;
  return commitSemanticOps(
    [
      {
        kind: 'insertFrozenElements',
        mode,
        elements: [element],
        groups: [],
        zUpdates: [],
      },
    ],
    {
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then(() => true)
    .catch((error) => {
      if (!enrolled) receipt.rollback();
      throw error;
    });
};

export const addKeyAt = (mode: string, dx: number, dy: number) =>
  insertFrozenElement(mode, {
    elementType: 'key',
    slot: '',
    position: createDefaultKeyPosition(dx, dy),
  });

export const addStatAt = (
  mode: string,
  position: StatItemPosition & { id: string },
) => insertFrozenElement(mode, { elementType: 'stat', position });

export const addGraphAt = (
  mode: string,
  position: GraphItemPosition & { id: string },
) => insertFrozenElement(mode, { elementType: 'graph', position });

export const addKnobAt = (
  mode: string,
  position: KnobItemPosition & { id: string },
) => insertFrozenElement(mode, { elementType: 'knob', position });

const groupForMode = (mode: string, groupId: string | undefined) =>
  groupId &&
  (useLayerGroupStore.getState().layerGroups[mode] ?? []).some(
    (group) => group.id === groupId,
  )
    ? groupId
    : undefined;

export const placeDuplicatedKey = (
  frozen: FrozenKeyDuplicate,
  mode: string,
  dx: number,
  dy: number,
): Promise<boolean> => {
  // 구 duplicateKey와 같은 정규화: 새 신원, 좌표 반올림, 참조 분리, 기본값 백필
  const newPosition = cloneKeyPositionForDuplicate(frozen.position, dx, dy);
  newPosition.groupId = groupForMode(mode, newPosition.groupId);
  const frozenSlot = cloneSlot(frozen.slot as never);
  return insertFrozenElement(mode, {
    elementType: 'key',
    slot: frozenSlot,
    position: newPosition,
  });
};

export const placeDuplicatedStat = (
  mode: string,
  source: StatItemPosition,
  dx: number,
  dy: number,
  zIndex: number,
) =>
  insertFrozenElement(mode, {
    elementType: 'stat',
    position: {
      ...structuredClone(source),
      id: newElementId(),
      groupId: groupForMode(mode, source.groupId),
      dx,
      dy,
      zIndex,
    },
  });

export const placeDuplicatedGraph = (
  mode: string,
  source: GraphItemPosition,
  dx: number,
  dy: number,
  zIndex: number,
) =>
  insertFrozenElement(mode, {
    elementType: 'graph',
    position: {
      ...structuredClone(source),
      id: newElementId(),
      groupId: groupForMode(mode, source.groupId),
      dx,
      dy,
      zIndex,
    },
  });

export const placeDuplicatedKnob = (
  mode: string,
  source: KnobItemPosition,
  dx: number,
  dy: number,
  zIndex: number,
) =>
  insertFrozenElement(mode, {
    elementType: 'knob',
    position: {
      ...structuredClone(source),
      id: newElementId(),
      groupId: groupForMode(mode, source.groupId),
      dx,
      dy,
      zIndex,
    },
  });

const FIELD_BY_TYPE: Record<
  NativeElementType,
  'keyPositions' | 'statPositions' | 'graphPositions' | 'knobPositions'
> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

// 키 슬롯 재바인딩: keys만 바꾸되 대상은 paired 위치의 안정 id로 재결합한다.
// index 기반 keys 단독 커밋은 same-shape 재정렬과 겹치면 다른 위치 id와
// 잘못 결합된다
export const rebindKeySlotById = (
  positionId: string,
  newSlot: KeySlot,
): Promise<boolean> => {
  if (!isNativeElementId(positionId)) return Promise.resolve(false);

  const applyEager = (): ElementIntentReceipt | null => {
    const locator = resolveElementById('key', positionId);
    if (!locator) return null;
    const state = useKeyStore.getState();
    const beforeSlot = state.keyMappings[locator.mode]?.[locator.index];
    state.setKeyMappings({
      ...state.keyMappings,
      [locator.mode]: (state.keyMappings[locator.mode] ?? []).map((slot, i) =>
        i === locator.index ? newSlot : slot,
      ),
    } as never);
    return {
      rollback: () => {
        // paired CAS: 위치 id의 현재 자리 슬롯이 우리가 쓴 값일 때만 복원
        const current = useKeyStore.getState();
        const located = findInRecord(
          current.canonicalPositions as unknown as LooseRecord,
          positionId,
        );
        if (!located) return;
        if (current.keyMappings[located.mode]?.[located.index] !== newSlot) {
          return;
        }
        current.setKeyMappings({
          ...current.keyMappings,
          [located.mode]: (current.keyMappings[located.mode] ?? []).map(
            (slot, i) => (i === located.index ? beforeSlot : slot),
          ),
        } as never);
      },
    };
  };

  const receipt = applyEager();
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'setKeySlot', id: positionId, slot: newSlot }],
    {
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

// 단건 property의 즉시 반영 투영. 도킹·분리, 단건·다건 네 경로가 같은 걸 쓴다
const elementPropertyIntents = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorElementPropertyPatchV1,
): PropertyIntents => {
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    // nullable leaf의 null은 위치 조각에서 undefined로, 나머지는 1:1 투영
    const byId = intents.get(elementType) ?? new Map();
    byId.set(id, { [patch.property]: patch.value ?? undefined });
    intents.set(elementType, byId);
  }
  return intents;
};

// 빈 목록·비 native id·중복 id는 커밋 대상이 아니다
const hasCommittableTargets = (targets: readonly { id: string }[]): boolean =>
  targets.length > 0 &&
  targets.every(({ id }) => isNativeElementId(id)) &&
  new Set(targets.map(({ id }) => id)).size === targets.length;

const applyElementPropertyEagerly = (
  type: NativeElementType,
  id: string,
  patch: EditorElementPropertyPatchV1,
): ElementIntentReceipt | null =>
  applyPropertyIntentsEagerly(
    elementPropertyIntents([{ elementType: type, id }], patch),
  );

export const patchElementPropertyById = (
  type: NativeElementType,
  id: string,
  patch: EditorElementPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (!isNativeElementId(id)) return Promise.resolve(false);
  const receipt = applyElementPropertyEagerly(type, id, patch);
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'patchElement', elementType: type, id, patch }],
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

interface ElementPropertyPatchTarget {
  type: NativeElementType;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

interface ElementPropertyTarget {
  elementType: NativeElementType;
  id: string;
}

interface PropertyCommitOptions {
  gestureId?: string;
  preflight?: () => void;
}

// 공용 다건 경로: 빈 목록·비 native id·중복 id를 거르고 같은 property patch를
// 전 대상에 eager+wire로 커밋한다. 속성별 기계적 래퍼는 전부 여기로 위임하고
// value 타입은 판별 유니온 patch가 컴파일 타임에 강제한다
const patchElementPropertyByTargets = (
  targets: readonly ElementPropertyTarget[],
  patch: EditorElementPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => {
  if (!hasCommittableTargets(targets)) return Promise.resolve(false);
  const receipt = applyPropertyIntentsEagerly(
    elementPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

const idTargets = (
  elementType: NativeElementType,
  ids: readonly string[],
): ElementPropertyTarget[] => ids.map((id) => ({ elementType, id }));

export const patchElementHiddenById = (
  type: NativeElementType,
  id: string,
  hidden: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'hidden', value: hidden },
    options,
  );

export const setLayerGroupHidden = (
  mode: string,
  groupId: string,
  hidden: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (!mode || !groupId) return Promise.resolve(false);
  const eagerIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  const initial = captureEditorDocument();
  const initialTargets: Array<{ type: NativeElementType; id: string }> = [];
  for (const type of Object.keys(FIELD_BY_TYPE) as NativeElementType[]) {
    for (const position of initial[FIELD_BY_TYPE[type]][mode] ?? []) {
      if (
        position.groupId !== groupId ||
        typeof position.id !== 'string' ||
        position.id.length === 0 ||
        !isNativeElementId(position.id)
      ) {
        continue;
      }
      const byId = eagerIntents.get(type) ?? new Map();
      byId.set(position.id, { hidden });
      eagerIntents.set(type, byId);
      initialTargets.push({ type, id: position.id });
    }
  }
  applyPropertyIntentsEagerly(eagerIntents);
  const reconcileEager = (
    base: CanonicalEditorDocumentV1,
    currentMemberIds?: ReadonlySet<string>,
  ) => {
    createPropertyReceipt(
      initialTargets.flatMap(({ type, id }) => {
        if (currentMemberIds?.has(id)) return [];
        const located = findInRecord(
          base[FIELD_BY_TYPE[type]] as unknown as LooseRecord,
          id,
        );
        if (!located) return [];
        return [
          {
            type,
            id,
            field: 'hidden',
            before:
              base[FIELD_BY_TYPE[type]][located.mode]?.[located.index]?.hidden,
            expected: hidden,
          },
        ];
      }),
    )?.rollback();
  };
  let reconciled = false;
  let enrolled = false;
  return commitGeneratedSemanticOps(
    (latest) => {
      const targets: ElementPropertyPatchTarget[] = [];
      let unsupported = false;
      for (const type of Object.keys(FIELD_BY_TYPE) as NativeElementType[]) {
        for (const position of latest[FIELD_BY_TYPE[type]][mode] ?? []) {
          if (position.groupId !== groupId) continue;
          if (
            typeof position.id !== 'string' ||
            position.id.length === 0 ||
            !isNativeElementId(position.id)
          ) {
            unsupported = true;
            continue;
          }
          targets.push({
            type,
            id: position.id,
            patch: { property: 'hidden', value: hidden },
          });
        }
      }
      if (unsupported || targets.length === 0) {
        if (!reconciled) {
          reconcileEager(latest);
          reconciled = true;
        }
        return null;
      }
      if (!reconciled) {
        reconcileEager(latest, new Set(targets.map(({ id }) => id)));
        reconciled = true;
      }
      return targets.map(({ type, id, patch }) => ({
        kind: 'patchElement' as const,
        elementType: type,
        id,
        patch,
      }));
    },
    {
      ...(options.preflight ? { preflight: options.preflight } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => {
      if (!outcome && !enrolled && !reconciled) {
        reconcileEager(editorCoordinator.getState().lastAck ?? initial);
      }
      return (
        outcome?.opResults.some(({ status }) => status !== 'targetMissing') ??
        false
      );
    })
    .catch((error) => {
      if (!enrolled && !reconciled) {
        reconcileEager(editorCoordinator.getState().lastAck ?? initial);
      }
      throw error;
    });
};

const validStructuralText = (value: string, maxBytes: number): boolean =>
  value.length > 0 && new TextEncoder().encode(value).length <= maxBytes;

const validElementGroupTargets = (
  targets: readonly EditorElementGroupTargetV1[],
): boolean =>
  targets.length > 0 &&
  targets.length <= 4096 &&
  targets.every(
    ({ elementType, id }) =>
      ['key', 'stat', 'graph', 'knob'].includes(elementType) &&
      isNativeElementId(id),
  ) &&
  new Set(targets.map(({ id }) => id)).size === targets.length;

const validTargetLayerGroup = (
  targetGroup: EditorTargetLayerGroupV1 | null,
): boolean =>
  targetGroup === null ||
  (validStructuralText(targetGroup.id, 256) &&
    (targetGroup.kind === 'existing' ||
      (targetGroup.kind === 'create' &&
        validStructuralText(targetGroup.name, 1024))));

export const setElementGroupsByTargets = (
  mode: string,
  targets: readonly EditorElementGroupTargetV1[],
  targetGroup: EditorTargetLayerGroupV1 | null,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !validStructuralText(mode, 128) ||
    !validElementGroupTargets(targets) ||
    !validTargetLayerGroup(targetGroup)
  ) {
    return Promise.resolve(false);
  }
  const before = {
    keyPositions: useKeyStore.getState().canonicalPositions,
    statPositions: useStatItemStore.getState().positions,
    graphPositions: useGraphItemStore.getState().positions,
    knobPositions: useKnobItemStore.getState().positions,
    layerGroups: useLayerGroupStore.getState().layerGroups,
  };
  const projected = projectStableElementGroups({
    mode,
    targets,
    targetGroup,
    ...before,
    pluginElements: currentPluginGroupMembers(),
  });
  if (!projected) return Promise.resolve(false);
  if (projected.changed) {
    useKeyStore.getState().setPositions(projected.keyPositions);
    useStatItemStore.getState().setPositions(projected.statPositions);
    useGraphItemStore.getState().setPositions(projected.graphPositions);
    useKnobItemStore.getState().setPositions(projected.knobPositions);
    useLayerGroupStore.getState().setLayerGroups(projected.layerGroups);
  }
  let enrolled = false;
  return commitSemanticOps(
    [
      {
        kind: 'setElementGroups',
        mode,
        targets: targets.map((target) => ({ ...target })),
        targetGroup: targetGroup ? { ...targetGroup } : null,
      },
    ],
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled && projected.changed) {
        if (
          useKeyStore.getState().canonicalPositions === projected.keyPositions
        ) {
          useKeyStore.getState().setPositions(before.keyPositions);
        }
        if (useStatItemStore.getState().positions === projected.statPositions) {
          useStatItemStore.getState().setPositions(before.statPositions);
        }
        if (
          useGraphItemStore.getState().positions === projected.graphPositions
        ) {
          useGraphItemStore.getState().setPositions(before.graphPositions);
        }
        if (useKnobItemStore.getState().positions === projected.knobPositions) {
          useKnobItemStore.getState().setPositions(before.knobPositions);
        }
        if (
          useLayerGroupStore.getState().layerGroups === projected.layerGroups
        ) {
          useLayerGroupStore.getState().setLayerGroups(before.layerGroups);
        }
      }
      throw error;
    });
};

export const renameLayerGroupById = (
  mode: string,
  groupId: string,
  name: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !validStructuralText(mode, 128) ||
    !validStructuralText(groupId, 256) ||
    !validStructuralText(name, 1024)
  ) {
    return Promise.resolve(false);
  }
  const before = useLayerGroupStore.getState().layerGroups;
  const projected = projectLayerGroupRename({
    mode,
    groupId,
    name,
    layerGroups: before,
  });
  if (!projected) return Promise.resolve(false);
  useLayerGroupStore.getState().setLayerGroups(projected);
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'renameLayerGroup', mode, groupId, name }],
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (
        !enrolled &&
        useLayerGroupStore.getState().layerGroups === projected
      ) {
        useLayerGroupStore.getState().setLayerGroups(before);
      }
      throw error;
    });
};

export const patchElementLayerNameById = (
  type: NativeElementType,
  id: string,
  layerName: string | null,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'layerName', value: layerName },
    options,
  );

export const patchGraphTypesByIds = (
  ids: readonly string[],
  graphType: 'line' | 'bar',
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('graph', ids),
    { property: 'graphType', value: graphType },
    options,
  );

export const patchGraphColorsByIds = (
  ids: readonly string[],
  graphColor: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('graph', ids),
    { property: 'graphColor', value: graphColor },
    options,
  );

export const patchGraphPropertiesByIds = (
  ids: readonly string[],
  patch: EditorGraphRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('graph', ids), patch, options);

export const patchKnobAxisIdById = (
  id: string,
  axisId: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'knob',
    id,
    { property: 'axisId', value: axisId },
    options,
  );

export const patchSoundPathById = (
  id: string,
  soundPath: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    { property: 'soundPath', value: soundPath },
    options,
  );

export const patchSoundEnabledById = (
  id: string,
  soundEnabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    { property: 'soundEnabled', value: soundEnabled },
    options,
  );

export const patchSoundEnabledByIds = (
  ids: readonly string[],
  soundEnabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('key', ids),
    { property: 'soundEnabled', value: soundEnabled },
    options,
  );

const validSoundVolume = (soundVolume: number): boolean =>
  Number.isFinite(soundVolume) && soundVolume >= 0 && soundVolume <= 200;

export const patchSoundVolumeById = (
  id: string,
  soundVolume: number,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  validSoundVolume(soundVolume)
    ? patchElementPropertyById(
        'key',
        id,
        { property: 'soundVolume', value: soundVolume },
        options,
      )
    : Promise.resolve(false);

export const patchSoundVolumeByIds = (
  ids: readonly string[],
  soundVolume: number,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  validSoundVolume(soundVolume)
    ? patchElementPropertyByTargets(
        idTargets('key', ids),
        { property: 'soundVolume', value: soundVolume },
        options,
      )
    : Promise.resolve(false);

export const patchSoundPathByIds = (
  ids: readonly string[],
  soundPath: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('key', ids),
    { property: 'soundPath', value: soundPath },
    options,
  );

type CounterAnimationTarget = {
  elementType: 'key' | 'stat';
  id: string;
};

const counterBooleanPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterBooleanPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterEnabled'
        ? { ...counter, enabled: patch.value }
        : counter.animation !== null &&
          typeof counter.animation === 'object' &&
          !Array.isArray(counter.animation)
        ? {
            ...counter,
            animation: {
              ...(counter.animation as Record<string, unknown>),
              enabled: patch.value,
            },
          }
        : null;
    if (!nextCounter) continue;
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

const patchCounterBooleanByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterBooleanPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterBooleanPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

const counterLayoutPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterLayoutPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterPlacement'
        ? { ...counter, placement: patch.value }
        : patch.property === 'counterAlign'
        ? { ...counter, align: patch.value }
        : patch.property === 'counterAlignMode'
        ? { ...counter, alignMode: patch.value }
        : { ...counter, gap: patch.value };
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

export const patchCounterLayoutByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterLayoutPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterLayoutPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchCounterLayoutById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterLayoutPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterLayoutByTargets([{ elementType, id }], patch, options);

const counterTypographyPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterTypographyPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterFontSize'
        ? { ...counter, fontSize: patch.value }
        : patch.property === 'counterFontWeight'
        ? { ...counter, fontWeight: patch.value }
        : patch.property === 'counterFontItalic'
        ? { ...counter, fontItalic: patch.value }
        : patch.property === 'counterFontUnderline'
        ? { ...counter, fontUnderline: patch.value }
        : patch.property === 'counterFontStrikethrough'
        ? { ...counter, fontStrikethrough: patch.value }
        : { ...counter, fontFamily: patch.value };
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

const isCounterTypographyPatch = (
  patch: EditorCounterTypographyPropertyPatchV1,
): boolean => {
  if (patch.property === 'counterFontSize') {
    return (
      Number.isSafeInteger(patch.value) && patch.value >= 8 && patch.value <= 72
    );
  }
  if (patch.property === 'counterFontWeight') {
    return (
      Number.isSafeInteger(patch.value) &&
      patch.value >= 100 &&
      patch.value <= 900
    );
  }
  if (patch.property === 'counterFontItalic') {
    return typeof patch.value === 'boolean';
  }
  if (patch.property === 'counterFontUnderline') {
    return typeof patch.value === 'boolean';
  }
  if (patch.property === 'counterFontStrikethrough') {
    return typeof patch.value === 'boolean';
  }
  return (
    patch.property === 'counterFontFamily' && typeof patch.value === 'string'
  );
};

export const patchCounterTypographyByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterTypographyPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !isCounterTypographyPatch(patch) ||
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterTypographyPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchCounterTypographyById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterTypographyPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterTypographyByTargets([{ elementType, id }], patch, options);

export const patchCounterEnabledByTargets = (
  targets: readonly CounterAnimationTarget[],
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterBooleanByTargets(
    targets,
    { property: 'counterEnabled', value: enabled },
    options,
  );

export const patchCounterEnabledById = (
  elementType: 'key' | 'stat',
  id: string,
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterEnabledByTargets([{ elementType, id }], enabled, options);

export const patchCounterAnimationEnabledByTargets = (
  targets: readonly CounterAnimationTarget[],
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterBooleanByTargets(
    targets,
    { property: 'counterAnimationEnabled', value: enabled },
    options,
  );

export const patchCounterAnimationEnabledById = (
  elementType: 'key' | 'stat',
  id: string,
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterAnimationEnabledByTargets(
    [{ elementType, id }],
    enabled,
    options,
  );

const counterAnimationPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  intent: EditorCounterAnimationPresetIntentV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (!current) continue;
    if (
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    if (
      counter.animation === null ||
      typeof counter.animation !== 'object' ||
      Array.isArray(counter.animation)
    ) {
      continue;
    }
    const animation = counter.animation as Record<string, unknown>;
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, {
      counter: {
        ...counter,
        animation: {
          ...animation,
          ...('applyPresetId' in intent ? { presetId: intent.presetId } : {}),
          ...('bezier' in intent ? { bezier: [...intent.bezier] } : {}),
          ...('scale' in intent ? { scale: intent.scale } : {}),
          ...('durationMs' in intent ? { durationMs: intent.durationMs } : {}),
        },
      },
    });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

export const patchCounterAnimationPresetByTargets = (
  targets: readonly CounterAnimationTarget[],
  intent: EditorCounterAnimationPresetIntentV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterAnimationPropertyIntents(targets, intent),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: {
        property: 'counterAnimationPreset',
        value: structuredClone(intent),
      },
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchCounterAnimationPresetById = (
  elementType: 'key' | 'stat',
  id: string,
  intent: EditorCounterAnimationPresetIntentV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterAnimationPresetByTargets([{ elementType, id }], intent, options);

export const patchInactiveImageById = (
  type: NativeElementType,
  id: string,
  inactiveImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'inactiveImage', value: inactiveImage },
    options,
  );

export const patchInactiveImageByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  inactiveImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'inactiveImage', value: inactiveImage },
    options,
  );

export const patchActiveImageById = (
  type: 'key' | 'knob',
  id: string,
  activeImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeImage', value: activeImage },
    options,
  );

export const patchActiveImageByTargets = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'activeImage', value: activeImage },
    options,
  );

export const patchIdleTransparentById = (
  type: NativeElementType,
  id: string,
  idleTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'idleTransparent', value: idleTransparent },
    options,
  );

export const patchIdleTransparentByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  idleTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'idleTransparent', value: idleTransparent },
    options,
  );

export const patchActiveTransparentById = (
  type: 'key' | 'knob',
  id: string,
  activeTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeTransparent', value: activeTransparent },
    options,
  );

export const patchActiveTransparentByTargets = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'activeTransparent', value: activeTransparent },
    options,
  );

type ImageFit = 'cover' | 'contain' | 'fill' | 'none';

export const patchIdleImageFitById = (
  type: NativeElementType,
  id: string,
  idleImageFit: ImageFit,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'idleImageFit', value: idleImageFit },
    options,
  );

export const patchActiveImageFitById = (
  type: 'key' | 'knob',
  id: string,
  activeImageFit: ImageFit,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeImageFit', value: activeImageFit },
    options,
  );

export const patchKnobPropertiesByIds = (
  ids: readonly string[],
  patch: EditorKnobRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('knob', ids), patch, options);

export const patchUseInlineStylesByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  useInlineStyles: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'useInlineStyles', value: useInlineStyles },
    options,
  );

export const patchFontStyleByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontStylePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => patchElementPropertyByTargets(targets, patch, options);

export const patchFontFamilyByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontFamilyPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => patchElementPropertyByTargets(targets, patch, options);

type PaintTarget = { elementType: NativeElementType; id: string };

const paintPropertyIntents = (
  targets: readonly PaintTarget[],
  patch: EditorPaintPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const fieldName = patch.property;
  const descriptor = patch.value;
  const {
    active,
    colorField,
    gradientField,
    activeColorField,
    activeGradientField,
  } = paintPropertyFields(fieldName);
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const collection =
      elementType === 'key'
        ? document.keyPositions
        : elementType === 'stat'
        ? document.statPositions
        : elementType === 'graph'
        ? document.graphPositions
        : document.knobPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as
      | (Record<string, unknown> & { id: string })
      | undefined;
    if (!current) continue;
    const next: Record<string, unknown> = {
      [colorField]: descriptor.color,
      [gradientField]: descriptor.gradient ?? undefined,
    };
    if (!active && (elementType === 'key' || elementType === 'knob')) {
      const inherited = inheritedPaintMaterialization(
        {
          color:
            typeof current[colorField] === 'string'
              ? (current[colorField] as string)
              : undefined,
          gradient: current[gradientField] as never,
        },
        {
          color:
            typeof current[activeColorField] === 'string'
              ? (current[activeColorField] as string)
              : undefined,
          gradient: current[activeGradientField] as never,
        },
      );
      if (inherited) {
        next[activeColorField] = inherited.color;
        if (inherited.gradient) {
          next[activeGradientField] = inherited.gradient;
        }
      }
    }
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, next);
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchPaintByTargets = (
  targets: readonly PaintTarget[],
  patch: EditorPaintPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  const active =
    patch.property === 'activeBackgroundPaint' ||
    patch.property === 'activeBorderPaint';
  if (
    !isEditorPaintPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        id.length === 0 ||
        !isNativeElementId(id) ||
        (active && elementType !== 'key' && elementType !== 'knob'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    paintPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchPaintById = (
  elementType: NativeElementType,
  id: string,
  patch: EditorPaintPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchPaintByTargets([{ elementType, id }], patch, options);

type CounterFillTarget = { elementType: 'key' | 'stat'; id: string };

const counterFillPropertyIntents = (
  targets: readonly CounterFillTarget[],
  patch: EditorCounterFillPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const collection =
      elementType === 'key' ? document.keyPositions : document.statPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as KeyPosition | undefined;
    if (!current) continue;
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, projectCounterFillPatch(current, patch));
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchCounterFillByTargets = (
  targets: readonly CounterFillTarget[],
  patch: EditorCounterFillPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  const active = patch.property === 'counterFillActive';
  if (
    !isCounterFillPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        !id ||
        !isNativeElementId(id) ||
        (elementType !== 'key' && elementType !== 'stat') ||
        (active && elementType !== 'key'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterFillPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchCounterFillById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterFillPropertyPatchV1,
  options: { preflight?: () => void } = {},
) => patchCounterFillByTargets([{ elementType, id }], patch, options);

type FontColorTarget = { elementType: NativeElementType; id: string };

const fontColorPropertyIntents = (
  targets: readonly FontColorTarget[],
  patch: EditorFontColorPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const collection =
      elementType === 'key'
        ? document.keyPositions
        : elementType === 'stat'
        ? document.statPositions
        : elementType === 'graph'
        ? document.graphPositions
        : document.knobPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as KeyPosition | undefined;
    if (!current) continue;
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, projectFontColorPatch(current, elementType, patch));
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchFontColorByTargets = (
  targets: readonly FontColorTarget[],
  patch: EditorFontColorPropertyPatchV1,
  options: { preflight?: () => void; gestureId?: string } = {},
): Promise<boolean> => {
  const active = patch.property === 'activeFontColor';
  if (
    !isFontColorPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        !id ||
        !isNativeElementId(id) ||
        (active && elementType !== 'key' && elementType !== 'knob'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    fontColorPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      gestureId: options.gestureId,
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchFontColorById = (
  elementType: NativeElementType,
  id: string,
  patch: EditorFontColorPropertyPatchV1,
  options: { preflight?: () => void; gestureId?: string } = {},
) => patchFontColorByTargets([{ elementType, id }], patch, options);

type ShadowTarget = {
  elementType: NativeElementType;
  id: string;
};

const shadowPropertyIntents = (
  targets: readonly ShadowTarget[],
  patch: EditorShadowPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    if (elementType === 'graph') continue;
    const collection =
      elementType === 'key'
        ? document.keyPositions
        : elementType === 'stat'
        ? document.statPositions
        : document.knobPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as
      | (Record<string, unknown> & { id: string })
      | undefined;
    if (!current) continue;
    const next = projectElementShadowPatch({
      position: current as never,
      elementType,
      patch,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    });
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, next);
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchShadowByTargets = (
  targets: readonly ShadowTarget[],
  patch: EditorShadowPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !isEditorShadowPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        id.length === 0 ||
        !isNativeElementId(id) ||
        elementType === 'graph' ||
        (patch.property === 'activeShadow' && elementType === 'stat'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    shadowPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchShadowById = (
  elementType: 'key' | 'stat' | 'knob',
  id: string,
  patch: EditorShadowPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchShadowByTargets([{ elementType, id }], patch, options);

const notePaintPropertyIntents = (
  ids: readonly string[],
  patch: EditorNotePaintPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const byId = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const current = Object.values(document.keyPositions)
      .flat()
      .find((position) => position.id === id);
    if (!current) continue;
    // position 전달 - {opacity} 단독의 sibling shadow 재계산이 백엔드와 일치 (§9-5)
    byId.set(
      id,
      projectNotePaintPatch(patch, current as unknown as KeyPosition) as Record<
        string,
        unknown
      >,
    );
  }
  return new Map([['key', byId]]);
};

export const patchNotePaintByIds = (
  ids: readonly string[],
  patch: EditorNotePaintPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !isNotePaintPropertyPatchV1(patch) ||
    ids.length === 0 ||
    ids.some((id) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    notePaintPropertyIntents(ids, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    ids.map((id) => ({
      kind: 'patchElement' as const,
      elementType: 'key' as const,
      id,
      patch: structuredClone(patch),
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchNotePaintById = (
  id: string,
  patch: EditorNotePaintPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => patchNotePaintByIds([id], patch, options);

// note* 계열 수치 한계 검증, 대상에 key 외 타입이 있으면 즉시 무효
const invalidNoteStylePatch = (
  patch: EditorPreviewStylePropertyPatchV1,
  hasNonKeyTarget: boolean,
): boolean =>
  (patch.property === 'noteGlowSize' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 0 ||
      patch.value > 50)) ||
  (patch.property === 'noteOffsetX' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) ||
          patch.value < -500 ||
          patch.value > 500)))) ||
  (patch.property === 'noteOffsetY' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) ||
          patch.value < -500 ||
          patch.value > 500)))) ||
  (patch.property === 'noteWidth' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) || patch.value <= 0)))) ||
  (patch.property === 'noteBorderWidth' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 0 ||
      patch.value > 20)) ||
  (patch.property === 'noteBorderRadius' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 1 ||
      patch.value > 100));

export const patchStylePropertyById = (
  type: NativeElementType,
  id: string,
  patch: EditorPreviewStylePropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  invalidNoteStylePatch(patch, type !== 'key')
    ? Promise.resolve(false)
    : patchElementPropertyById(type, id, patch, options);

export const patchStylePropertyByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorPreviewStylePropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  invalidNoteStylePatch(
    patch,
    targets.some((target) => target.elementType !== 'key'),
  )
    ? Promise.resolve(false)
    : patchElementPropertyByTargets(targets, patch, options);

export const patchNotePropertiesByIds = (
  ids: readonly string[],
  patch: EditorNotePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('key', ids), patch, options);

// 다중 선택 정산: 대상 id들의 현재 canonical 기하(dx·dy)를 의도로 캡처해
// 슬롯 안에서 id 재해석으로 적용한다. 4컬렉션 full-record 캡처는 배타
// mutation(카운터 프리셋 삭제 등)의 IPC 창과 겹치면 직렬화 때문에 그 직후에
// 확정적으로 착지해 무관 필드 재작성을 되돌린다 - 기하만 실어 그 결합을 끊는다
export type GeometryField = 'dx' | 'dy' | 'width' | 'height';
type GeometryPatch = Partial<Record<GeometryField, number>>;

export interface BatchGeometryTarget {
  type: NativeElementType;
  id: string;
}

export interface BatchGeometryDescriptor {
  mode: string;
  targets: readonly BatchGeometryTarget[];
  operation: BatchGeometryOperation;
}

const readBatchGeometryElements = (
  base: CanonicalEditorDocumentV1,
  descriptor: BatchGeometryDescriptor,
) => {
  const seen = new Set<string>();
  const elements: Array<{
    key: string;
    type: NativeElementType;
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  for (const target of descriptor.targets) {
    if (!isNativeElementId(target.id) || seen.has(target.id)) return null;
    seen.add(target.id);
    const record = base[FIELD_BY_TYPE[target.type]] as unknown as LooseRecord;
    const locator = findInRecord(record, target.id);
    if (!locator || locator.mode !== descriptor.mode) return null;
    const position = record[locator.mode]?.[locator.index];
    if (
      !position ||
      typeof position.dx !== 'number' ||
      typeof position.dy !== 'number' ||
      typeof position.width !== 'number' ||
      typeof position.height !== 'number'
    ) {
      return null;
    }
    elements.push({
      key: target.id,
      type: target.type,
      id: target.id,
      x: position.dx,
      y: position.dy,
      width: position.width,
      height: position.height,
    });
  }
  return elements;
};

const planBatchGeometry = (
  base: CanonicalEditorDocumentV1,
  descriptor: BatchGeometryDescriptor,
) => {
  const elements = readBatchGeometryElements(base, descriptor);
  if (!elements) return null;
  const plan = computeBatchGeometryPlan(elements, descriptor.operation);
  if (!plan) return null;
  const targetById = new Map(
    elements.map((element) => [element.id, element] as const),
  );
  return {
    ...plan,
    ops: plan.bounds.flatMap(({ key, bounds }) => {
      const target = targetById.get(key);
      return target
        ? [
            {
              kind: 'setBounds' as const,
              elementType: target.type,
              id: target.id,
              bounds,
            },
          ]
        : [];
    }),
  };
};

export const commitBatchGeometryByIds = (
  descriptor: BatchGeometryDescriptor,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  const frozenDescriptor = structuredClone(descriptor);
  const initialPlan = planBatchGeometry(
    captureEditorDocument(),
    frozenDescriptor,
  );
  if (!initialPlan || initialPlan.updates.length === 0) {
    return Promise.resolve(false);
  }
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  const targetById = new Map(
    frozenDescriptor.targets.map((target) => [target.id, target] as const),
  );
  for (const { key, patch } of initialPlan.updates) {
    const target = targetById.get(key);
    if (!target) continue;
    const byId = intents.get(target.type) ?? new Map();
    byId.set(target.id, patch as Record<string, unknown>);
    intents.set(target.type, byId);
  }
  const receipt =
    intents.size > 0 ? applyPropertyIntentsEagerly(intents) : null;
  let enrolled = false;
  return commitGeneratedSemanticOps(
    (base) => planBatchGeometry(base, frozenDescriptor)?.ops ?? null,
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      ...(options.preflight ? { preflight: options.preflight } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => {
      if (!outcome) {
        if (!enrolled) receipt?.rollback();
        return false;
      }
      return outcome.opResults.every(
        ({ status }) => status !== 'targetMissing',
      );
    })
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const commitElementGeometryById = (
  type: NativeElementType,
  id: string,
  patch: GeometryPatch,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  const entries = Object.entries(patch) as Array<[GeometryField, number]>;
  if (
    !isNativeElementId(id) ||
    entries.length === 0 ||
    entries.some(
      ([field, value]) =>
        !['dx', 'dy', 'width', 'height'].includes(field) ||
        !Number.isFinite(value) ||
        ((field === 'width' || field === 'height') && value <= 0),
    )
  ) {
    return Promise.resolve(false);
  }

  const frozenPatch = Object.fromEntries(entries) as GeometryPatch;
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, frozenPatch as Record<string, unknown>]])],
  ]);
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;

  return commitGeneratedSemanticOps(
    (base) => {
      const record = base[FIELD_BY_TYPE[type]] as unknown as LooseRecord;
      const locator = findInRecord(record, id);
      if (!locator) return null;
      const position = record[locator.mode]?.[locator.index];
      if (!position) return null;
      const bounds: EditorBoundsV1 = {
        dx: position.dx as number,
        dy: position.dy as number,
        width: position.width as number,
        height: position.height as number,
        ...frozenPatch,
      };
      return [{ kind: 'setBounds', elementType: type, id, bounds }];
    },
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      ...(options.preflight ? { preflight: options.preflight } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => {
      if (!outcome) {
        if (!enrolled) receipt?.rollback();
        return false;
      }
      return outcome.opResults[0]?.status !== 'targetMissing';
    })
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

// 리사이즈 완료 전용: 시작 시 동결한 대상 id들에 최종 bounds를 하나의
// intent로 - eager와 wire, receipt를 같은 의도가 소유한다. 대상 소실은
// targetLost로 eager 복원, 오류는 전파
export const commitElementBoundsById = (
  intents: PropertyIntents,
  gestureId?: string,
): Promise<boolean> => {
  const ops: EditorOpV1[] = [];
  const boundsKeys = new Set(['dx', 'dy', 'width', 'height']);
  const seenIds = new Set<string>();
  for (const [elementType, byId] of intents) {
    for (const [id, patch] of byId) {
      if (
        !isNativeElementId(id) ||
        seenIds.has(id) ||
        Object.keys(patch).some((key) => !boundsKeys.has(key)) ||
        typeof patch.dx !== 'number' ||
        typeof patch.dy !== 'number' ||
        typeof patch.width !== 'number' ||
        typeof patch.height !== 'number' ||
        !Number.isFinite(patch.dx) ||
        !Number.isFinite(patch.dy) ||
        !Number.isFinite(patch.width) ||
        !Number.isFinite(patch.height) ||
        patch.width <= 0 ||
        patch.height <= 0
      ) {
        return Promise.resolve(false);
      }
      seenIds.add(id);
      ops.push({
        kind: 'setBounds',
        elementType,
        id,
        bounds: {
          dx: patch.dx,
          dy: patch.dy,
          width: patch.width,
          height: patch.height,
        },
      });
    }
  }
  if (ops.length === 0) return Promise.resolve(false);

  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;
  return commitSemanticOps(ops, {
    ...(gestureId ? { gestureId } : {}),
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(({ opResults }) =>
      opResults.some(({ status }) => status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const commitSingleElementBoundsById = (
  type: NativeElementType,
  id: string,
  bounds: EditorBoundsV1,
  gestureId?: string,
): Promise<boolean> => {
  if (
    !isNativeElementId(id) ||
    !Number.isFinite(bounds.dx) ||
    !Number.isFinite(bounds.dy) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return Promise.resolve(false);
  }
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, { ...bounds }]])],
  ]);
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;

  return commitSemanticOps(
    [{ kind: 'setBounds', elementType: type, id, bounds }],
    {
      ...(gestureId ? { gestureId } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then(({ opResults }) => opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};
