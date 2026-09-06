import type {
  CanonicalEditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';
import { mirrorBodyPaintToGlow } from '@src/types/key/notePaint';
import { implicitElementFontBold } from '@utils/typography/fontWeights';
import {
  projectSemanticElementCounterPatch,
  type SemanticElementCounterPatch,
} from './semanticElementCounterPatchProjection';
import {
  projectSemanticElementImagePatch,
  type SemanticElementImagePatch,
} from './semanticElementImagePatchProjection';
import {
  projectSemanticElementPaintPatch,
  type SemanticElementPaintPatch,
} from './semanticElementPaintPatchProjection';

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
        const imageProjection = projectSemanticElementImagePatch(position, op);
        if (imageProjection !== undefined) return imageProjection;
        const counterProjection = projectSemanticElementCounterPatch(
          position,
          op,
        );
        if (counterProjection !== undefined) return counterProjection;
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
        const paintProjection = projectSemanticElementPaintPatch(position, op);
        if (paintProjection !== undefined) return paintProjection;
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
        const unhandled: never = op.patch as Exclude<
          typeof op.patch,
          | SemanticElementImagePatch
          | SemanticElementCounterPatch
          | SemanticElementPaintPatch
        >;
        void unhandled;
        return position;
      }),
    } as never;
    break;
  }
  return;
};
