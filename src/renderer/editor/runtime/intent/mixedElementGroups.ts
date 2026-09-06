// 혼합(native+plugin) 그룹 편집 진입점: 그룹 def와 native 소속은
// setElementGroups op, 플러그인 소속은 같은 gestureId의 pluginChanges로
// 단일 커밋에 실린다 - history compound 병합으로 undo가 원자 복원된다

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  isPluginGroupMemberInMode,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import { isNativeElementId } from '../../model/elementId';
import { unloadedPluginGroupMembers } from './pluginGroupMembers';
import {
  ElementIntentAbort,
  applyPropertyIntentsEagerly,
  combineReceipts,
  type ElementIntentReceipt,
} from './elementIntent';
import {
  setElementGroupsByTargets,
  setLayerGroupHidden,
} from '../operations/elementOps';
import { runMixedGestureElementIntent } from './mixedElementIntent';

import type {
  CanonicalEditorDocumentV1,
  EditorElementGroupTargetV1,
  EditorOpV1,
  EditorTargetLayerGroupV1,
} from '@src/types/editor';
import type { NativeElementType } from '../../model/elementIdMap';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const validStructuralText = (value: string, maxBytes: number): boolean =>
  value.length > 0 && new TextEncoder().encode(value).length <= maxBytes;

// native 대상은 빈 배열 허용 - plugin-only 그룹 편집도 op가 def 생성·정리를 운반
const validNativeGroupTargets = (
  targets: readonly EditorElementGroupTargetV1[],
): boolean =>
  targets.length <= 4096 &&
  targets.every(
    ({ elementType, id }) =>
      ['key', 'stat', 'graph', 'knob', 'sprite'].includes(elementType) &&
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

// 플러그인 groupId eager 반영 - CAS receipt (zIndex eager 패턴과 동일)
const applyPluginGroupIdsEagerly = (
  targets: ReadonlyMap<string, string | undefined>,
): ElementIntentReceipt | null => {
  const store = usePluginDisplayElementStore.getState();
  const entries: Array<{
    fullId: string;
    before: string | undefined;
    expected: string | undefined;
  }> = [];
  const next = store.elements.map((element) => {
    if (!targets.has(element.fullId)) return element;
    const expected = targets.get(element.fullId);
    if (element.groupId === expected) return element;
    entries.push({
      fullId: element.fullId,
      before: element.groupId,
      expected,
    });
    return { ...element, groupId: expected };
  });
  if (entries.length === 0) return null;
  try {
    store.setElements(next);
  } catch (error) {
    try {
      usePluginDisplayElementStore
        .getState()
        .setElements([...store.elements], { skipSync: true });
    } catch {
      // 원래 오류 보존
    }
    throw error;
  }
  return {
    rollback: () => {
      const currentStore = usePluginDisplayElementStore.getState();
      const byId = new Map(entries.map((entry) => [entry.fullId, entry]));
      let touched = false;
      const restored = currentStore.elements.map((element) => {
        const entry = byId.get(element.fullId);
        // CAS: 우리가 쓴 값 그대로일 때만 복원
        if (!entry || element.groupId !== entry.expected) return element;
        touched = true;
        return { ...element, groupId: entry.before };
      });
      if (touched) currentStore.setElements(restored);
    },
  };
};

/**
 * 선택된 native+plugin 요소의 그룹 소속 변경 (main 창 전용)
 * plugin 대상이 없으면 기존 native 전용 경로에 위임
 */
export const setMixedElementGroups = (
  mode: string,
  nativeTargets: readonly EditorElementGroupTargetV1[],
  pluginFullIds: readonly string[],
  targetGroup: EditorTargetLayerGroupV1 | null,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (pluginFullIds.length === 0) {
    return setElementGroupsByTargets(mode, nativeTargets, targetGroup, options);
  }
  if (
    !validStructuralText(mode, 128) ||
    !validNativeGroupTargets(nativeTargets) ||
    !validTargetLayerGroup(targetGroup) ||
    pluginFullIds.some((fullId) => fullId.trim().length === 0) ||
    new Set(pluginFullIds).size !== pluginFullIds.length
  ) {
    return Promise.resolve(false);
  }

  const pluginElements = usePluginDisplayElementStore.getState().elements;
  const targetedPlugins = pluginFullIds.flatMap((fullId) => {
    const element = pluginElements.find(
      (candidate) => candidate.fullId === fullId,
    );
    return element ? [element] : [];
  });
  // 대상 소실·모드 불일치는 부분 적용 대신 전체 거절 - 저장 규칙 밖의
  // groupId는 dangling이 되어 백엔드 normalize와 어긋난다
  if (
    targetedPlugins.length !== pluginFullIds.length ||
    targetedPlugins.some((element) => !isPluginGroupMemberInMode(element, mode))
  ) {
    return Promise.resolve(false);
  }
  const pluginIds = [
    ...new Set(targetedPlugins.map((element) => element.pluginId)),
  ];
  const targetedFullIds = new Set(pluginFullIds);
  const nextGroupId = targetGroup?.id;
  const desiredGroupIdByFullId = new Map<string, string | undefined>(
    pluginFullIds.map((fullId) => [fullId, nextGroupId]),
  );

  const projectDesiredPlugins = (
    projection: readonly PluginDisplayElementInternal[],
  ): PluginDisplayElementInternal[] =>
    projection.map((element) =>
      targetedFullIds.has(element.fullId) && element.groupId !== nextGroupId
        ? { ...element, groupId: nextGroupId }
        : element,
    );

  const run = async (): Promise<boolean> => {
    const gestureId = crypto.randomUUID();
    let receipt: ElementIntentReceipt | null = null;
    let runnerStarted = false;
    try {
      beginMixedGestureTransaction(gestureId, pluginIds);
      pluginIds.forEach((pluginId) =>
        rotatePluginInstancesEditSession(pluginId, gestureId),
      );

      // eager: native 투영 + 그룹 def 정리는 desired 플러그인 소속 기준
      const before = {
        keyPositions: useKeyStore.getState().canonicalPositions,
        statPositions: useStatItemStore.getState().positions,
        graphPositions: useGraphItemStore.getState().positions,
        knobPositions: useKnobItemStore.getState().positions,
        spritePositions: useSpriteStore.getState().positions,
        layerGroups: useLayerGroupStore.getState().layerGroups,
      };
      const projected = projectStableElementGroups({
        mode,
        targets: nativeTargets,
        targetGroup,
        ...before,
        pluginElements: [
          ...projectDesiredPlugins(
            usePluginDisplayElementStore.getState().elements,
          ),
          ...unloadedPluginGroupMembers(),
        ],
      });
      if (!projected) return false;
      let nativeReceipt: ElementIntentReceipt | null = null;
      if (projected.changed) {
        useKeyStore.getState().setPositions(projected.keyPositions);
        useStatItemStore.getState().setPositions(projected.statPositions);
        useGraphItemStore.getState().setPositions(projected.graphPositions);
        useKnobItemStore.getState().setPositions(projected.knobPositions);
        useSpriteStore.getState().setPositions(projected.spritePositions);
        useLayerGroupStore.getState().setLayerGroups(projected.layerGroups);
        nativeReceipt = {
          rollback: () => {
            // 참조 CAS: 우리가 쓴 투영 그대로일 때만 복원
            if (
              useKeyStore.getState().canonicalPositions ===
              projected.keyPositions
            ) {
              useKeyStore.getState().setPositions(before.keyPositions);
            }
            if (
              useStatItemStore.getState().positions === projected.statPositions
            ) {
              useStatItemStore.getState().setPositions(before.statPositions);
            }
            if (
              useGraphItemStore.getState().positions ===
              projected.graphPositions
            ) {
              useGraphItemStore.getState().setPositions(before.graphPositions);
            }
            if (
              useKnobItemStore.getState().positions === projected.knobPositions
            ) {
              useKnobItemStore.getState().setPositions(before.knobPositions);
            }
            if (
              useSpriteStore.getState().positions === projected.spritePositions
            ) {
              useSpriteStore.getState().setPositions(before.spritePositions);
            }
            if (
              useLayerGroupStore.getState().layerGroups ===
              projected.layerGroups
            ) {
              useLayerGroupStore.getState().setLayerGroups(before.layerGroups);
            }
          },
        };
      }
      let pluginReceipt: ElementIntentReceipt | null = null;
      try {
        pluginReceipt = applyPluginGroupIdsEagerly(desiredGroupIdByFullId);
      } catch (error) {
        nativeReceipt?.rollback();
        throw error;
      }
      receipt = combineReceipts(nativeReceipt, pluginReceipt);

      runnerStarted = true;
      const result = await runMixedGestureElementIntent({
        gestureId,
        initialPluginIds: pluginIds,
        pluginScope: () => pluginIds,
        receipt,
        generate: ({ pluginProjection }) => {
          options.preflight?.();
          // 대상 소실·모드 이탈은 부분 커밋 대신 전체 중단 (fail-closed)
          const byFullId = new Map(
            pluginProjection.map((element) => [element.fullId, element]),
          );
          for (const fullId of pluginFullIds) {
            const element = byFullId.get(fullId);
            if (!element || !isPluginGroupMemberInMode(element, mode)) {
              throw new ElementIntentAbort('mixed group settlement');
            }
          }
          const ops: EditorOpV1[] = [
            {
              kind: 'setElementGroups',
              mode,
              targets: nativeTargets.map((target) => ({ ...target })),
              targetGroup: targetGroup ? { ...targetGroup } : null,
            },
          ];
          return {
            kind: 'ops',
            ops,
            desiredPluginProjection: projectDesiredPlugins(pluginProjection),
          };
        },
        skipContext: 'mixed group settlement',
        retryEditorOnly: false,
      });
      return result.committed;
    } catch (error) {
      if (!runnerStarted) receipt?.rollback();
      throw error;
    } finally {
      cancelUncommittedMixedGestureTransaction(gestureId);
    }
  };

  return run();
};

// 그룹 가시성 대상 판정 - groupId 일치 + 현재 모드 소속만
const isPluginGroupVisibilityTarget = (
  element: PluginDisplayElementInternal,
  mode: string,
  groupId: string,
): boolean =>
  element.groupId === groupId && isPluginGroupMemberInMode(element, mode);

type NativeGroupMember = { type: NativeElementType; id: string };
type PositionSlice = Record<string, ReadonlyArray<Record<string, unknown>>>;

const NATIVE_MEMBER_TYPES: readonly NativeElementType[] = [
  'key',
  'stat',
  'graph',
  'knob',
  'sprite',
];

// 그룹의 native 멤버 수집 - canonical ID가 아닌 멤버가 섞이면 반쪽 토글
// 대신 전체 거절 (setLayerGroupHidden의 unsupported 규칙과 동일)
const collectNativeGroupMembers = (
  read: (type: NativeElementType) => PositionSlice,
  mode: string,
  groupId: string,
): NativeGroupMember[] | null => {
  const members: NativeGroupMember[] = [];
  for (const type of NATIVE_MEMBER_TYPES) {
    for (const position of read(type)[mode] ?? []) {
      if (position.groupId !== groupId) continue;
      if (typeof position.id !== 'string' || !isNativeElementId(position.id)) {
        return null;
      }
      members.push({ type, id: position.id });
    }
  }
  return members;
};

const readStorePositions = (type: NativeElementType): PositionSlice =>
  (type === 'key'
    ? useKeyStore.getState().canonicalPositions
    : type === 'stat'
    ? useStatItemStore.getState().positions
    : type === 'graph'
    ? useGraphItemStore.getState().positions
    : type === 'knob'
    ? useKnobItemStore.getState().positions
    : useSpriteStore.getState().positions) as unknown as PositionSlice;

const readDocumentPositions =
  (base: CanonicalEditorDocumentV1) =>
  (type: NativeElementType): PositionSlice =>
    (type === 'key'
      ? base.keyPositions
      : type === 'stat'
      ? base.statPositions
      : type === 'graph'
      ? base.graphPositions
      : type === 'knob'
      ? base.knobPositions
      : base.spritePositions) as unknown as PositionSlice;

// 플러그인 hidden eager 반영 - CAS receipt (groupId eager 패턴과 동일)
const applyPluginHiddenEagerly = (
  targets: ReadonlySet<string>,
  hidden: boolean,
): ElementIntentReceipt | null => {
  const store = usePluginDisplayElementStore.getState();
  const entries: Array<{ fullId: string; before: boolean | undefined }> = [];
  const next = store.elements.map((element) => {
    if (!targets.has(element.fullId)) return element;
    if ((element.hidden === true) === hidden) return element;
    entries.push({ fullId: element.fullId, before: element.hidden });
    return { ...element, hidden };
  });
  if (entries.length === 0) return null;
  try {
    store.setElements(next);
  } catch (error) {
    try {
      usePluginDisplayElementStore
        .getState()
        .setElements([...store.elements], { skipSync: true });
    } catch {
      // 원래 오류 보존
    }
    throw error;
  }
  return {
    rollback: () => {
      const currentStore = usePluginDisplayElementStore.getState();
      const byId = new Map(entries.map((entry) => [entry.fullId, entry]));
      let touched = false;
      const restored = currentStore.elements.map((element) => {
        const entry = byId.get(element.fullId);
        // CAS: 우리가 쓴 값 그대로일 때만 복원
        if (!entry || (element.hidden === true) !== hidden) return element;
        touched = true;
        return { ...element, hidden: entry.before };
      });
      if (touched) currentStore.setElements(restored);
    },
  };
};

/**
 * 그룹 전체 표시/숨김 변경 (main 창 전용)
 * native+plugin 혼합 그룹은 patchElement op와 hidden 반영 pluginChanges를
 * 단일 gestureId로 커밋해 undo가 한 번에 복원된다.
 * 플러그인 멤버가 없으면 기존 native 전용 경로에 위임
 */
export const setMixedLayerGroupHidden = (
  mode: string,
  groupId: string,
  hidden: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (!validStructuralText(mode, 128) || !validStructuralText(groupId, 256)) {
    return Promise.resolve(false);
  }
  const pluginMembers = usePluginDisplayElementStore
    .getState()
    .elements.filter((element) =>
      isPluginGroupVisibilityTarget(element, mode, groupId),
    );
  if (pluginMembers.length === 0) {
    return setLayerGroupHidden(mode, groupId, hidden, options);
  }
  const nativeMembers = collectNativeGroupMembers(
    readStorePositions,
    mode,
    groupId,
  );
  if (!nativeMembers) return Promise.resolve(false);

  const pluginIds = [...new Set(pluginMembers.map(({ pluginId }) => pluginId))];
  const targetedFullIds = new Set(pluginMembers.map(({ fullId }) => fullId));

  const nativeMemberIds = new Set(nativeMembers.map(({ id }) => id));

  const projectDesiredPlugins = (
    projection: readonly PluginDisplayElementInternal[],
  ): PluginDisplayElementInternal[] =>
    projection.map((element) =>
      targetedFullIds.has(element.fullId) &&
      (element.hidden === true) !== hidden
        ? { ...element, hidden }
        : element,
    );

  const run = async (): Promise<boolean> => {
    const gestureId = crypto.randomUUID();
    let receipt: ElementIntentReceipt | null = null;
    let runnerStarted = false;
    try {
      beginMixedGestureTransaction(gestureId, pluginIds);
      pluginIds.forEach((pluginId) =>
        rotatePluginInstancesEditSession(pluginId, gestureId),
      );

      // eager: native 멤버 hidden 필드 CAS + 플러그인 hidden CAS
      const nativeIntents = new Map<
        NativeElementType,
        Map<string, Record<string, unknown>>
      >();
      for (const { type, id } of nativeMembers) {
        const byId = nativeIntents.get(type) ?? new Map();
        byId.set(id, { hidden });
        nativeIntents.set(type, byId);
      }
      const nativeReceipt = applyPropertyIntentsEagerly(nativeIntents);
      let pluginReceipt: ElementIntentReceipt | null = null;
      try {
        pluginReceipt = applyPluginHiddenEagerly(targetedFullIds, hidden);
      } catch (error) {
        nativeReceipt?.rollback();
        throw error;
      }
      receipt = combineReceipts(nativeReceipt, pluginReceipt);

      runnerStarted = true;
      const result = await runMixedGestureElementIntent({
        gestureId,
        initialPluginIds: pluginIds,
        pluginScope: () => pluginIds,
        receipt,
        generate: ({ base, pluginProjection }) => {
          options.preflight?.();
          // 멤버 구성 드리프트는 반쪽 토글 대신 전체 중단 (fail-closed)
          const latestNative = collectNativeGroupMembers(
            readDocumentPositions(base),
            mode,
            groupId,
          );
          if (
            !latestNative ||
            latestNative.length !== nativeMembers.length ||
            latestNative.some(({ id }) => !nativeMemberIds.has(id))
          ) {
            throw new ElementIntentAbort('mixed group visibility settlement');
          }
          const latestPluginMemberIds = new Set(
            pluginProjection
              .filter((element) =>
                isPluginGroupVisibilityTarget(element, mode, groupId),
              )
              .map((element) => element.fullId),
          );
          if (
            latestPluginMemberIds.size !== targetedFullIds.size ||
            [...targetedFullIds].some(
              (fullId) => !latestPluginMemberIds.has(fullId),
            )
          ) {
            throw new ElementIntentAbort('mixed group visibility settlement');
          }
          const ops: EditorOpV1[] = latestNative.map(({ type, id }) => ({
            kind: 'patchElement',
            elementType: type,
            id,
            patch: { property: 'hidden', value: hidden },
          }));
          if (ops.length === 0) {
            return {
              kind: 'patch',
              patch: null,
              desiredPluginProjection: projectDesiredPlugins(pluginProjection),
            };
          }
          return {
            kind: 'ops',
            ops,
            desiredPluginProjection: projectDesiredPlugins(pluginProjection),
          };
        },
        skipContext: 'mixed group visibility settlement',
        retryEditorOnly: false,
      });
      return result.committed;
    } catch (error) {
      if (!runnerStarted) receipt?.rollback();
      throw error;
    } finally {
      cancelUncommittedMixedGestureTransaction(gestureId);
    }
  };

  return run();
};
