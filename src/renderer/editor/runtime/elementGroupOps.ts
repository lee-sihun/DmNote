import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { isNativeElementId } from '../model/elementId';
import type { NativeElementType } from '../model/elementIdMap';
import { currentPluginGroupMembers } from './pluginGroupMembers';
import {
  projectLayerGroupRename,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import {
  applyPropertyIntentsEagerly,
  createPropertyReceipt,
} from './elementIntent';
import {
  commitGeneratedSemanticOps,
  commitSemanticOps,
} from './editorSemanticOps';
import {
  captureEditorDocument,
  editorCoordinator,
} from './editorStateCoordinator';
import type {
  CanonicalEditorDocumentV1,
  EditorElementGroupTargetV1,
  EditorElementPropertyPatchV1,
  EditorTargetLayerGroupV1,
} from '@src/types/editor';
import { patchElementPropertyById } from './elementPropertyCore';
import {
  FIELD_BY_TYPE,
  findInRecord,
  type LooseRecord,
} from './elementDocumentModel';

interface ElementPropertyPatchTarget {
  type: NativeElementType;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

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
