/**
 * 태그 patch를 프리뷰 오버레이 위치 조각으로 변환해 전달하는 forwarder
 * 태그 patch를 그대로 스프레드하면 property/value 리터럴 키가 위치 객체를
 * 오염시키므로 프리뷰 진입 전 반드시 projection을 거친다
 */
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { captureEditorDocument } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { projectFontColorPatch } from '@src/types/key/fontColor';
import { paintPropertyFields, projectPaintDescriptor } from '@src/types/color';
import type {
  EditorElementTypeV1,
  EditorFontColorPropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
} from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import type { PreviewDomain } from '@src/types/preview';

type PreviewTargetType = 'key' | 'stat' | 'graph' | 'knob';

interface PreviewTarget {
  elementType: PreviewTargetType;
  id: string;
}

const previewDomainOf = (type: PreviewTargetType): PreviewDomain =>
  type === 'key'
    ? 'keyPosition'
    : type === 'stat'
    ? 'statPosition'
    : type === 'graph'
    ? 'graphPosition'
    : 'knobPosition';

// nullable leaf의 null은 eager intent 경로와 동일하게 undefined로 투영
export const projectPreviewStylePropertyPatch = (
  patch: EditorPreviewStylePropertyPatchV1,
): Record<string, unknown> => ({
  [patch.property]: patch.value ?? undefined,
});

export const previewSingleStyleProperty = (
  type: EditorElementTypeV1,
  id: string,
  patch: EditorPreviewStylePropertyPatchV1,
): void => {
  const locator = resolveElementById(type, id);
  if (!locator) return;
  // locator는 mode 해석·존재 확인 전용 - 신원은 id가 결정
  editGestureController.preview(
    locator.mode,
    [
      {
        id,
        patch: projectPreviewStylePropertyPatch(patch),
      },
    ],
    { domain: previewDomainOf(type) },
  );
};

export const previewBatchStyleProperty = (
  targets: readonly PreviewTarget[],
  selectedKeyType: string,
  patch: EditorPreviewStylePropertyPatchV1,
): void => {
  const grouped = new Map<
    PreviewTargetType,
    Array<{ id: string; patch: Record<string, unknown> }>
  >();
  for (const target of targets) {
    const locator = resolveElementById(target.elementType, target.id);
    if (!locator || locator.mode !== selectedKeyType) return;
    const entries = grouped.get(target.elementType) ?? [];
    entries.push({
      id: target.id,
      patch: projectPreviewStylePropertyPatch(patch),
    });
    grouped.set(target.elementType, entries);
  }
  for (const [type, entries] of grouped) {
    editGestureController.preview(selectedKeyType, entries, {
      domain: previewDomainOf(type),
    });
  }
};

export const previewBatchFontColor = (
  targets: readonly PreviewTarget[],
  selectedKeyType: string,
  patch: EditorFontColorPropertyPatchV1,
): void => {
  const document = captureEditorDocument();
  const grouped = new Map<
    PreviewTargetType,
    Array<{ id: string; patch: Record<string, unknown> }>
  >();
  for (const target of targets) {
    const locator = resolveElementById(target.elementType, target.id);
    if (!locator || locator.mode !== selectedKeyType) return;
    const collection =
      target.elementType === 'key'
        ? document.keyPositions
        : target.elementType === 'stat'
        ? document.statPositions
        : target.elementType === 'graph'
        ? document.graphPositions
        : document.knobPositions;
    const current = collection[locator.mode]?.[locator.index] as
      | KeyPosition
      | undefined;
    if (!current) return;
    const entries = grouped.get(target.elementType) ?? [];
    // commit의 eager intent와 동일하게 active fallback 보존을 포함해 투영
    entries.push({
      id: target.id,
      patch: projectFontColorPatch(current, target.elementType, patch),
    });
    grouped.set(target.elementType, entries);
  }
  for (const [type, entries] of grouped) {
    editGestureController.preview(selectedKeyType, entries, {
      domain: previewDomainOf(type),
    });
  }
};

export const previewSingleFontColor = (
  type: PreviewTargetType,
  id: string,
  patch: EditorFontColorPropertyPatchV1,
): void => {
  const locator = resolveElementById(type, id);
  if (!locator) return;
  previewBatchFontColor([{ elementType: type, id }], locator.mode, patch);
};

export const previewBatchPaint = (
  targets: readonly PreviewTarget[],
  selectedKeyType: string,
  patch: EditorPaintPropertyPatchV1,
): void => {
  const document = captureEditorDocument();
  const active = paintPropertyFields(patch.property).active;
  const grouped = new Map<
    PreviewTargetType,
    Array<{ id: string; patch: Record<string, unknown> }>
  >();
  for (const target of targets) {
    if (
      active &&
      target.elementType !== 'key' &&
      target.elementType !== 'knob'
    ) {
      continue;
    }
    const locator = resolveElementById(target.elementType, target.id);
    if (!locator || locator.mode !== selectedKeyType) return;
    const collection =
      target.elementType === 'key'
        ? document.keyPositions
        : target.elementType === 'stat'
        ? document.statPositions
        : target.elementType === 'graph'
        ? document.graphPositions
        : document.knobPositions;
    const current = collection[locator.mode]?.[locator.index] as
      | (Record<string, unknown> & { id: string })
      | undefined;
    if (!current) return;
    const entries = grouped.get(target.elementType) ?? [];
    entries.push({
      id: target.id,
      patch: projectPaintDescriptor(
        current,
        target.elementType,
        patch.property,
        patch.value,
      ),
    });
    grouped.set(target.elementType, entries);
  }
  for (const [type, entries] of grouped) {
    editGestureController.preview(selectedKeyType, entries, {
      domain: previewDomainOf(type),
    });
  }
};

export const previewSinglePaint = (
  type: PreviewTargetType,
  id: string,
  patch: EditorPaintPropertyPatchV1,
): void => {
  const locator = resolveElementById(type, id);
  if (!locator) return;
  previewBatchPaint([{ elementType: type, id }], locator.mode, patch);
};

export const previewBatchGraphColor = (
  ids: readonly string[],
  selectedKeyType: string,
  color: string,
): void => {
  const entries: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const id of ids) {
    const locator = resolveElementById('graph', id);
    if (!locator || locator.mode !== selectedKeyType) return;
    entries.push({ id, patch: { graphColor: color } });
  }
  editGestureController.preview(selectedKeyType, entries, {
    domain: 'graphPosition',
  });
};

export const previewSingleGraphColor = (id: string, color: string): void => {
  const locator = resolveElementById('graph', id);
  if (!locator) return;
  previewBatchGraphColor([id], locator.mode, color);
};
