import type { KeyPosition } from '@src/types/key/keys';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import {
  patchCounterAnimationEnabledByTargets,
  patchCounterEnabledByTargets,
  patchCounterLayoutByTargets,
  patchCounterTypographyByTargets,
  patchNotePaintByIds,
  patchCounterFillByTargets,
  patchSoundEnabledByIds,
  patchSoundVolumeByIds,
} from '@src/renderer/editor/runtime/operations/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/intent/elementIntent';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { getEditSessionTarget } from '@src/renderer/editor/runtime/intent/editSessionTarget';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import { BATCH_STYLE_SOUND_PAGE_KEY } from './BatchStyleTabContent';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { captureEditorDocument } from '@src/renderer/editor/runtime/coordinator/editorStateCoordinator';
import type {
  EditorNotePaintPropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
} from '@src/types/editor';
import { projectNotePaintPatch } from '@src/types/key/notePaint';
import {
  createPaintHandlers,
  createShadowCommitHandler,
  createStylePropertyHandlers,
} from './batchPanelShared';

interface UseBatchKeyLikeCommitRuntimeOptions {
  selectedBatchStyleElements: SelectedElement[];
  selectedKeyElements: SelectedElement[];
  selectedStatElements: SelectedElement[];
  selectedKnobElements: SelectedElement[];
  selectedKeyType: string;
  batchCounterColorState: 'idle' | 'active';
  activePageKey: string | null;
}

export const useBatchKeyLikeCommitRuntime = ({
  selectedBatchStyleElements,
  selectedKeyElements,
  selectedStatElements,
  selectedKnobElements,
  selectedKeyType,
  batchCounterColorState,
  activePageKey,
}: UseBatchKeyLikeCommitRuntimeOptions) => {
  const counterTargets = [
    ...selectedKeyElements.map(({ id }) => ({
      elementType: 'key' as const,
      id,
    })),
    ...selectedStatElements.map(({ id }) => ({
      elementType: 'stat' as const,
      id,
    })),
  ];
  const stableCounterTargets =
    counterTargets.length > 0 &&
    counterTargets.every(({ id }) => id.length > 0 && isNativeElementId(id))
      ? counterTargets
      : null;
  const textPropertyTargets = selectedBatchStyleElements.map(
    ({ type, id }) => ({
      elementType: type as 'key' | 'stat' | 'graph' | 'knob',
      id,
    }),
  );
  const { previewStyleProperty, commitStyleProperty } =
    createStylePropertyHandlers(textPropertyTargets, selectedKeyType);
  const { previewPaint, commitPaint } = createPaintHandlers(
    textPropertyTargets,
    selectedKeyType,
  );
  const shadowTargets = [
    ...selectedKeyElements.map(({ id }) => ({
      elementType: 'key' as const,
      id,
    })),
    ...selectedStatElements.map(({ id }) => ({
      elementType: 'stat' as const,
      id,
    })),
    ...selectedKnobElements.map(({ id }) => ({
      elementType: 'knob' as const,
      id,
    })),
  ];
  const commitShadow = createShadowCommitHandler(shadowTargets);
  const { commitStyleProperty: commitNoteStyleProperty } =
    createStylePropertyHandlers(
      selectedKeyElements.map(({ id }) => ({
        elementType: 'key',
        id,
      })),
      selectedKeyType,
      { settleGesture: false },
    );
  const notePaintIds = selectedKeyElements.map(({ id }) => id);
  const stableNotePaintIds =
    notePaintIds.length > 0 &&
    notePaintIds.every((id) => id.length > 0 && isNativeElementId(id)) &&
    new Set(notePaintIds).size === notePaintIds.length
      ? notePaintIds
      : null;
  // 따라가기 대상이 하나라도 있으면 글로우 페인트는 보내지 않는다 - 백엔드가
  // 그 키 때문에 배치 transition 전체를 거부한다. 잠긴 뒤 늦게 도착한 피커
  // 콜백을 여기서 거른다
  const glowPaintLockedForSelection = (
    patch: EditorNotePaintPropertyPatchV1,
  ): boolean => {
    if (patch.property !== 'noteGlowPaint' || !stableNotePaintIds) return false;
    const document = captureEditorDocument();
    return stableNotePaintIds.some((id) => {
      const locator = resolveElementById('key', id);
      const current = locator
        ? document.keyPositions[locator.mode]?.[locator.index]
        : undefined;
      return current?.id === id && current.noteGlowSyncPaint === true;
    });
  };
  // 영구 실패 시 로컬 대표값 복원 - 피커 로컬 상태(useBatchNotePaint)가 아래에서
  // 만들어지므로 실패 콜백 시점에 읽도록 늦게 묶는다
  const notePaintFailureRestore: {
    current?: (patch: EditorNotePaintPropertyPatchV1) => void;
  } = {};
  const bindNotePaintFailureRestore = (
    restore: (patch: EditorNotePaintPropertyPatchV1) => void,
  ) => {
    notePaintFailureRestore.current = restore;
  };
  const commitNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        if (glowPaintLockedForSelection(patch)) return;
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchNotePaintByIds(stableNotePaintIds, patch, {
          gestureId,
        });
        // 커밋 시점 지문 - 실패가 돌아왔을 때 선택이 바뀌었으면 새 선택의 로컬 상태를
        // 옛 대표값으로 덮지 않는다 (settleCommit과 같은 기준)
        const committedTarget = getEditSessionTarget();
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          if (getEditSessionTarget() === committedTarget) {
            notePaintFailureRestore.current?.(patch);
          }
          reportElementOpError(error);
        });
      }
    : undefined;
  const previewNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        if (glowPaintLockedForSelection(patch)) return;
        const entries: Array<{
          id: string;
          patch: Partial<KeyPosition>;
        }> = [];
        // canonical 전달 - 동기화 켜진 키의 글로우 미러가 낙관 적용과 같은 규칙
        const document = captureEditorDocument();
        for (const id of stableNotePaintIds) {
          const locator = resolveElementById('key', id);
          if (!locator || locator.mode !== selectedKeyType) return;
          const current = document.keyPositions[locator.mode]?.[locator.index];
          entries.push({
            id,
            patch: projectNotePaintPatch(
              patch,
              current?.id === id ? current : undefined,
            ),
          });
        }
        editGestureController.preview(selectedKeyType, entries, {
          domain: 'keyPosition',
        });
      }
    : undefined;
  const counterFillTargets = [
    ...selectedKeyElements.map(({ id }) => ({
      elementType: 'key' as const,
      id,
    })),
    ...(batchCounterColorState === 'active'
      ? []
      : selectedStatElements.map(({ id }) => ({
          elementType: 'stat' as const,
          id,
        }))),
  ];
  const stableCounterFillTargets =
    counterFillTargets.length > 0 &&
    counterFillTargets.every(
      ({ id }) => id.length > 0 && isNativeElementId(id),
    ) &&
    new Set(counterFillTargets.map(({ id }) => id)).size ===
      counterFillTargets.length
      ? counterFillTargets
      : null;
  const commitCounterFill = stableCounterFillTargets
    ? (patch: EditorCounterFillPropertyPatchV1) => {
        const persisted = patchCounterFillByTargets(
          stableCounterFillTargets,
          patch,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const soundTargets = selectedKeyElements.map(({ id }) => id);
  const stableSoundTargets =
    soundTargets.length > 0 &&
    soundTargets.every((id) => id.length > 0 && isNativeElementId(id))
      ? soundTargets
      : null;
  const commitSoundEnabled = stableSoundTargets
    ? (soundEnabled: boolean) => {
        const persisted = patchSoundEnabledByIds(
          stableSoundTargets,
          soundEnabled,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitSoundVolume = stableSoundTargets
    ? (soundVolume: number) => {
        const persisted = patchSoundVolumeByIds(
          stableSoundTargets,
          soundVolume,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterEnabled = stableCounterTargets
    ? (enabled: boolean) => {
        const persisted = patchCounterEnabledByTargets(
          stableCounterTargets,
          enabled,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterAnimationEnabled = stableCounterTargets
    ? (enabled: boolean) => {
        const persisted = patchCounterAnimationEnabledByTargets(
          stableCounterTargets,
          enabled,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterLayout = stableCounterTargets
    ? (
        patch: import('@src/types/editor').EditorCounterLayoutPropertyPatchV1,
      ) => {
        const persisted = patchCounterLayoutByTargets(
          stableCounterTargets,
          patch,
        );
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterTypography = stableCounterTargets
    ? (
        patch: import('@src/types/editor').EditorCounterTypographyPropertyPatchV1,
        options?: { gestureId?: string },
      ) => {
        const persisted = options?.gestureId
          ? patchCounterTypographyByTargets(stableCounterTargets, patch, {
              gestureId: options.gestureId,
            })
          : patchCounterTypographyByTargets(stableCounterTargets, patch);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const soundBinding = useBatchElementBinding(
    activePageKey === BATCH_STYLE_SOUND_PAGE_KEY,
    () => captureBatchElementBinding({ key: selectedKeyElements }),
  );

  return {
    previewStyleProperty,
    commitStyleProperty,
    previewPaint,
    commitPaint,
    commitShadow,
    commitNoteStyleProperty,
    notePaintIds,
    bindNotePaintFailureRestore,
    commitNotePaint,
    previewNotePaint,
    counterFillTargets,
    commitCounterFill,
    commitSoundEnabled,
    commitSoundVolume,
    commitCounterEnabled,
    commitCounterAnimationEnabled,
    commitCounterLayout,
    commitCounterTypography,
    soundBinding,
  };
};
