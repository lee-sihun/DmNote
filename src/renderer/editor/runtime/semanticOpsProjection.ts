import {
  normalizeLayerGroupsForMode,
  projectLayerGroupRename,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import { currentPluginGroupMembers } from './pluginGroupMembers';
import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  applyImageTransformLeaf,
  type ImageTransform,
} from '@src/types/key/imageLayer';
import {
  isNotePaintPropertyPatchV1,
  mirrorBodyPaintToGlow,
  projectNotePaintPatch,
} from '@src/types/key/notePaint';
import {
  isCounterFillPropertyPatchV1,
  projectCounterFillPatch,
} from '@src/types/key/counterFill';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { isEditorShadowPropertyPatchV1 } from '@src/types/editor';
import type {
  CanonicalEditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';
import {
  implicitCounterFontBold,
  implicitElementFontBold,
} from '@utils/core/fontWeights';

const clone = <T>(value: T): T => structuredClone(value);

export const SEMANTIC_POSITION_FIELDS: Record<
  EditorElementTypeV1,
  EditorField
> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

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
        ) as Array<[EditorElementTypeV1, EditorField]>) {
          for (const [mode, positions] of Object.entries(next[field])) {
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
          layerGroups: next.layerGroups,
          pluginElements: currentPluginGroupMembers(),
        });
        next.keyPositions = normalized.keyPositions;
        next.statPositions = normalized.statPositions;
        next.graphPositions = normalized.graphPositions;
        next.knobPositions = normalized.knobPositions;
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
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      if (!projected) return;
      next.keyPositions = projected.keyPositions;
      next.statPositions = projected.statPositions;
      next.graphPositions = projected.graphPositions;
      next.knobPositions = projected.knobPositions;
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
      if (result?.status === 'noChange') return;
      const field = SEMANTIC_POSITION_FIELDS[op.elementType];
      const record = next[field] as Record<
        string,
        Array<Record<string, unknown> & { id: string }>
      >;
      for (const [mode, positions] of Object.entries(record)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        next[field] = {
          ...record,
          [mode]: positions.map((position, positionIndex) => {
            if (positionIndex !== index) return position;
            if (op.patch.property === 'layerName') {
              const updated = { ...position };
              if (op.patch.value === null) delete updated.layerName;
              else updated.layerName = op.patch.value;
              return updated;
            }
            if (op.patch.property === 'graphType') {
              return { ...position, graphType: op.patch.value };
            }
            if (op.patch.property === 'graphColor') {
              return { ...position, graphColor: op.patch.value };
            }
            if (op.patch.property === 'showAvgLine') {
              return { ...position, showAvgLine: op.patch.value };
            }
            if (op.patch.property === 'graphAnimationEnabled') {
              return {
                ...position,
                graphAnimationEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'graphSpeed') {
              return { ...position, graphSpeed: op.patch.value };
            }
            if (op.patch.property === 'reverse') {
              return { ...position, reverse: op.patch.value };
            }
            if (op.patch.property === 'sensitivity') {
              return { ...position, sensitivity: op.patch.value };
            }
            if (op.patch.property === 'axisId') {
              return { ...position, axisId: op.patch.value };
            }
            if (op.patch.property === 'soundEnabled') {
              return { ...position, soundEnabled: op.patch.value };
            }
            if (op.patch.property === 'soundVolume') {
              return { ...position, soundVolume: op.patch.value };
            }
            if (op.patch.property === 'soundPath') {
              return { ...position, soundPath: op.patch.value };
            }
            if (op.patch.property === 'inactiveImage') {
              return { ...position, inactiveImage: op.patch.value };
            }
            if (op.patch.property === 'activeImage') {
              return { ...position, activeImage: op.patch.value };
            }
            if (op.patch.property === 'idleTransparent') {
              return {
                ...position,
                idleTransparent: op.patch.value,
              };
            }
            if (op.patch.property === 'activeTransparent') {
              return {
                ...position,
                activeTransparent: op.patch.value,
              };
            }
            if (op.patch.property === 'idleImageFit') {
              return { ...position, idleImageFit: op.patch.value };
            }
            if (op.patch.property === 'activeImageFit') {
              return { ...position, activeImageFit: op.patch.value };
            }
            if (op.patch.property === 'imageMode') {
              // replace는 기본값이라 sparse 저장 - 백엔드와 동일
              const { imageMode: _imageMode, ...rest } = position;
              return op.patch.value === 'replace'
                ? rest
                : { ...position, imageMode: op.patch.value };
            }
            if (
              op.patch.property === 'idleImageTransform' ||
              op.patch.property === 'activeImageTransform'
            ) {
              const field = op.patch.property;
              if (op.patch.value === null) {
                const { [field]: _dropped, ...rest } = position;
                return rest;
              }
              return {
                ...position,
                [field]: applyImageTransformLeaf(
                  position[field] as ImageTransform | undefined,
                  op.patch.value,
                ),
              };
            }
            if (op.patch.property === 'counterEnabled') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, enabled: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAnimationEnabled') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const animation = (counter?.animation ?? {}) as Record<
                string,
                unknown
              >;
              return {
                ...position,
                counter: {
                  ...counter,
                  animation: {
                    ...animation,
                    enabled: op.patch.value,
                  },
                },
              };
            }
            if (op.patch.property === 'counterPlacement') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, placement: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAlign') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, align: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAlignMode') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, alignMode: op.patch.value },
              };
            }
            if (op.patch.property === 'counterGap') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, gap: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontSize') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontSize: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontWeight') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              // 백엔드와 같은 암묵 Bold 고정 (fontWeights.implicitCounterFontBold)
              return {
                ...position,
                counter: {
                  ...counter,
                  fontWeight: op.patch.value,
                  ...(typeof counter?.fontBold !== 'boolean'
                    ? { fontBold: implicitCounterFontBold(counter?.fontWeight) }
                    : {}),
                },
              };
            }
            if (op.patch.property === 'counterFontBold') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontBold: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontItalic') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontItalic: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontUnderline') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontUnderline: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterFontStrikethrough') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontStrikethrough: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterFontFamily') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontFamily: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterAnimationPreset') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const animation = (counter?.animation ?? {}) as Record<
                string,
                unknown
              >;
              const intent = op.patch.value;
              return {
                ...position,
                counter: {
                  ...counter,
                  animation: {
                    ...animation,
                    ...('applyPresetId' in intent
                      ? { presetId: intent.presetId }
                      : {}),
                    ...('bezier' in intent
                      ? { bezier: [...intent.bezier] }
                      : {}),
                    ...('scale' in intent ? { scale: intent.scale } : {}),
                    ...('durationMs' in intent
                      ? { durationMs: intent.durationMs }
                      : {}),
                  },
                },
              };
            }
            if (op.patch.property === 'useInlineStyles') {
              return {
                ...position,
                useInlineStyles: op.patch.value,
              };
            }
            if (op.patch.property === 'fontWeight') {
              // 백엔드와 같은 암묵 Bold 고정 (fontWeights.implicitElementFontBold)
              return {
                ...position,
                fontWeight: op.patch.value,
                ...(position.fontBold == null
                  ? { fontBold: implicitElementFontBold(position.fontWeight) }
                  : {}),
              };
            }
            if (op.patch.property === 'fontBold') {
              return { ...position, fontBold: op.patch.value };
            }
            if (op.patch.property === 'fontItalic') {
              return { ...position, fontItalic: op.patch.value };
            }
            if (op.patch.property === 'fontUnderline') {
              return { ...position, fontUnderline: op.patch.value };
            }
            if (op.patch.property === 'fontStrikethrough') {
              return {
                ...position,
                fontStrikethrough: op.patch.value,
              };
            }
            if (op.patch.property === 'fontFamily') {
              return { ...position, fontFamily: op.patch.value };
            }
            if (
              op.patch.property === 'backgroundPaint' ||
              op.patch.property === 'activeBackgroundPaint' ||
              op.patch.property === 'borderPaint' ||
              op.patch.property === 'activeBorderPaint' ||
              op.patch.property === 'fontPaint' ||
              op.patch.property === 'activeFontPaint'
            ) {
              const field = op.patch.property;
              const paint = op.patch.value;
              const {
                active,
                surface,
                colorField,
                gradientField,
                activeColorField,
                activeGradientField,
              } = paintPropertyFields(field);
              // 물질화 대상 - active 쌍을 가진 요소 (font는 키만)
              const materializes =
                surface === 'font'
                  ? op.elementType === 'key'
                  : op.elementType === 'key' || op.elementType === 'knob';
              const preservation: Record<string, unknown> = {};
              if (!active && materializes) {
                const inherited = inheritedPaintMaterialization(
                  {
                    color:
                      typeof position[colorField] === 'string'
                        ? (position[colorField] as string)
                        : undefined,
                    gradient: position[gradientField] as never,
                  },
                  {
                    color:
                      typeof position[activeColorField] === 'string'
                        ? (position[activeColorField] as string)
                        : undefined,
                    gradient: position[activeGradientField] as never,
                  },
                );
                if (inherited) {
                  if (inherited.color != null) {
                    preservation[activeColorField] = inherited.color;
                  }
                  if (inherited.gradient) {
                    preservation[activeGradientField] = inherited.gradient;
                  }
                }
              }
              return {
                ...position,
                ...preservation,
                [colorField]: paint.color,
                [gradientField]: paint.gradient ?? undefined,
              };
            }
            if (isEditorShadowPropertyPatchV1(op.patch)) {
              return {
                ...position,
                ...projectElementShadowPatch({
                  position: position as never,
                  elementType: op.elementType as 'key' | 'stat' | 'knob',
                  patch: op.patch,
                  defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
                  defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
                }),
              };
            }
            if (isCounterFillPropertyPatchV1(op.patch)) {
              return {
                ...position,
                ...projectCounterFillPatch(position as never, op.patch),
              };
            }
            if (isNotePaintPropertyPatchV1(op.patch)) {
              // position 전달 - {opacity} 단독의 sibling shadow 재계산 (§9-5)
              return {
                ...position,
                ...projectNotePaintPatch(op.patch, position as never),
              };
            }
            if (op.patch.property === 'displayText') {
              return { ...position, displayText: op.patch.value };
            }
            if (op.patch.property === 'className') {
              return { ...position, className: op.patch.value };
            }
            if (op.patch.property === 'borderWidth') {
              return { ...position, borderWidth: op.patch.value };
            }
            if (op.patch.property === 'borderRadius') {
              return { ...position, borderRadius: op.patch.value };
            }
            if (op.patch.property === 'fontSize') {
              return { ...position, fontSize: op.patch.value };
            }
            if (op.patch.property === 'noteGlowSize') {
              return { ...position, noteGlowSize: op.patch.value };
            }
            if (op.patch.property === 'noteOffsetX') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteOffsetX: op.patch.value };
            }
            if (op.patch.property === 'noteOffsetY') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteOffsetY: op.patch.value };
            }
            if (op.patch.property === 'noteWidth') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteWidth: op.patch.value };
            }
            if (op.patch.property === 'noteBorderWidth') {
              return {
                ...position,
                noteBorderWidth: op.patch.value,
              };
            }
            if (op.patch.property === 'noteBorderRadius') {
              return {
                ...position,
                noteBorderRadius: op.patch.value,
              };
            }
            if (op.patch.property === 'noteEffectEnabled') {
              return {
                ...position,
                noteEffectEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'noteAutoYCorrection') {
              return {
                ...position,
                noteAutoYCorrection: op.patch.value,
              };
            }
            if (op.patch.property === 'noteGlowEnabled') {
              return {
                ...position,
                noteGlowEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'noteGlowSyncPaint') {
              // 켜는 순간 본체 페인트를 글로우로 복사 (Rust 적용기와 동일)
              const next = { ...position, noteGlowSyncPaint: op.patch.value };
              return op.patch.value
                ? { ...next, ...mirrorBodyPaintToGlow(next as never) }
                : next;
            }
            if (op.patch.property === 'noteAlignment') {
              return { ...position, noteAlignment: op.patch.value };
            }
            if (op.patch.property === 'noteBorderSide') {
              return { ...position, noteBorderSide: op.patch.value };
            }
            if (op.patch.property === 'statType') {
              return { ...position, statType: op.patch.value };
            }
            if (op.patch.property === 'hidden') {
              return { ...position, hidden: op.patch.value };
            }
            // 속성 arm 누락을 컴파일 시점에 잡는다. Rust 적용부는 exhaustive
            // match라 누락이 컴파일 오류지만 이 체인은 폴백으로 흘렀다
            const unhandled: never = op.patch;
            void unhandled;
            return position;
          }),
        } as never;
        break;
      }
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
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      next.keyPositions = normalized.keyPositions;
      next.statPositions = normalized.statPositions;
      next.graphPositions = normalized.graphPositions;
      next.knobPositions = normalized.knobPositions;
      next.layerGroups = normalized.layerGroups;
      break;
    }
  });
  return next;
};
