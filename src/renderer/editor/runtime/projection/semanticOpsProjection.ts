import {
  normalizeLayerGroupsForMode,
  projectLayerGroupRename,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';
import { applySemanticElementPatch } from './semanticElementPatchProjection';
import { currentPluginGroupMembers } from '../intent/pluginGroupMembers';
import type {
  CanonicalEditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';

const clone = <T>(value: T): T => structuredClone(value);

export const SEMANTIC_POSITION_FIELDS = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
  sprite: 'spritePositions',
} as const satisfies Record<EditorElementTypeV1, EditorField>;

type SemanticPositionField =
  (typeof SEMANTIC_POSITION_FIELDS)[EditorElementTypeV1];

export const fieldsForSemanticOp = (op: EditorOpV1): EditorField[] => {
  if (op.kind === 'insertFrozenElements') {
    const fields = new Set<EditorField>();
    op.elements.forEach((element) => {
      fields.add(SEMANTIC_POSITION_FIELDS[element.elementType]);
      if (element.elementType === 'key') fields.add('keys');
    });
    op.zUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    if (op.groups.length > 0) fields.add('layerGroups');
    return [...fields];
  }
  if (op.kind === 'reorderElements') {
    const fields = new Set<EditorField>();
    op.zUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    op.groupUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    if (op.completeModeOrder) fields.add('layerGroups');
    return [...fields];
  }
  if (op.kind === 'setElementGroups') {
    return [
      ...new Set([
        ...op.targets.map(
          (target) => SEMANTIC_POSITION_FIELDS[target.elementType],
        ),
        'layerGroups' as const,
      ]),
    ];
  }
  if (op.kind === 'renameLayerGroup') return ['layerGroups'];
  if (op.kind === 'patchElement') {
    return [SEMANTIC_POSITION_FIELDS[op.elementType]];
  }
  if (op.kind === 'setKeySlot') return ['keys'];
  if (op.kind === 'resizeSprite') return ['spritePositions'];
  const positionField = SEMANTIC_POSITION_FIELDS[op.elementType];
  if (op.kind === 'setBounds') return [positionField];
  return op.elementType === 'key' ? ['keys', 'keyPositions'] : [positionField];
};

// 그룹 normalize의 플러그인 멤버 소스는 plugin store가 등록한 제공자 -
// 백엔드가 store 인스턴스를 쓰는 것의 미러. 낙관 replay의 근사이며
// 드리프트는 커밋 이벤트의 canonical patch가 정정한다

export const applySemanticOps = (
  base: CanonicalEditorDocumentV1,
  ops: readonly EditorOpV1[],
  results?: readonly EditorOpResultV1[],
): CanonicalEditorDocumentV1 => {
  const next = clone(base);
  ops.forEach((op, opIndex) => {
    const result = results?.[opIndex];
    if (result?.status === 'targetMissing') return;
    if (op.kind === 'insertFrozenElements') {
      if (result?.status === 'noChange') return;
      if (op.groups.length > 0) {
        const existingGroupIds = new Set(
          (next.layerGroups[op.mode] ?? []).map((group) => group.id),
        );
        next.layerGroups = {
          ...next.layerGroups,
          [op.mode]: [
            ...(next.layerGroups[op.mode] ?? []),
            ...op.groups
              .filter((group) => !existingGroupIds.has(group.id))
              .map((group) => ({ ...group })),
          ],
        };
      }
      for (const element of op.elements) {
        let existing:
          | { elementType: EditorElementTypeV1; mode: string; index: number }
          | undefined;
        for (const [elementType, field] of Object.entries(
          SEMANTIC_POSITION_FIELDS,
        ) as Array<[EditorElementTypeV1, SemanticPositionField]>) {
          const positionsByMode: Record<string, readonly { id: string }[]> =
            next[field];
          for (const [mode, positions] of Object.entries(positionsByMode)) {
            const index = positions.findIndex(
              (position) => position.id === element.position.id,
            );
            if (index >= 0) {
              existing = { elementType, mode, index };
              break;
            }
          }
          if (existing) break;
        }
        if (existing) {
          if (
            existing.elementType !== element.elementType ||
            existing.mode !== op.mode
          ) {
            continue;
          }
          const field = SEMANTIC_POSITION_FIELDS[element.elementType];
          const record = next[field] as Record<
            string,
            Array<Record<string, unknown>>
          >;
          next[field] = {
            ...record,
            [op.mode]: (record[op.mode] ?? []).map((position, index) =>
              index === existing!.index
                ? (clone(element.position) as Record<string, unknown>)
                : position,
            ),
          } as never;
          if (element.elementType === 'key') {
            next.keys = {
              ...next.keys,
              [op.mode]: (next.keys[op.mode] ?? []).map((slot, index) =>
                index === existing!.index ? clone(element.slot) : slot,
              ),
            };
          }
          continue;
        }
        if (element.elementType === 'key') {
          next.keys = {
            ...next.keys,
            [op.mode]: [...(next.keys[op.mode] ?? []), clone(element.slot)],
          };
          next.keyPositions = {
            ...next.keyPositions,
            [op.mode]: [
              ...(next.keyPositions[op.mode] ?? []),
              clone(element.position),
            ],
          };
        } else {
          const field = SEMANTIC_POSITION_FIELDS[element.elementType];
          const record = next[field] as Record<
            string,
            Array<Record<string, unknown>>
          >;
          next[field] = {
            ...record,
            [op.mode]: [
              ...(record[op.mode] ?? []),
              clone(element.position) as Record<string, unknown>,
            ],
          } as never;
        }
      }
      for (const update of op.zUpdates) {
        const field = SEMANTIC_POSITION_FIELDS[update.elementType];
        const record = next[field] as Record<
          string,
          Array<Record<string, unknown> & { id: string }>
        >;
        const positions = record[op.mode] ?? [];
        const index = positions.findIndex(
          (position) => position.id === update.id,
        );
        if (index < 0) continue;
        next[field] = {
          ...record,
          [op.mode]: positions.map((position, positionIndex) =>
            positionIndex === index
              ? (position.zIndex ?? 0) === update.zIndex
                ? position
                : { ...position, zIndex: update.zIndex }
              : position,
          ),
        } as never;
      }
      return;
    }
    if (op.kind === 'reorderElements') {
      if (result?.status === 'noChange') return;
      const zById = new Map(
        op.zUpdates.map((update) => [update.id, update] as const),
      );
      const groupById = new Map(
        op.groupUpdates.map((update) => [update.id, update] as const),
      );
      const touchedTypes = new Set([
        ...op.zUpdates.map((update) => update.elementType),
        ...op.groupUpdates.map((update) => update.elementType),
      ]);
      for (const elementType of touchedTypes) {
        const field = SEMANTIC_POSITION_FIELDS[elementType];
        const record = next[field] as Record<
          string,
          Array<Record<string, unknown> & { id: string }>
        >;
        next[field] = {
          ...record,
          [op.mode]: (record[op.mode] ?? []).map((position) => {
            const id = position.id;
            const zUpdate = zById.get(id);
            const groupUpdate = groupById.get(id);
            if (
              zUpdate?.elementType !== elementType &&
              groupUpdate?.elementType !== elementType
            ) {
              return position;
            }
            const updated = { ...position };
            if (zUpdate?.elementType === elementType) {
              updated.zIndex = zUpdate.zIndex;
            }
            if (groupUpdate?.elementType === elementType) {
              if (groupUpdate.groupId === null) delete updated.groupId;
              else updated.groupId = groupUpdate.groupId;
            }
            return updated;
          }),
        } as never;
      }
      if (op.completeModeOrder) {
        const normalized = normalizeLayerGroupsForMode({
          mode: op.mode,
          keyPositions: next.keyPositions,
          statPositions: next.statPositions,
          graphPositions: next.graphPositions,
          knobPositions: next.knobPositions,
          spritePositions: next.spritePositions,
          layerGroups: next.layerGroups,
          pluginElements: currentPluginGroupMembers(),
        });
        next.keyPositions = normalized.keyPositions;
        next.statPositions = normalized.statPositions;
        next.graphPositions = normalized.graphPositions;
        next.knobPositions = normalized.knobPositions;
        next.spritePositions = normalized.spritePositions;
        next.layerGroups = normalized.layerGroups;
      }
      return;
    }
    if (op.kind === 'setElementGroups') {
      if (result?.status === 'noChange') return;
      const projected = projectStableElementGroups({
        mode: op.mode,
        targets: op.targets,
        targetGroup: op.targetGroup,
        keyPositions: next.keyPositions,
        statPositions: next.statPositions,
        graphPositions: next.graphPositions,
        knobPositions: next.knobPositions,
        spritePositions: next.spritePositions,
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      if (!projected) return;
      next.keyPositions = projected.keyPositions;
      next.statPositions = projected.statPositions;
      next.graphPositions = projected.graphPositions;
      next.knobPositions = projected.knobPositions;
      next.spritePositions = projected.spritePositions;
      next.layerGroups = projected.layerGroups;
      return;
    }
    if (op.kind === 'renameLayerGroup') {
      if (result?.status === 'noChange') return;
      const layerGroups = projectLayerGroupRename({
        mode: op.mode,
        groupId: op.groupId,
        name: op.name,
        layerGroups: next.layerGroups,
      });
      if (layerGroups) next.layerGroups = layerGroups;
      return;
    }
    if (op.kind === 'patchElement') {
      applySemanticElementPatch(next, op, result, SEMANTIC_POSITION_FIELDS);
      return;
    }
    if (op.kind === 'setKeySlot') {
      if (result?.status === 'noChange') return;
      for (const [mode, positions] of Object.entries(next.keyPositions)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        next.keys = {
          ...next.keys,
          [mode]: (next.keys[mode] ?? []).map((slot, slotIndex) =>
            slotIndex === index ? clone(op.slot) : slot,
          ),
        };
        break;
      }
      return;
    }
    if (op.kind === 'resizeSprite') {
      if (result?.status === 'noChange') return;
      const positionsByMode = next.spritePositions;
      for (const [mode, positions] of Object.entries(positionsByMode)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        // 결과 bounds(서버 확정)가 있으면 그것으로 projection - 배율 수학은
        // resizeProjection 하나가 양측 계약을 소유한다
        const bounds = result?.bounds ?? op.bounds;
        positionsByMode[mode] = positions.map((position, positionIndex) =>
          positionIndex === index
            ? projectSpriteResize(position, bounds)
            : position,
        );
        break;
      }
      return;
    }
    const field = SEMANTIC_POSITION_FIELDS[op.elementType];
    const positionsByMode = next[field] as Record<
      string,
      Array<Record<string, unknown>>
    >;
    for (const [mode, positions] of Object.entries(positionsByMode)) {
      const index = positions.findIndex((position) => position.id === op.id);
      if (index < 0) continue;
      if (op.kind === 'setBounds') {
        const bounds = result?.bounds ?? op.bounds;
        positionsByMode[mode] = positions.map((position, positionIndex) =>
          positionIndex === index ? { ...position, ...bounds } : position,
        );
        break;
      }
      positionsByMode[mode] = positions.filter(
        (_, positionIndex) => positionIndex !== index,
      );
      if (op.elementType === 'key') {
        next.keys = {
          ...next.keys,
          [mode]: (next.keys[mode] ?? []).filter(
            (_, slotIndex) => slotIndex !== index,
          ),
        };
      }
      const normalized = normalizeLayerGroupsForMode({
        mode,
        keyPositions: next.keyPositions,
        statPositions: next.statPositions,
        graphPositions: next.graphPositions,
        knobPositions: next.knobPositions,
        spritePositions: next.spritePositions,
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      next.keyPositions = normalized.keyPositions;
      next.statPositions = normalized.statPositions;
      next.graphPositions = normalized.graphPositions;
      next.knobPositions = normalized.knobPositions;
      next.spritePositions = normalized.spritePositions;
      next.layerGroups = normalized.layerGroups;
      break;
    }
  });
  return next;
};
