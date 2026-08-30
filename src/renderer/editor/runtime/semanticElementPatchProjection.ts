import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import { isEditorShadowPropertyPatchV1 } from '@src/types/editor';
import type {
  CanonicalEditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';
import {
  isCounterFillPropertyPatchV1,
  projectCounterFillPatch,
} from '@src/types/key/counterFill';
import {
  applyImageTransformLeaf,
  type ImageTransform,
} from '@src/types/key/imageLayer';
import {
  isNotePaintPropertyPatchV1,
  mirrorBodyPaintToGlow,
  projectNotePaintPatch,
} from '@src/types/key/notePaint';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  implicitCounterFontBold,
  implicitElementFontBold,
} from '@utils/core/fontWeights';

type PatchElementOp = Extract<EditorOpV1, { kind: 'patchElement' }>;

export const applySemanticElementPatch = (
  next: CanonicalEditorDocumentV1,
  op: PatchElementOp,
  result: EditorOpResultV1 | undefined,
  SEMANTIC_POSITION_FIELDS: Record<EditorElementTypeV1, EditorField>,
): void => {
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
                ...('bezier' in intent ? { bezier: [...intent.bezier] } : {}),
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
};
