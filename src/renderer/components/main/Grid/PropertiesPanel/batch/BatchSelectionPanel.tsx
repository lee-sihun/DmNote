/* eslint-disable react-hooks/refs */
import React from 'react';
import type { KeyPosition, NoteColor } from '@src/types/key/keys';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import { paintPropertyFields } from '@src/types/color';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useEditStatePreviewPublisher } from '@stores/grid/useEditStatePreviewStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  normalizeCounterSettings,
  createDefaultCounterSettings,
} from '@src/types/key/keys';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  ColorInput,
  Tabs,
  BatchStyleTabContent,
  BatchNoteTabContent,
  BatchCounterTabContent,
  TABS,
  TabType,
} from '../index';
import BatchGeometrySection from './BatchGeometrySection';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import EditSessionBoundary from '../EditSessionBoundary';
import type { ElementIdSelection } from '@hooks/pickers/useBatchElementBinding';
import {
  patchActiveImageByTargets,
  patchActiveTransparentByTargets,
  patchCounterAnimationEnabledByTargets,
  patchCounterEnabledByTargets,
  patchCounterLayoutByTargets,
  patchCounterTypographyByTargets,
  patchPaintByTargets,
  patchShadowByTargets,
  patchNotePaintByIds,
  patchCounterFillByTargets,
  patchStylePropertyByTargets,
  patchInactiveImageByTargets,
  patchIdleTransparentByTargets,
  patchSoundEnabledByIds,
  patchSoundVolumeByIds,
  patchSoundPathByIds,
} from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import { usePanelNav } from '../PanelNavContext';
import { BATCH_COUNTER_ANIMATION_PAGE_KEY } from './BatchCounterTabContent';
import { BATCH_STYLE_SOUND_PAGE_KEY } from './BatchStyleTabContent';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { captureEditorDocument } from '@src/renderer/editor/runtime/editorStateCoordinator';
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
} from '@src/types/editor';
import { projectNotePaintPatch } from '@src/types/key/notePaint';
import {
  previewBatchGraphColor,
  previewBatchPaint,
  previewBatchStyleProperty,
} from '../previewPatchForwarders';
import {
  hexWithAlphaPercent,
  parseAlphaPercent,
  toRgbHexColor,
} from '@utils/color/colorUtils';
import type { BatchElementPropertyUpdate } from '../types';
import { useBatchNotePaint, type BatchNoteSurface } from './useBatchNotePaint';

const NATIVE_IMAGE_TYPES = ['key', 'stat', 'graph', 'knob'] as const;

const createStylePropertyHandlers = (
  targets: readonly {
    elementType: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
  }[],
  selectedKeyType: string,
  options: { settleGesture?: boolean } = { settleGesture: true },
) => {
  const stableTargets =
    targets.length > 0 &&
    targets.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
    new Set(targets.map(({ id }) => id)).size === targets.length
      ? targets
      : null;
  if (!stableTargets) {
    return {
      previewStyleProperty: undefined,
      commitStyleProperty: undefined,
    };
  }
  return {
    previewStyleProperty: (patch: EditorPreviewStylePropertyPatchV1) =>
      previewBatchStyleProperty(stableTargets, selectedKeyType, patch),
    commitStyleProperty: (patch: EditorPreviewStylePropertyPatchV1) => {
      const gestureId = options.settleGesture
        ? editGestureController.activeGestureId() ?? undefined
        : undefined;
      const persisted = patchStylePropertyByTargets(stableTargets, patch, {
        gestureId,
      });
      if (options.settleGesture) {
        editGestureController.settleCommit(persisted);
      }
      void persisted.catch(reportElementOpError);
    },
  };
};

// 표면별 허용 타깃 - font는 라벨 렌더러가 있는 키·스탯(active는 키만)
const paintRelevantTargets = <
  T extends { elementType: 'key' | 'stat' | 'graph' | 'knob' },
>(
  targets: readonly T[],
  patch: EditorPaintPropertyPatchV1,
): readonly T[] => {
  const { active, surface } = paintPropertyFields(patch.property);
  if (surface === 'font') {
    return targets.filter(({ elementType }) =>
      active
        ? elementType === 'key'
        : elementType === 'key' || elementType === 'stat',
    );
  }
  return active
    ? targets.filter(
        ({ elementType }) => elementType === 'key' || elementType === 'knob',
      )
    : targets;
};

const createPaintHandlers = (
  targets: readonly {
    elementType: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
  }[],
  selectedKeyType: string,
) => {
  const stableTargets = (patch: EditorPaintPropertyPatchV1) => {
    const relevant = paintRelevantTargets(targets, patch);
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    return stable ? relevant : null;
  };
  return {
    previewPaint: (patch: EditorPaintPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      previewBatchPaint(stable, selectedKeyType, patch);
    },
    commitPaint: (patch: EditorPaintPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      const gestureId = editGestureController.activeGestureId() ?? undefined;
      const persisted = patchPaintByTargets(stable, patch, { gestureId });
      editGestureController.settleCommit(persisted);
      void persisted.catch(reportElementOpError);
    },
  };
};

const createShadowCommitHandler =
  (
    targets: readonly {
      elementType: 'key' | 'stat' | 'knob';
      id: string;
    }[],
  ) =>
  (patch: EditorShadowPropertyPatchV1) => {
    const relevant =
      patch.property === 'activeShadow'
        ? targets.filter(({ elementType }) => elementType !== 'stat')
        : targets;
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    if (!stable) {
      return;
    }
    const persisted = patchShadowByTargets(relevant, patch);
    void persisted.catch(reportElementOpError);
  };

const commitBoundInactiveImage = (
  selection: ElementIdSelection,
  inactiveImage: string,
) => {
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchInactiveImageByTargets(targets, inactiveImage);
  void persisted.catch(reportElementOpError);
};

const commitBoundActiveImage = (
  selection: ElementIdSelection,
  activeImage: string,
) => {
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchActiveImageByTargets(targets, activeImage);
  void persisted.catch(reportElementOpError);
};

const commitBoundIdleTransparent = (
  selection: ElementIdSelection,
  idleTransparent: boolean,
) => {
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchIdleTransparentByTargets(targets, idleTransparent);
  void persisted.catch(reportElementOpError);
};

const commitBoundActiveTransparent = (
  selection: ElementIdSelection,
  activeTransparent: boolean,
) => {
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchActiveTransparentByTargets(targets, activeTransparent);
  void persisted.catch(reportElementOpError);
};

const commitBoundSoundPath = (
  selection: ElementIdSelection,
  soundPath: string,
) => {
  const ids = selection.key ?? [];
  if (ids.length === 0) return;
  const persisted = patchSoundPathByIds(ids, soundPath);
  void persisted.catch(reportElementOpError);
};

// 24 그리드를 12px로 렌더 - 스트로크 2.4가 화면상 1.2
const RenameIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 20H21"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// Shared batch panel header (group rename + summed count)
// ============================================================================

interface BatchPanelHeaderProps {
  // native+plugin 합산 표시 개수
  totalCount: number;
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  t: (key: string) => string | undefined;
}

const BatchPanelHeader: React.FC<BatchPanelHeaderProps> = ({
  totalCount,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  t,
}) => (
  <div className={PANEL_HEADER_CLASS}>
    <div className="flex items-center gap-[8px]">
      {selectedGroupInfo ? (
        isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="text-fg text-label leading-none bg-transparent border-none p-0 outline-none w-[130px] caret-accent"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (!renameCancelledRef.current) {
                handleRenameCommit(renameValue);
              }
              renameCancelledRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleRenameCancel();
              }
            }}
          />
        ) : (
          <div className="flex items-center gap-[4px] min-w-0">
            <span
              className="text-fg text-label leading-none cursor-default truncate max-w-[110px]"
              onDoubleClick={handleRenameStart}
              title={selectedGroupInfo.name}
            >
              {selectedGroupInfo.name}
            </span>
            <button
              onClick={handleRenameStart}
              className="w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0"
              title={t('contextMenu.rename') || 'Rename'}
            >
              <RenameIcon />
            </button>
          </div>
        )
      ) : (
        <span className="text-fg text-label leading-none">
          {t('propertiesPanel.multiSelection') || '다중 선택'}
        </span>
      )}
      {!selectedGroupInfo && (
        <span className="text-fg-faint text-body">({totalCount})</span>
      )}
    </div>
  </div>
);

// ============================================================================
// Mixed key-like + graph batch selection panel
// ============================================================================

type BatchPickerTarget =
  | 'noteColor'
  | 'glowColor'
  | 'borderColor'
  | 'fill'
  | null;

type MixedValueResult<T> = { isMixed: boolean; value: T };
type MixedValueGetter<P> = <T>(
  getter: (pos: P) => T | undefined,
  defaultValue: T,
) => MixedValueResult<T>;

interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

interface BatchLocalColors {
  fillIdle: string;
  fillActive: string;
}

interface BatchKeyLikePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedBatchStyleElements: SelectedElement[];
  selectedKeyElements: SelectedElement[];
  selectedStatElements: SelectedElement[];
  selectedGraphElements: SelectedElement[];
  selectedKnobElements: SelectedElement[];
  selectedKeyLikeElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  // batch handlers
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchResizePreview: (
    dimension: 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  onNoteElementPropertyCommit?: (updates: BatchElementPropertyUpdate) => void;
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  // mixed value getters
  getMixedValue: MixedValueGetter<KeyPosition>;
  /** 프리뷰가 섞이지 않은 canonical 기준. 게스처 취소 뒤 로컬 복원용 */
  getMixedValueCanonical: MixedValueGetter<KeyPosition>;
  getMixedValueBatch: MixedValueGetter<KeyPosition>;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getMixedValueKeysOnly: MixedValueGetter<KeyPosition>;
  getMixedValueActiveCapable: MixedValueGetter<KeyPosition>;
  getSelectedKeysData: () => KeyData[];
  getSelectedGraphsData: () => KeyData[];
  getSelectedBatchStyleData: () => KeyData[];
  getSelectedKeyOnlyPositions: () => { index: number; position: KeyPosition }[];
  // refs
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchNoteColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchGlowColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchBorderColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchCounterFillButtonRef: React.RefObject<HTMLButtonElement | null>;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  // state
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  batchPickerFor: BatchPickerTarget;
  setBatchPickerFor: (value: BatchPickerTarget) => void;
  batchCounterColorState: 'idle' | 'active';
  setBatchCounterColorState: (value: 'idle' | 'active') => void;
  batchLocalColors: BatchLocalColors;
  setBatchLocalColors: React.Dispatch<React.SetStateAction<BatchLocalColors>>;
  handleBatchPickerToggle: (target: BatchPickerTarget) => void;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
  handleBatchFillPickerColorChangeComplete: (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => void;
  getBatchPickerColor: () => NoteColor | string;
  getBatchPickerRef: () => React.RefObject<HTMLButtonElement | null> | null;
  batchColorPickerInteractiveRefs: React.RefObject<HTMLButtonElement | null>[];
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchKeyLikePanel: React.FC<BatchKeyLikePanelProps> = ({
  setPanelElement,
  totalCount,
  selectedBatchStyleElements,
  selectedKeyElements,
  selectedStatElements,
  selectedKnobElements,
  selectedGraphElements,
  selectedKeyLikeElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  activeTab,
  setActiveTab,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  onNoteElementPropertyCommit,
  handleGraphBatchSharedSetting,
  getMixedValue,
  getMixedValueCanonical,
  getMixedValueBatch,
  getMixedValueGraphs,
  getMixedValueKeysOnly,
  getMixedValueActiveCapable,
  getSelectedKeysData,
  getSelectedGraphsData,
  getSelectedBatchStyleData,
  getSelectedKeyOnlyPositions,
  batchScrollRefFor,
  batchNoteColorButtonRef,
  batchGlowColorButtonRef,
  batchBorderColorButtonRef,
  batchCounterFillButtonRef,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  batchPickerFor,
  setBatchPickerFor,
  batchCounterColorState,
  setBatchCounterColorState,
  batchLocalColors,
  setBatchLocalColors,
  handleBatchPickerToggle,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  handleBatchFillPickerColorChangeComplete,
  getBatchPickerColor,
  getBatchPickerRef,
  batchColorPickerInteractiveRefs,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 피커 open 시점의 선택을 ID로 고정 - 대기 중 재정렬·모드 전환에도
  // 완료가 시작 시점 요소들에 적용된다
  // 결합 소유자는 이 패널이다 - EditSessionBoundary 안(탭 컴포넌트)에 두면
  // 같은 개수 선택 교체 시 리마운트로 open 중 재캡처가 일어난다
  const batchImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({
      key: selectedKeyElements,
      stat: selectedStatElements,
      graph: selectedGraphElements,
      knob: selectedKnobElements,
    }),
  );
  const idleTransparencyBinding = captureBatchElementBinding({
    key: selectedKeyElements,
    stat: selectedStatElements,
    graph: selectedGraphElements,
    knob: selectedKnobElements,
  });
  const activeTransparencyBinding = captureBatchElementBinding({
    key: selectedKeyElements,
    knob: selectedKnobElements,
  });

  // open 판정은 activePageKey다. renderPageKey는 exit 애니메이션 동안
  // 유지되는 마운트 상태라, 닫고 250ms 안에 재열면 전환이 감지되지 않아
  // 이전 결합이 재사용된다 (닫히는 동안의 옛 완료는 유지된 bound가 담당)
  const { activePageKey } = usePanelNav();
  const animationBinding = useBatchElementBinding(
    activePageKey === BATCH_COUNTER_ANIMATION_PAGE_KEY,
    () =>
      captureBatchElementBinding({
        key: selectedKeyElements,
        stat: selectedStatElements,
      }),
  );
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
  const commitNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        if (glowPaintLockedForSelection(patch)) return;
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchNotePaintByIds(stableNotePaintIds, patch, {
          gestureId,
        });
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          notePaintFailureRestore.current?.(patch);
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

  const hasGraphSelection = selectedGraphElements.length > 0;
  const styleMixedValueGetter = hasGraphSelection
    ? getMixedValueBatch
    : getMixedValue;
  const styleSelectedDataGetter = hasGraphSelection
    ? getSelectedBatchStyleData
    : getSelectedKeysData;

  const keysData = getSelectedKeysData();
  const keyOnlyPositions = getSelectedKeyOnlyPositions();

  // 배치 노트 페인트 - GradientSpec 집계·편집 (본체·글로우·테두리)
  const openNoteSurface: BatchNoteSurface | null =
    batchPickerFor === 'noteColor'
      ? 'note'
      : batchPickerFor === 'glowColor'
      ? 'glow'
      : batchPickerFor === 'borderColor'
      ? 'border'
      : null;
  const batchNotePositions =
    selectedKeyElements.length > 0
      ? keyOnlyPositions.map(({ position }) => position)
      : keysData
          .map(({ position }) => position)
          .filter((position): position is KeyPosition => position != null);
  // 선택 구성 시그니처 - 형식 왕복 기억·세션 소유가 다른 선택과 교차하지 않게
  const batchNoteSelectionKey = `${selectedKeyType}:${[...notePaintIds]
    .sort()
    .join(',')}`;
  const batchNotePaint = useBatchNotePaint({
    positions: batchNotePositions,
    open: openNoteSurface,
    selectionKey: batchNoteSelectionKey,
    commitNotePaint,
    previewNotePaint,
  });
  // 영구 실패는 canonical 재반영 신호(commitTick)가 오지 않는다. 열린 피커의
  // 로컬 대표값을 canonical에서 다시 읽어 옛 편집값이 다음 커밋에 실리지 않게
  notePaintFailureRestore.current = (patch) => {
    if (editGestureController.activeGestureId() !== null) return;
    const surface: BatchNoteSurface =
      patch.property === 'notePaint'
        ? 'note'
        : patch.property === 'noteGlowPaint'
        ? 'glow'
        : 'border';
    const state = batchNotePaint.states[surface];
    if (state.format === 'gradient') {
      // 스톱 초안만 버리면 저장값 spec이 다시 제시된다
      state.cancelPreview();
      return;
    }
    if (surface === 'border') {
      batchNotePaint.previewBorderSolid(
        hexWithAlphaPercent(
          getMixedValueCanonical((pos) => pos.noteBorderColor, '#FFFFFF').value,
          getMixedValueCanonical((pos) => pos.noteBorderOpacity, 100).value,
        ),
      );
      return;
    }
    const color = getMixedValueCanonical(
      (pos) =>
        surface === 'note' ? pos.noteColor : pos.noteGlowColor ?? pos.noteColor,
      '#FFFFFF' as NoteColor,
    ).value;
    if (typeof color === 'string') state.handlePickerColorChange(color, false);
    if (surface === 'note') {
      batchNotePaint.setNoteOpacity(
        getMixedValueCanonical((pos) => pos.noteOpacity, 80).value,
      );
    } else {
      batchNotePaint.setGlowOpacity(
        getMixedValueCanonical((pos) => pos.noteGlowOpacity, 70).value,
      );
    }
  };
  const getBatchNoteColorDisplay = () => batchNotePaint.displays.note;
  const getBatchGlowColorDisplay = () => batchNotePaint.displays.glow;
  const getBatchBorderColorDisplay = () => batchNotePaint.displays.border;
  const firstCounterPosition =
    keyOnlyPositions[0]?.position ?? keysData[0]?.position;
  const batchCounterSettings = firstCounterPosition
    ? normalizeCounterSettings(firstCounterPosition.counter)
    : createDefaultCounterSettings();
  const selectedCounterSettings = keysData.map(({ position }) =>
    normalizeCounterSettings(position.counter),
  );
  const firstPos = keysData[0]?.position;
  const batchKeyVisual = firstPos
    ? {
        ...firstPos,
        displayName: keysData[0]?.keyInfo?.displayName,
        isStat: selectedKeyLikeElements[0]?.type === 'stat',
      }
    : undefined;
  // NOTE 탭은 키만 편집하므로 Mixed도 키 기준. 통계가 섞인 선택에서 통계 값이 Mixed를 만들지 않게
  const noteMixedFn =
    selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
  const noteOpacityMixed = noteMixedFn((pos) => pos.noteOpacity, 80).isMixed;
  const glowOpacityMixed = noteMixedFn(
    (pos) => pos.noteGlowOpacity,
    70,
  ).isMixed;
  const batchSpacing = getBatchSpacingValue();
  const graphTypeState = getMixedValueGraphs(
    (pos) => pos.graphType || 'line',
    'line' as string,
  );
  const showAvgLineState = getMixedValueGraphs(
    (pos) => pos.showAvgLine ?? true,
    true,
  );
  const graphSpeedState = getMixedValueGraphs(
    (pos) => Math.round(pos.graphSpeed || 1000),
    1000,
  );
  const graphColorState = getMixedValueGraphs(
    (pos) => pos.graphColor || '#86EFAC',
    '#86EFAC',
  );
  // 피커 칸은 hex와 알파를 따로 판단한다. 그래프 색은 rgba 문자열일 수 있다
  const graphColorMixed = {
    hex: getMixedValueGraphs(
      (pos) => toRgbHexColor(pos.graphColor || '#86EFAC'),
      '',
    ).isMixed,
    alpha: getMixedValueGraphs(
      (pos) => parseAlphaPercent(pos.graphColor || '#86EFAC'),
      100,
    ).isMixed,
  };
  const graphAnimationState = getMixedValueGraphs(
    (pos) => pos.graphAnimationEnabled ?? true,
    true,
  );
  const hasLineGraph = getSelectedGraphsData().some(
    (data) =>
      ((data.position as GraphItemPosition | undefined)?.graphType ||
        'line') === 'line',
  );
  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];

  // 배치 카운터 채움은 세션 훅 없는 ColorPicker 직결 경로 - 상태 프리뷰 직접 발행
  useEditStatePreviewPublisher(
    batchPickerFor === 'fill' && selectedKeyElements.length > 0
      ? { kind: 'batch' }
      : null,
    batchCounterColorState,
  );

  // 열린 배치 피커의 hex 칸·% 칸 Mixed. 두 칸은 따로 판단하고, 저장 표현(대소문자·rgba·hex8)이
  // 달라도 같은 색이면 공통값으로 본다. 그라데이션 형식은 선택 스톱을 편집하므로 칸 Mixed를 두지 않는다
  const batchPickerMixed = ((): { hex: boolean; alpha: boolean } => {
    const paintHex = (value: NoteColor | undefined) =>
      typeof value === 'string' ? toRgbHexColor(value) : value;
    if (
      openNoteSurface &&
      batchNotePaint.states[openNoteSurface].format === 'gradient'
    ) {
      return { hex: false, alpha: false };
    }
    switch (batchPickerFor) {
      case 'noteColor':
        return {
          hex: noteMixedFn((pos) => paintHex(pos.noteColor), '#FFFFFF').isMixed,
          alpha: noteOpacityMixed,
        };
      case 'glowColor':
        return {
          hex: noteMixedFn(
            (pos) => paintHex(pos.noteGlowColor ?? pos.noteColor),
            '#FFFFFF',
          ).isMixed,
          alpha: glowOpacityMixed,
        };
      case 'borderColor':
        return {
          hex: noteMixedFn((pos) => toRgbHexColor(pos.noteBorderColor), '')
            .isMixed,
          alpha: noteMixedFn((pos) => pos.noteBorderOpacity, 100).isMixed,
        };
      case 'fill': {
        // 입력 상태 색은 통계를 편집하지 않으므로 Mixed도 같은 집합으로
        const state = batchCounterColorState === 'active' ? 'active' : 'idle';
        const mixedFn =
          state === 'active' ? getMixedValueActiveCapable : getMixedValue;
        const colorOf = (pos: KeyPosition) =>
          normalizeCounterSettings(pos.counter).fill[state];
        return {
          hex: mixedFn((pos) => toRgbHexColor(colorOf(pos)), '').isMixed,
          alpha: mixedFn((pos) => parseAlphaPercent(colorOf(pos)), 100).isMixed,
        };
      }
      default:
        return { hex: false, alpha: false };
    }
  })();

  const getCounterColorDisplay = (target: 'fill') => {
    const key = batchCounterColorState === 'active' ? 'fillActive' : 'fillIdle';

    if (batchPickerFor === target) {
      return batchLocalColors[key];
    }

    return batchCounterColorState === 'active'
      ? batchCounterSettings.fill.active
      : batchCounterSettings.fill.idle;
  };

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      {/* 헤더 + 탭 영역 */}
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedBatchStyleElements.length}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />

        {/* 탭 */}
        <div className="px-[12px] pb-[12px]">
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
            availableTabs={
              selectedKeyElements.length > 0
                ? [TABS.STYLE, TABS.NOTE, TABS.COUNTER]
                : [TABS.STYLE, TABS.COUNTER]
            }
          />
        </div>
      </div>

      <>
        <div className="flex-1 properties-panel-overlay-scroll">
          {/* STYLE 탭 viewport */}
          <div
            ref={batchScrollRefFor(TABS.STYLE)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.STYLE ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <BatchStyleTabContent
                selectedCount={selectedBatchStyleElements.length}
                totalCount={totalCount ?? selectedBatchStyleElements.length}
                soundBinding={soundBinding}
                onSoundPathCommit={(soundPath) =>
                  commitBoundSoundPath(soundBinding.selection, soundPath)
                }
                onSoundEnabledCommit={commitSoundEnabled}
                onSoundVolumeCommit={commitSoundVolume}
                onStylePropertyPreview={previewStyleProperty}
                onStylePropertyCommit={commitStyleProperty}
                onPaintPreview={previewPaint}
                onPaintCommit={commitPaint}
                onFontColorPreview={previewPaint}
                onFontColorCommit={commitPaint}
                onShadowCommit={commitShadow}
                showSoundControls={selectedKeyElements.length > 0}
                showShadowControls={!hasGraphSelection}
                shadowActiveState={
                  selectedKeyElements.length > 0 ||
                  selectedKnobElements.length > 0
                }
                getMixedValue={styleMixedValueGetter}
                getSelectedKeysData={styleSelectedDataGetter}
                afterSizeContent={
                  hasGraphSelection ? (
                    <>
                      <PropertyRow
                        label={t('propertiesPanel.graphShape') || 'Graph Shape'}
                      >
                        {graphTypeState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <Dropdown
                          commitStrategy="after-paint"
                          options={graphShapeOptions}
                          value={graphTypeState.value}
                          onChange={(value) =>
                            handleGraphBatchSharedSetting({
                              graphType: value as GraphItemType,
                            })
                          }
                        />
                      </PropertyRow>

                      {hasLineGraph && (
                        <div className="flex justify-between items-center w-full min-h-[32px]">
                          <p className="text-fg-muted text-label">
                            {t('propertiesPanel.graphShowAverageLine') ||
                              'Show Average Line'}
                          </p>
                          <Checkbox
                            commitStrategy="after-paint"
                            checked={showAvgLineState.value}
                            onChange={() =>
                              handleGraphBatchSharedSetting({
                                showAvgLine: !showAvgLineState.value,
                              })
                            }
                          />
                        </div>
                      )}

                      <PropertyRow
                        label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}
                      >
                        {graphSpeedState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <NumberInput
                          value={graphSpeedState.value}
                          width="62px"
                          onChange={(value) => {
                            const clamped = Math.max(
                              500,
                              Math.min(5000, value),
                            );
                            const snapped = Math.round(clamped / 100) * 100;
                            handleGraphBatchSharedSetting({
                              graphSpeed: snapped,
                            });
                          }}
                          min={500}
                          max={5000}
                          suffix="ms"
                          isMixed={graphSpeedState.isMixed}
                        />
                      </PropertyRow>

                      <PropertyRow
                        label={t('propertiesPanel.graphColor') || 'Graph Color'}
                      >
                        {graphColorState.isMixed ? (
                          <span className="text-fg-faint text-body italic">
                            Mixed
                          </span>
                        ) : null}
                        <ColorInput
                          value={graphColorState.value}
                          hexMixed={graphColorMixed.hex}
                          alphaMixed={graphColorMixed.alpha}
                          onChange={() => {}}
                          onPreview={(value) =>
                            previewBatchGraphColor(
                              selectedGraphElements.map(({ id }) => id),
                              selectedKeyType,
                              value,
                            )
                          }
                          onChangeComplete={(value) =>
                            handleGraphBatchSharedSetting({
                              graphColor: value,
                            })
                          }
                          onCancel={() => editGestureController.cancel()}
                          colorId={`graph-batch-mixed-color-${selectedKeyType}`}
                          panelElement={panelElement}
                        />
                      </PropertyRow>

                      <div className="flex justify-between items-center w-full min-h-[32px]">
                        <p className="text-fg-muted text-label">
                          {t('propertiesPanel.graphAnimation') ||
                            'Graph Animation'}
                        </p>
                        <div className="flex items-center gap-[6px]">
                          {graphAnimationState.isMixed ? (
                            <span className="text-fg-faint text-body italic">
                              Mixed
                            </span>
                          ) : null}
                          <Checkbox
                            commitStrategy="after-paint"
                            checked={graphAnimationState.value}
                            onChange={() =>
                              handleGraphBatchSharedSetting({
                                graphAnimationEnabled:
                                  !graphAnimationState.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    </>
                  ) : undefined
                }
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingPreview={handleBatchSpacingPreview}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchSpacing}
                handleBatchResize={handleBatchResize}
                handleBatchResizePreview={handleBatchResizePreview}
                onElementPropertyCommit={onElementPropertyCommit}
                getKeyOnlyMixedValue={getMixedValueKeysOnly}
                getActiveCapableMixedValue={getMixedValueActiveCapable}
                showBatchImagePicker={showBatchImagePicker}
                onToggleBatchImagePicker={() =>
                  setShowBatchImagePicker(!showBatchImagePicker)
                }
                batchImageButtonRef={batchImageButtonRef}
                panelElement={panelElement}
                useCustomCSS={useCustomCSS}
                t={t}
              />
            </EditSessionBoundary>
          </div>

          {/* NOTE 탭 viewport */}
          {selectedKeyElements.length > 0 && (
            <div
              ref={batchScrollRefFor(TABS.NOTE)}
              className={`properties-panel-overlay-viewport ${
                activeTab === TABS.NOTE ? '' : 'hidden'
              }`}
            >
              <EditSessionBoundary>
                <BatchNoteTabContent
                  getMixedValue={getMixedValueKeysOnly}
                  onElementPropertyCommit={onNoteElementPropertyCommit}
                  onStylePropertyCommit={commitNoteStyleProperty}
                  getBatchNoteColorDisplay={getBatchNoteColorDisplay}
                  getBatchGlowColorDisplay={getBatchGlowColorDisplay}
                  getBatchBorderColorDisplay={getBatchBorderColorDisplay}
                  onNoteColorPickerToggle={() =>
                    handleBatchPickerToggle('noteColor')
                  }
                  onGlowColorPickerToggle={() =>
                    handleBatchPickerToggle('glowColor')
                  }
                  onBorderColorPickerToggle={() =>
                    handleBatchPickerToggle('borderColor')
                  }
                  isNoteColorPickerOpen={batchPickerFor === 'noteColor'}
                  isGlowColorPickerOpen={batchPickerFor === 'glowColor'}
                  isBorderColorPickerOpen={batchPickerFor === 'borderColor'}
                  batchNoteColorButtonRef={batchNoteColorButtonRef}
                  batchGlowColorButtonRef={batchGlowColorButtonRef}
                  batchBorderColorButtonRef={batchBorderColorButtonRef}
                  t={t}
                />
              </EditSessionBoundary>
            </div>
          )}

          {/* COUNTER 탭 viewport */}
          <div
            ref={batchScrollRefFor(TABS.COUNTER)}
            className={`properties-panel-overlay-viewport ${
              activeTab === TABS.COUNTER ? '' : 'hidden'
            }`}
          >
            <EditSessionBoundary>
              <BatchCounterTabContent
                batchCounterSettings={batchCounterSettings}
                selectedCounterSettings={selectedCounterSettings}
                keyVisual={batchKeyVisual}
                onCounterEnabledCommit={commitCounterEnabled}
                onCounterAnimationEnabledCommit={commitCounterAnimationEnabled}
                onCounterLayoutCommit={commitCounterLayout}
                onCounterTypographyCommit={commitCounterTypography}
                colorState={batchCounterColorState}
                getCounterColorDisplay={getCounterColorDisplay}
                onFillPickerToggle={() => handleBatchPickerToggle('fill')}
                batchCounterFillButtonRef={batchCounterFillButtonRef}
                isFillPickerOpen={batchPickerFor === 'fill'}
                animationBinding={animationBinding}
                t={t}
              />
            </EditSessionBoundary>
          </div>
        </div>

        {/* 배치 편집용 로컬 ColorPicker */}
        <PopupExit open={Boolean(batchPickerFor)}>
          {batchPickerFor ? (
            <ColorPicker
              open={!!batchPickerFor}
              referenceRef={getBatchPickerRef()}
              panelElement={panelElement}
              color={
                openNoteSurface
                  ? openNoteSurface === 'border' &&
                    batchNotePaint.states.border.format !== 'gradient'
                    ? hexWithAlphaPercent(
                        batchNotePaint.borderSolid,
                        batchNotePaint.borderOpacity,
                      )
                    : batchNotePaint.activeState.pickerColor
                  : getBatchPickerColor()
              }
              onColorChange={(color) => {
                if (openNoteSurface) {
                  if (typeof color !== 'string') return;
                  if (
                    openNoteSurface === 'border' &&
                    batchNotePaint.states.border.format !== 'gradient'
                  ) {
                    batchNotePaint.previewBorderSolid(color);
                    return;
                  }
                  batchNotePaint.activeState.handlePickerColorChange(
                    color,
                    false,
                  );
                  return;
                }
                handleBatchPickerColorChange(color);
              }}
              onColorChangeComplete={(color) => {
                if (openNoteSurface) {
                  if (typeof color !== 'string') return;
                  if (
                    openNoteSurface === 'border' &&
                    batchNotePaint.states.border.format !== 'gradient'
                  ) {
                    batchNotePaint.commitBorderSolid(color);
                    return;
                  }
                  batchNotePaint.activeState.handlePickerColorChange(
                    color,
                    true,
                  );
                  return;
                }
                if (
                  commitCounterFill &&
                  batchPickerFor === 'fill' &&
                  typeof color === 'string'
                ) {
                  handleBatchFillPickerColorChangeComplete(
                    color,
                    commitCounterFill,
                  );
                  return;
                }
                if (
                  batchPickerFor === 'fill' &&
                  counterFillTargets.length === 0
                ) {
                  return;
                }
                handleBatchPickerColorChangeComplete(color);
              }}
              onClose={() => setBatchPickerFor(null)}
              interactiveRefs={batchColorPickerInteractiveRefs}
              solidOnly={true}
              stateMode={
                batchPickerFor === 'fill' && selectedKeyElements.length > 0
                  ? batchCounterColorState
                  : undefined
              }
              onStateModeChange={
                batchPickerFor === 'fill' && selectedKeyElements.length > 0
                  ? setBatchCounterColorState
                  : undefined
              }
              onInputCancel={(_target, restoredColor) => {
                if (openNoteSurface) {
                  if (typeof restoredColor !== 'string') return;
                  const state = batchNotePaint.states[openNoteSurface];
                  if (
                    openNoteSurface === 'border' &&
                    state.format !== 'gradient'
                  ) {
                    batchNotePaint.previewBorderSolid(restoredColor);
                  } else {
                    state.handlePickerColorChange(restoredColor, false);
                  }
                  editGestureController.cancel();
                  return;
                }
                if (batchPickerFor === 'fill') {
                  const state =
                    batchCounterColorState === 'active' ? 'active' : 'idle';
                  setBatchLocalColors((prev) => ({
                    ...prev,
                    [state === 'active' ? 'fillActive' : 'fillIdle']:
                      batchCounterSettings.fill[state],
                  }));
                }
              }}
              hexMixed={batchPickerMixed.hex}
              opacityPercentMixed={batchPickerMixed.alpha}
              headerSlot={
                openNoteSurface
                  ? batchNotePaint.activeState.headerSlot
                  : undefined
              }
              footerSlot={
                openNoteSurface
                  ? batchNotePaint.activeState.footerSlot
                  : undefined
              }
              gradientSpec={
                openNoteSurface
                  ? batchNotePaint.activeState.paletteGradientSpec
                  : undefined
              }
              onGradientSpecSelect={
                openNoteSurface
                  ? batchNotePaint.activeState.handleGradientSpecSelect
                  : undefined
              }
              {...((openNoteSurface === 'note' || openNoteSurface === 'glow') &&
              batchNotePaint.states[openNoteSurface].format !== 'gradient'
                ? {
                    // 단색 형식의 색 알파는 저장 시 hex 변환으로 버려지므로 항상 숨긴다.
                    // 그라데이션 형식은 스톱 알파만 편집하므로 조절기를 두지 않는다
                    hideColorAlpha: true,
                  }
                : {})}
              {...((openNoteSurface === 'note' || openNoteSurface === 'glow') &&
              batchNotePaint.states[openNoteSurface].format !== 'gradient' &&
              !batchNotePaint.anyPresented[openNoteSurface]
                ? {
                    // 전부 단색인 선택에서만 투명도 조절기가 알파를 대신한다
                    opacityPercent:
                      openNoteSurface === 'note'
                        ? batchNotePaint.noteOpacity
                        : batchNotePaint.glowOpacity,
                    onOpacityPercentChange: (value: number) => {
                      if (openNoteSurface === 'note') {
                        batchNotePaint.setNoteOpacity(value);
                        previewNotePaint?.({
                          property: 'notePaint',
                          value: { opacity: value },
                        });
                        return;
                      }
                      batchNotePaint.setGlowOpacity(value);
                      previewNotePaint?.({
                        property: 'noteGlowPaint',
                        value: { opacity: value },
                      });
                    },
                    onOpacityPercentChangeComplete: (value: number) => {
                      const surface = openNoteSurface;
                      if (surface === 'note') {
                        batchNotePaint.setNoteOpacity(value);
                      } else {
                        batchNotePaint.setGlowOpacity(value);
                      }
                      // 단색 형식은 기존 배치 규약대로 {opacity} 단독 커밋 유지
                      commitNotePaint?.({
                        property:
                          surface === 'note' ? 'notePaint' : 'noteGlowPaint',
                        value: { opacity: value },
                      });
                    },
                    onOpacityPercentCancel: () => {
                      // Escape는 게스처를 통째로 되돌린다. 로컬 대표값도 canonical에서
                      // 다시 읽어야 입력이 blur 뒤 옛 preview 값으로 재동기화되지 않는다
                      editGestureController.cancel();
                      if (openNoteSurface === 'note') {
                        batchNotePaint.setNoteOpacity(
                          getMixedValueCanonical((pos) => pos.noteOpacity, 80)
                            .value,
                        );
                        return;
                      }
                      batchNotePaint.setGlowOpacity(
                        getMixedValueCanonical((pos) => pos.noteGlowOpacity, 70)
                          .value,
                      );
                    },
                    opacityPercentLabel:
                      openNoteSurface === 'note'
                        ? t('keySetting.noteOpacity') || '노트 투명도'
                        : t('keySetting.noteGlowOpacity') || '글로우 투명도',
                  }
                : {})}
            />
          ) : null}
        </PopupExit>

        {/* 다중 선택용 ImagePicker */}
        <PopupExit open={showBatchImagePicker}>
          {showBatchImagePicker && batchImageButtonRef.current ? (
            <ImagePicker
              open={showBatchImagePicker}
              previewAnchor={{ kind: 'batch' }}
              referenceRef={batchImageButtonRef}
              panelElement={panelElement}
              idleImage={
                styleMixedValueGetter((pos) => pos.inactiveImage, '').isMixed
                  ? ''
                  : styleMixedValueGetter((pos) => pos.inactiveImage, '').value
              }
              activeImage={
                getMixedValueActiveCapable((pos) => pos.activeImage, '').isMixed
                  ? ''
                  : getMixedValueActiveCapable((pos) => pos.activeImage, '')
                      .value
              }
              idleTransparent={
                styleMixedValueGetter((pos) => pos.idleTransparent, false).value
              }
              activeTransparent={
                getMixedValueActiveCapable(
                  (pos) => pos.activeTransparent,
                  false,
                ).value
              }
              completionBinding={batchImageBinding.binding}
              onIdleImageChange={(imageUrl: string) => {
                commitBoundInactiveImage(batchImageBinding.selection, imageUrl);
              }}
              onActiveImageChange={(imageUrl: string) => {
                commitBoundActiveImage(batchImageBinding.selection, imageUrl);
              }}
              onIdleTransparentChange={(value: boolean) => {
                commitBoundIdleTransparent(
                  idleTransparencyBinding.selection,
                  value,
                );
              }}
              onActiveTransparentChange={(value: boolean) => {
                commitBoundActiveTransparent(
                  activeTransparencyBinding.selection,
                  value,
                );
              }}
              onIdleImageReset={() => {
                commitBoundInactiveImage(batchImageBinding.selection, '');
              }}
              onActiveImageReset={() => {
                commitBoundActiveImage(batchImageBinding.selection, '');
              }}
              onClose={() => setShowBatchImagePicker(false)}
              showActiveState={
                selectedKeyElements.length > 0 ||
                selectedKnobElements.length > 0
              }
            />
          ) : null}
        </PopupExit>
      </>
    </div>
  );
};

// ============================================================================
// Graph-only batch selection panel
// ============================================================================

interface BatchGraphOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedGraphElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchResizePreview: (
    dimension: 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getSelectedGraphsData: () => KeyData[];
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchGraphOnlyPanel: React.FC<BatchGraphOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedGraphElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  handleGraphBatchSharedSetting,
  getMixedValueGraphs,
  getMixedValueGraphsAsKey,
  getSelectedGraphsData,
  batchScrollRefFor,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 이미지 피커 open 시점의 그래프 선택을 ID로 고정
  const graphImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({ graph: selectedGraphElements }),
  );
  const graphTransparencyBinding = captureBatchElementBinding({
    graph: selectedGraphElements,
  });
  const { previewStyleProperty, commitStyleProperty } =
    createStylePropertyHandlers(
      selectedGraphElements.map(({ id }) => ({
        elementType: 'graph',
        id,
      })),
      selectedKeyType,
    );
  const { previewPaint, commitPaint } = createPaintHandlers(
    selectedGraphElements.map(({ id }) => ({
      elementType: 'graph',
      id,
    })),
    selectedKeyType,
  );

  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];
  const graphTypeState = getMixedValueGraphs(
    (pos) => pos.graphType || 'line',
    'line' as string,
  );
  const showAvgLineState = getMixedValueGraphs(
    (pos) => pos.showAvgLine ?? true,
    true,
  );
  const graphSpeedState = getMixedValueGraphs(
    (pos) => Math.round(pos.graphSpeed || 1000),
    1000,
  );
  const graphColorState = getMixedValueGraphs(
    (pos) => pos.graphColor || '#86EFAC',
    '#86EFAC',
  );
  // 피커 칸은 hex와 알파를 따로 판단한다. 그래프 색은 rgba 문자열일 수 있다
  const graphColorMixed = {
    hex: getMixedValueGraphs(
      (pos) => toRgbHexColor(pos.graphColor || '#86EFAC'),
      '',
    ).isMixed,
    alpha: getMixedValueGraphs(
      (pos) => parseAlphaPercent(pos.graphColor || '#86EFAC'),
      100,
    ).isMixed,
  };
  const graphAnimationState = getMixedValueGraphs(
    (pos) => pos.graphAnimationEnabled ?? true,
    true,
  );
  const hasLineGraph = getSelectedGraphsData().some(
    (data) =>
      ((data.position as GraphItemPosition | undefined)?.graphType ||
        'line') === 'line',
  );
  const batchGraphSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedGraphElements.length}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              selectedCount={selectedGraphElements.length}
              totalCount={totalCount ?? selectedGraphElements.length}
              onStylePropertyPreview={previewStyleProperty}
              onStylePropertyCommit={commitStyleProperty}
              onPaintPreview={previewPaint}
              onPaintCommit={commitPaint}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
              showShadowControls={false}
              shadowActiveState={false}
              afterSizeContent={
                <>
                  <PropertyRow
                    label={t('propertiesPanel.graphShape') || 'Graph Shape'}
                  >
                    {graphTypeState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <Dropdown
                      commitStrategy="after-paint"
                      options={graphShapeOptions}
                      value={graphTypeState.value}
                      onChange={(value) =>
                        handleGraphBatchSharedSetting({
                          graphType: value as GraphItemType,
                        })
                      }
                    />
                  </PropertyRow>

                  {hasLineGraph && (
                    <div className="flex justify-between items-center w-full min-h-[32px]">
                      <p className="text-fg-muted text-label">
                        {t('propertiesPanel.graphShowAverageLine') ||
                          'Show Average Line'}
                      </p>
                      <Checkbox
                        commitStrategy="after-paint"
                        checked={showAvgLineState.value}
                        onChange={() =>
                          handleGraphBatchSharedSetting({
                            showAvgLine: !showAvgLineState.value,
                          })
                        }
                      />
                    </div>
                  )}

                  <PropertyRow
                    label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}
                  >
                    {graphSpeedState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <NumberInput
                      value={graphSpeedState.value}
                      width="62px"
                      onChange={(value) => {
                        const clamped = Math.max(500, Math.min(5000, value));
                        const snapped = Math.round(clamped / 100) * 100;
                        handleGraphBatchSharedSetting({
                          graphSpeed: snapped,
                        });
                      }}
                      min={500}
                      max={5000}
                      suffix="ms"
                      isMixed={graphSpeedState.isMixed}
                    />
                  </PropertyRow>

                  <PropertyRow
                    label={t('propertiesPanel.graphColor') || 'Graph Color'}
                  >
                    {graphColorState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <ColorInput
                      value={graphColorState.value}
                      hexMixed={graphColorMixed.hex}
                      alphaMixed={graphColorMixed.alpha}
                      onChange={() => {}}
                      onPreview={(value) =>
                        previewBatchGraphColor(
                          selectedGraphElements.map(({ id }) => id),
                          selectedKeyType,
                          value,
                        )
                      }
                      onChangeComplete={(value) =>
                        handleGraphBatchSharedSetting({ graphColor: value })
                      }
                      onCancel={() => editGestureController.cancel()}
                      colorId={`graph-batch-color-${selectedKeyType}`}
                      panelElement={panelElement}
                    />
                  </PropertyRow>

                  <div className="flex justify-between items-center w-full min-h-[32px]">
                    <p className="text-fg-muted text-label">
                      {t('propertiesPanel.graphAnimation') || 'Graph Animation'}
                    </p>
                    <div className="flex items-center gap-[6px]">
                      {graphAnimationState.isMixed ? (
                        <span className="text-fg-faint text-body italic">
                          Mixed
                        </span>
                      ) : null}
                      <Checkbox
                        commitStrategy="after-paint"
                        checked={graphAnimationState.value}
                        onChange={() =>
                          handleGraphBatchSharedSetting({
                            graphAnimationEnabled: !graphAnimationState.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              }
              getMixedValue={getMixedValueGraphsAsKey}
              getSelectedKeysData={getSelectedGraphsData}
              handleBatchAlign={handleBatchAlign}
              handleBatchDistribute={handleBatchDistribute}
              handleBatchSpacing={handleBatchSpacing}
              handleBatchSpacingPreview={handleBatchSpacingPreview}
              handleBatchSpacingCommit={handleBatchSpacingCommit}
              batchSpacing={batchGraphSpacing}
              handleBatchResize={handleBatchResize}
              handleBatchResizePreview={handleBatchResizePreview}
              onElementPropertyCommit={onElementPropertyCommit}
              showBatchImagePicker={showBatchImagePicker}
              onToggleBatchImagePicker={() =>
                setShowBatchImagePicker(!showBatchImagePicker)
              }
              batchImageButtonRef={batchImageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
            />
          </EditSessionBoundary>
        </div>
      </div>

      <PopupExit open={showBatchImagePicker}>
        {showBatchImagePicker && batchImageButtonRef.current ? (
          <ImagePicker
            open={showBatchImagePicker}
            referenceRef={batchImageButtonRef}
            panelElement={panelElement}
            showActiveState={false}
            idleImage={
              getMixedValueGraphs((pos) => pos.inactiveImage, '').isMixed
                ? ''
                : getMixedValueGraphs((pos) => pos.inactiveImage, '').value
            }
            activeImage={
              getMixedValueGraphs((pos) => pos.activeImage, '').isMixed
                ? ''
                : getMixedValueGraphs((pos) => pos.activeImage, '').value
            }
            idleTransparent={
              getMixedValueGraphs((pos) => pos.idleTransparent, false).value
            }
            activeTransparent={
              getMixedValueGraphs((pos) => pos.activeTransparent, false).value
            }
            completionBinding={graphImageBinding.binding}
            onIdleImageChange={(imageUrl: string) => {
              commitBoundInactiveImage(graphImageBinding.selection, imageUrl);
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                graphTransparencyBinding.selection,
                value,
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(graphImageBinding.selection, '');
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};

// ============================================================================
// Knob-only batch selection panel
// ============================================================================

interface BatchKnobOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // native+plugin 합산 개수 - 헤더 표시·분배 게이트 (미전달 시 native 개수)
  totalCount?: number;
  selectedKnobElements: SelectedElement[];
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingPreview: (spacing: number) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  handleBatchResize: (dimension: 'width' | 'height', value: number) => void;
  handleBatchResizePreview: (
    dimension: 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (
    updates: BatchElementPropertyUpdate,
    options?: { gestureId?: string },
  ) => void;
  handleKnobBatchSharedSetting: (updates: Partial<KnobItemPosition>) => void;
  getMixedValueKnobs: MixedValueGetter<KnobItemPosition>;
  getMixedValueKnobsAsKey: MixedValueGetter<KeyPosition>;
  getSelectedKnobsData: () => KeyData[];
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchImageButtonRef: React.RefObject<HTMLButtonElement | null>;
  showBatchImagePicker: boolean;
  setShowBatchImagePicker: (value: boolean) => void;
  panelElement: HTMLDivElement | null;
  useCustomCSS: boolean;
  selectedKeyType: string;
  t: (key: string) => string | undefined;
}

export const BatchKnobOnlyPanel: React.FC<BatchKnobOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedKnobElements,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingPreview,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  handleBatchResize,
  handleBatchResizePreview,
  onElementPropertyCommit,
  handleKnobBatchSharedSetting,
  getMixedValueKnobs,
  getMixedValueKnobsAsKey,
  getSelectedKnobsData,
  batchScrollRefFor,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 이미지 피커 open 시점의 노브 선택을 ID로 고정
  const knobImageBinding = useBatchElementBinding(showBatchImagePicker, () =>
    captureBatchElementBinding({ knob: selectedKnobElements }),
  );
  const knobTransparencyBinding = captureBatchElementBinding({
    knob: selectedKnobElements,
  });
  const { previewStyleProperty, commitStyleProperty } =
    createStylePropertyHandlers(
      selectedKnobElements.map(({ id }) => ({
        elementType: 'knob',
        id,
      })),
      selectedKeyType,
    );
  const { previewPaint, commitPaint } = createPaintHandlers(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
    selectedKeyType,
  );
  const commitShadow = createShadowCommitHandler(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
  );

  const sensitivityState = getMixedValueKnobs(
    (pos) => Number(pos.sensitivity ?? 1),
    1,
  );
  const reverseState = getMixedValueKnobs((pos) => pos.reverse ?? false, false);
  const batchKnobSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount ?? selectedKnobElements.length}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              selectedCount={selectedKnobElements.length}
              totalCount={totalCount ?? selectedKnobElements.length}
              onStylePropertyPreview={previewStyleProperty}
              onStylePropertyCommit={commitStyleProperty}
              onPaintPreview={previewPaint}
              onPaintCommit={commitPaint}
              onShadowCommit={commitShadow}
              hideDisplayText
              hideFontControls
              showSoundControls={false}
              shadowKind="knob"
              afterSizeContent={
                <>
                  <PropertyRow
                    label={t('propertiesPanel.knobSensitivity') || '민감도'}
                  >
                    {sensitivityState.isMixed ? (
                      <span className="text-fg-faint text-body italic">
                        Mixed
                      </span>
                    ) : null}
                    <NumberInput
                      value={sensitivityState.value}
                      onChange={(value) =>
                        handleKnobBatchSharedSetting({
                          sensitivity: Math.max(0, value),
                        })
                      }
                      suffix="×"
                      min={0}
                      max={100}
                      allowDecimal
                      decimalScale={2}
                      isMixed={sensitivityState.isMixed}
                    />
                  </PropertyRow>

                  <div className="flex justify-between items-center w-full min-h-[32px]">
                    <p className="text-fg-muted text-label">
                      {t('propertiesPanel.knobReverse') || '방향 반전'}
                    </p>
                    <div className="flex items-center gap-[6px]">
                      {reverseState.isMixed ? (
                        <span className="text-fg-faint text-body italic">
                          Mixed
                        </span>
                      ) : null}
                      <Checkbox
                        commitStrategy="after-paint"
                        checked={reverseState.value}
                        onChange={() =>
                          handleKnobBatchSharedSetting({
                            reverse: !reverseState.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              }
              getMixedValue={getMixedValueKnobsAsKey}
              getSelectedKeysData={getSelectedKnobsData}
              handleBatchAlign={handleBatchAlign}
              handleBatchDistribute={handleBatchDistribute}
              handleBatchSpacing={handleBatchSpacing}
              handleBatchSpacingPreview={handleBatchSpacingPreview}
              handleBatchSpacingCommit={handleBatchSpacingCommit}
              batchSpacing={batchKnobSpacing}
              handleBatchResize={handleBatchResize}
              handleBatchResizePreview={handleBatchResizePreview}
              onElementPropertyCommit={onElementPropertyCommit}
              showBatchImagePicker={showBatchImagePicker}
              onToggleBatchImagePicker={() =>
                setShowBatchImagePicker(!showBatchImagePicker)
              }
              batchImageButtonRef={batchImageButtonRef}
              panelElement={panelElement}
              useCustomCSS={useCustomCSS}
              t={t}
            />
          </EditSessionBoundary>
        </div>
      </div>

      <PopupExit open={showBatchImagePicker}>
        {showBatchImagePicker && batchImageButtonRef.current ? (
          <ImagePicker
            open={showBatchImagePicker}
            previewAnchor={{ kind: 'batch' }}
            referenceRef={batchImageButtonRef}
            panelElement={panelElement}
            idleImage={
              getMixedValueKnobs((pos) => pos.inactiveImage, '').isMixed
                ? ''
                : getMixedValueKnobs((pos) => pos.inactiveImage, '').value
            }
            activeImage={
              getMixedValueKnobs((pos) => pos.activeImage, '').isMixed
                ? ''
                : getMixedValueKnobs((pos) => pos.activeImage, '').value
            }
            idleTransparent={
              getMixedValueKnobs((pos) => pos.idleTransparent, false).value
            }
            activeTransparent={
              getMixedValueKnobs((pos) => pos.activeTransparent, false).value
            }
            completionBinding={knobImageBinding.binding}
            onIdleImageChange={(imageUrl: string) => {
              commitBoundInactiveImage(knobImageBinding.selection, imageUrl);
            }}
            onActiveImageChange={(imageUrl: string) => {
              commitBoundActiveImage(knobImageBinding.selection, imageUrl);
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                knobTransparencyBinding.selection,
                value,
              );
            }}
            onActiveTransparentChange={(value: boolean) => {
              commitBoundActiveTransparent(
                knobTransparencyBinding.selection,
                value,
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(knobImageBinding.selection, '');
            }}
            onActiveImageReset={() => {
              commitBoundActiveImage(knobImageBinding.selection, '');
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};

// ============================================================================
// Plugin-only batch selection panel (lightweight geometry)
// ============================================================================

interface BatchPluginOnlyPanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  // 플러그인 단독 다중 선택 개수
  totalCount: number;
  selectedGroupInfo: { id: string; name: string; memberCount: number } | null;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  handleBatchSpacingCommit: (
    spacing: number,
    options?: { gestureId?: string; deferSave?: boolean },
  ) => void;
  getBatchSpacingValue: () => MixedValueResult<number>;
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string | undefined;
}

// 플러그인 크기는 content-driven이라 resize 없이 정렬·분배·간격만 노출.
// 스타일 필드는 플러그인 스키마 소유라 배치 편집 대상이 아니다
export const BatchPluginOnlyPanel: React.FC<BatchPluginOnlyPanelProps> = ({
  setPanelElement,
  totalCount,
  selectedGroupInfo,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  getBatchSpacingValue,
  batchScrollRefFor,
  t,
}) => {
  const batchPluginSpacing = getBatchSpacingValue();

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className="flex-shrink-0">
        <BatchPanelHeader
          totalCount={totalCount}
          selectedGroupInfo={selectedGroupInfo}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameCancelledRef={renameCancelledRef}
          handleRenameCommit={handleRenameCommit}
          handleRenameCancel={handleRenameCancel}
          handleRenameStart={handleRenameStart}
          t={t}
        />
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <PropertySection>
              <BatchGeometrySection
                totalCount={totalCount}
                handleBatchAlign={handleBatchAlign}
                handleBatchDistribute={handleBatchDistribute}
                handleBatchSpacing={handleBatchSpacing}
                handleBatchSpacingCommit={handleBatchSpacingCommit}
                batchSpacing={batchPluginSpacing}
                t={t}
              />
            </PropertySection>
          </EditSessionBoundary>
        </div>
      </div>
    </div>
  );
};
