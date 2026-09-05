import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { captureEditorDocument } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { reportElementOpSkipped } from '@src/renderer/editor/runtime/elementIntent';
import {
  commitElementGeometryById,
  patchActiveImageById,
  patchActiveImageFitById,
  patchActiveTransparentById,
  patchCounterAnimationEnabledById,
  patchCounterAnimationPresetById,
  patchCounterEnabledById,
  patchCounterFillById,
  patchCounterLayoutById,
  patchCounterTypographyById,
  patchElementPropertyById,
  patchIdleImageFitById,
  patchIdleTransparentById,
  patchInactiveImageById,
  patchNotePaintById,
  patchPaintById,
  patchShadowById,
  patchSoundEnabledById,
  patchSoundPathById,
  patchSoundVolumeById,
  patchStylePropertyById,
  type GeometryField,
} from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorCounterAnimationPresetIntentV1,
  EditorCounterFillPropertyPatchV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorElementPropertyPatchV1,
  EditorElementTypeV1,
  EditorNotePaintPropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import type { ImageFit } from '@src/types/key/keys';
import { projectNotePaintPatch } from '@src/types/key/notePaint';
import {
  previewSinglePaint,
  previewSingleStyleProperty,
} from './previewPatchForwarders';
import { geometryAxisPatch } from './propertyPanelAdapters';

const commitSingleGeometry = (
  type: EditorElementTypeV1,
  id: string,
  field: GeometryField,
  value: number,
) => {
  const patch = geometryAxisPatch(field, value);
  // 네 종류 모두 숫자 입력이 preview 게스처를 열므로 커밋이 그 게스처를 정산한다
  const gestureId = editGestureController.activeGestureId() ?? undefined;
  const persisted = commitElementGeometryById(type, id, patch, { gestureId });
  editGestureController.settleCommit(persisted);
  void persisted.catch((error) => {
    console.error('Failed to update element geometry', error);
  });
};

const stableGeometryHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (field: GeometryField, value: number) =>
        commitSingleGeometry(type, id, field, value)
    : undefined;

const stableGeometryPreviewHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (field: GeometryField, value: number) => {
        const locator = resolveElementById(type, id);
        if (!locator) return;
        editGestureController.preview(
          locator.mode,
          [
            {
              id,
              patch: geometryAxisPatch(field, value),
            },
          ],
          {
            domain:
              type === 'key'
                ? 'keyPosition'
                : type === 'stat'
                ? 'statPosition'
                : type === 'graph'
                ? 'graphPosition'
                : 'knobPosition',
          },
        );
      }
    : undefined;

const stableElementPropertyCommitHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (
        patch: EditorElementPropertyPatchV1,
        options?: { gestureId?: string },
      ) => {
        // 분리 창도 즉시 반영을 거친다 - RPC 왕복 전에 값이 되돌아가는 깜빡임 방지
        // 그래프 색과 키 이미지 변환은 preview 게스처를 정산하고,
        // 그 외는 호출부가 준 gestureId만 공유
        const settlesGesture =
          (type === 'graph' && patch.property === 'graphColor') ||
          (type === 'key' &&
            (patch.property === 'idleImageTransform' ||
              patch.property === 'activeImageTransform'));
        const gestureId =
          options?.gestureId ??
          (settlesGesture
            ? editGestureController.activeGestureId() ?? undefined
            : undefined);
        const persisted = patchElementPropertyById(
          type,
          id,
          patch,
          gestureId ? { gestureId } : {},
        );
        if (settlesGesture) {
          editGestureController.settleCommit(persisted);
        }
        void persisted.catch((error) => {
          console.error('Failed to update element property', error);
        });
      }
    : undefined;

const stableInactiveImageHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (inactiveImage: string) => {
        const persisted = patchInactiveImageById(type, id, inactiveImage);
        void persisted.catch((error) => {
          console.error('Failed to update inactive image', error);
        });
      }
    : undefined;

const stableActiveImageHandler = (
  type: 'key' | 'knob',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (activeImage: string) => {
        const persisted = patchActiveImageById(type, id, activeImage);
        void persisted.catch((error) => {
          console.error('Failed to update active image', error);
        });
      }
    : undefined;

const stableIdleTransparentHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (idleTransparent: boolean) => {
        const persisted = patchIdleTransparentById(type, id, idleTransparent);
        void persisted.catch((error) => {
          console.error('Failed to update idle transparency', error);
        });
      }
    : undefined;

const stableActiveTransparentHandler = (
  type: 'key' | 'knob',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (activeTransparent: boolean) => {
        const persisted = patchActiveTransparentById(
          type,
          id,
          activeTransparent,
        );
        void persisted.catch((error) => {
          console.error('Failed to update active transparency', error);
        });
      }
    : undefined;

const stableIdleImageFitHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (idleImageFit: ImageFit) => {
        const persisted = patchIdleImageFitById(type, id, idleImageFit);
        void persisted.catch((error) => {
          console.error('Failed to update idle image fit', error);
        });
      }
    : undefined;

const stableActiveImageFitHandler = (
  type: 'key' | 'knob',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (activeImageFit: ImageFit) => {
        const persisted = patchActiveImageFitById(type, id, activeImageFit);
        void persisted.catch((error) => {
          console.error('Failed to update active image fit', error);
        });
      }
    : undefined;

const stableSoundPathHandler = (id: string | undefined) =>
  id && isNativeElementId(id)
    ? (soundPath: string) => {
        const persisted = patchSoundPathById(id, soundPath);
        void persisted.catch((error) => {
          console.error('Failed to update sound path', error);
        });
      }
    : undefined;

const stableSoundEnabledHandler = (id: string | undefined) =>
  id && isNativeElementId(id)
    ? (soundEnabled: boolean) => {
        const persisted = patchSoundEnabledById(id, soundEnabled);
        void persisted.catch((error) => {
          console.error('Failed to update sound enabled', error);
        });
      }
    : undefined;

const stableSoundVolumeHandler = (id: string | undefined) =>
  id && isNativeElementId(id)
    ? (soundVolume: number) => {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchSoundVolumeById(id, soundVolume, {
          gestureId,
        });
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          console.error('Failed to update sound volume', error);
        });
      }
    : undefined;

const stableStylePropertyPreviewHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorStylePropertyPreviewPatchV1) =>
        previewSingleStyleProperty(type, id, patch)
    : undefined;

const stableStylePropertyCommitHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
  options: { settleGesture?: boolean } = {},
) =>
  id && isNativeElementId(id)
    ? (patch: EditorPreviewStylePropertyPatchV1) => {
        const gestureId = options.settleGesture
          ? editGestureController.activeGestureId() ?? undefined
          : undefined;
        const persisted = patchStylePropertyById(type, id, patch, {
          gestureId,
        });
        if (options.settleGesture) {
          editGestureController.settleCommit(persisted);
        }
        void persisted.catch((error) => {
          console.error('Failed to update style property', error);
        });
      }
    : undefined;

const stablePaintCommitHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorPaintPropertyPatchV1) => {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchPaintById(type, id, patch, { gestureId });
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          console.error('Failed to update paint', error);
        });
      }
    : undefined;

const stablePaintPreviewHandler = (
  type: EditorElementTypeV1,
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorPaintPropertyPatchV1) => previewSinglePaint(type, id, patch)
    : undefined;

const stableShadowCommitHandler = (
  type: 'key' | 'stat' | 'knob',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorShadowPropertyPatchV1) => {
        // 스크럽·타이핑 preview 게스처를 이 커밋으로 정산 - 실패 시 lifecycle까지 폐기되게 id 동반
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchShadowById(type, id, patch, { gestureId });
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          console.error('Failed to update shadow', error);
        });
      }
    : undefined;

const stableNotePaintCommitHandler = (id: string | undefined) =>
  id && isNativeElementId(id)
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchNotePaintById(id, patch, { gestureId });
        editGestureController.settleCommit(persisted);
        void persisted
          .then((applied) => {
            // 가드 거부(false)는 rejection이 아니라서 별도 로그가 없으면 무음
            if (!applied) {
              reportElementOpSkipped('single note paint');
            }
          })
          .catch((error) => {
            console.error('Failed to update note paint', error);
          });
      }
    : undefined;

const stableNotePaintPreviewHandler = (id: string | undefined) =>
  id && isNativeElementId(id)
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        const locator = resolveElementById('key', id);
        if (!locator) return;
        // canonical 전달 - 동기화 켜진 키의 글로우 미러가 낙관 적용과 같은 규칙
        const current =
          captureEditorDocument().keyPositions[locator.mode]?.[locator.index];
        editGestureController.preview(
          locator.mode,
          [
            {
              id,
              patch: projectNotePaintPatch(
                patch,
                current?.id === id ? current : undefined,
              ),
            },
          ],
          { domain: 'keyPosition' },
        );
      }
    : undefined;

const stableCounterAnimationPresetHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (intent: EditorCounterAnimationPresetIntentV1) => {
        const persisted = patchCounterAnimationPresetById(
          elementType,
          id,
          intent,
        );
        void persisted.catch((error) => {
          console.error('Failed to update counter animation preset', error);
        });
      }
    : undefined;

const stableCounterEnabledHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (enabled: boolean) => {
        // 분리 창도 즉시 반영을 거친다 - 배치 경로와 같은 래퍼를 대상 하나로 재사용
        const persisted = patchCounterEnabledById(elementType, id, enabled);
        void persisted.catch((error) => {
          console.error('Failed to update counter enabled', error);
        });
      }
    : undefined;

const stableCounterAnimationEnabledHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (enabled: boolean) => {
        const persisted = patchCounterAnimationEnabledById(
          elementType,
          id,
          enabled,
        );
        void persisted.catch((error) => {
          console.error('Failed to update counter animation enabled', error);
        });
      }
    : undefined;

const stableCounterLayoutHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorCounterLayoutPropertyPatchV1) => {
        const persisted = patchCounterLayoutById(elementType, id, patch);
        void persisted.catch((error) => {
          console.error('Failed to update counter layout', error);
        });
      }
    : undefined;

const stableCounterTypographyHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (
        patch: EditorCounterTypographyPropertyPatchV1,
        options?: { gestureId?: string },
      ) => {
        const persisted = options?.gestureId
          ? patchCounterTypographyById(elementType, id, patch, {
              gestureId: options.gestureId,
            })
          : patchCounterTypographyById(elementType, id, patch);
        void persisted.catch((error) => {
          console.error('Failed to update counter typography', error);
        });
      }
    : undefined;

const stableCounterFillHandler = (
  elementType: 'key' | 'stat',
  id: string | undefined,
) =>
  id && isNativeElementId(id)
    ? (patch: EditorCounterFillPropertyPatchV1) => {
        const persisted = patchCounterFillById(elementType, id, patch);
        void persisted.catch((error) => {
          console.error('Failed to update counter fill', error);
        });
      }
    : undefined;

// ============================================================================

export const singleSelectionHandlers = {
  stableGeometryHandler,
  stableGeometryPreviewHandler,
  stableElementPropertyCommitHandler,
  stableInactiveImageHandler,
  stableActiveImageHandler,
  stableIdleTransparentHandler,
  stableActiveTransparentHandler,
  stableIdleImageFitHandler,
  stableActiveImageFitHandler,
  stableSoundPathHandler,
  stableSoundEnabledHandler,
  stableSoundVolumeHandler,
  stableStylePropertyPreviewHandler,
  stableStylePropertyCommitHandler,
  stablePaintCommitHandler,
  stablePaintPreviewHandler,
  stableShadowCommitHandler,
  stableNotePaintCommitHandler,
  stableNotePaintPreviewHandler,
  stableCounterAnimationPresetHandler,
  stableCounterEnabledHandler,
  stableCounterAnimationEnabledHandler,
  stableCounterLayoutHandler,
  stableCounterTypographyHandler,
  stableCounterFillHandler,
};
