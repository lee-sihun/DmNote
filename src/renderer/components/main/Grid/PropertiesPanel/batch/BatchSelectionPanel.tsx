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
  patchFontColorByTargets,
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
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorFontColorPropertyPatchV1,
} from '@src/types/editor';
import { projectNotePaintPatch } from '@src/types/key/notePaint';
import {
  previewBatchFontColor,
  previewBatchStyleProperty,
} from '../previewPatchForwarders';
import { parseAlphaPercent, toRgbHexColor } from '@utils/color/colorUtils';
import type { BatchElementPropertyUpdate } from '../types';

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

const paintPatchDetails = (patch: EditorPaintPropertyPatchV1) => {
  const field = patch.property;
  const descriptor = patch.value;
  const { active, background } = paintPropertyFields(field);
  return {
    field,
    descriptor,
    active,
    target: background
      ? ('backgroundColor' as const)
      : ('borderColor' as const),
  };
};

const createPaintCommitHandler =
  (
    targets: readonly {
      elementType: 'key' | 'stat' | 'graph' | 'knob';
      id: string;
    }[],
  ) =>
  (patch: EditorPaintPropertyPatchV1) => {
    const details = paintPatchDetails(patch);
    const relevant = details.active
      ? targets.filter(
          ({ elementType }) => elementType === 'key' || elementType === 'knob',
        )
      : targets;
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    if (!stable) {
      return;
    }
    const persisted = patchPaintByTargets(relevant, patch);
    void persisted.catch(reportElementOpError);
  };

const createFontColorHandlers = (
  targets: readonly {
    elementType: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
  }[],
  selectedKeyType: string,
) => {
  const relevantTargets = (patch: EditorFontColorPropertyPatchV1) =>
    patch.property === 'activeFontColor'
      ? targets.filter(
          ({ elementType }) => elementType === 'key' || elementType === 'knob',
        )
      : targets;
  const stableTargets = (patch: EditorFontColorPropertyPatchV1) => {
    const relevant = relevantTargets(patch);
    return relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length
      ? relevant
      : null;
  };
  return {
    previewFontColor: (patch: EditorFontColorPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      previewBatchFontColor(stable, selectedKeyType, patch);
    },
    commitFontColor: (patch: EditorFontColorPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      const active = patch.property === 'activeFontColor';
      const gestureId = active
        ? undefined
        : editGestureController.activeGestureId() ?? undefined;
      const persisted = patchFontColorByTargets(
        stable,
        patch,
        gestureId ? { gestureId } : {},
      );
      if (!active) editGestureController.settleCommit(persisted);
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
  | 'stroke'
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
  noteColor: NoteColor;
  glowColor: NoteColor;
  borderColor: string;
  borderOpacity: number;
  fillIdle: string;
  fillActive: string;
  strokeIdle: string;
  strokeActive: string;
}

interface BatchLocalOpacities {
  noteOpacity: number;
  noteOpacityTop: number;
  noteOpacityBottom: number;
  glowOpacity: number;
  glowOpacityTop: number;
  glowOpacityBottom: number;
}

type OpacityTarget = 'solid' | 'top' | 'bottom';

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
  onElementPropertyCommit?: (updates: BatchElementPropertyUpdate) => void;
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
  batchCounterStrokeButtonRef: React.RefObject<HTMLButtonElement | null>;
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
  batchLocalOpacities: BatchLocalOpacities;
  setBatchLocalOpacities: React.Dispatch<
    React.SetStateAction<BatchLocalOpacities>
  >;
  handleBatchPickerToggle: (target: BatchPickerTarget) => void;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
  handleBatchNotePickerColorChangeComplete: (
    newColor: NoteColor,
    onNotePaintCommit: (patch: EditorNotePaintPropertyPatchV1) => void,
  ) => void;
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
  batchCounterStrokeButtonRef,
  batchImageButtonRef,
  showBatchImagePicker,
  setShowBatchImagePicker,
  batchPickerFor,
  setBatchPickerFor,
  batchCounterColorState,
  setBatchCounterColorState,
  batchLocalColors,
  setBatchLocalColors,
  batchLocalOpacities,
  setBatchLocalOpacities,
  handleBatchPickerToggle,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  handleBatchNotePickerColorChangeComplete,
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
  const commitPaint = createPaintCommitHandler(textPropertyTargets);
  const { previewFontColor, commitFontColor } = createFontColorHandlers(
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
  const commitNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = patchNotePaintByIds(stableNotePaintIds, patch, {
          gestureId,
        });
        editGestureController.settleCommit(persisted);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const previewNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        const entries: Array<{
          id: string;
          patch: Partial<KeyPosition>;
        }> = [];
        for (const id of stableNotePaintIds) {
          const locator = resolveElementById('key', id);
          if (!locator || locator.mode !== selectedKeyType) return;
          entries.push({
            id,
            patch: projectNotePaintPatch(patch),
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
      ) => {
        const persisted = patchCounterTypographyByTargets(
          stableCounterTargets,
          patch,
        );
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

  // opacity가 mixed면 첫 항목 값을 공통값처럼 단언하지 않고 원색으로 표시
  const opacityOrFull = (mixed: { isMixed: boolean; value: number }) =>
    mixed.isMixed ? 1 : mixed.value / 100;

  const getBatchNoteColorDisplay = () => {
    if (batchPickerFor === 'noteColor') {
      const value = batchLocalColors.noteColor;
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'gradient'
      ) {
        return {
          color: undefined,
          gradient: { top: value.top, bottom: value.bottom },
          opacity: batchLocalOpacities.noteOpacity / 100,
          label: 'Gradient',
          isMixed: false,
        };
      }
      const color = typeof value === 'string' ? value : '#FFFFFF';
      return {
        color,
        gradient: undefined,
        opacity: batchLocalOpacities.noteOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn(
      (pos) => pos.noteColor,
      '#FFFFFF' as NoteColor,
    );
    if (isMixed)
      return {
        color: 'var(--ui-fg-disabled)',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const opacity = opacityOrFull(mixedFn((pos) => pos.noteOpacity, 80));
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'gradient'
    ) {
      return {
        color: undefined,
        gradient: { top: value.top, bottom: value.bottom },
        opacity: {
          top: opacityOrFull(
            mixedFn((pos) => pos.noteOpacityTop ?? pos.noteOpacity, 80),
          ),
          bottom: opacityOrFull(
            mixedFn((pos) => pos.noteOpacityBottom ?? pos.noteOpacity, 80),
          ),
        },
        label: 'Gradient',
        isMixed: false,
      };
    }
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity,
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  const getBatchGlowColorDisplay = () => {
    if (batchPickerFor === 'glowColor') {
      const value = batchLocalColors.glowColor;
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'gradient'
      ) {
        return {
          color: undefined,
          gradient: { top: value.top, bottom: value.bottom },
          opacity: batchLocalOpacities.glowOpacity / 100,
          label: 'Gradient',
          isMixed: false,
        };
      }
      const color = typeof value === 'string' ? value : '#FFFFFF';
      return {
        color,
        gradient: undefined,
        opacity: batchLocalOpacities.glowOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn(
      (pos) => pos.noteGlowColor ?? pos.noteColor,
      '#FFFFFF' as NoteColor,
    );
    if (isMixed)
      return {
        color: 'var(--ui-fg-disabled)',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const opacity = opacityOrFull(mixedFn((pos) => pos.noteGlowOpacity, 70));
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'gradient'
    ) {
      return {
        color: undefined,
        gradient: { top: value.top, bottom: value.bottom },
        opacity: {
          top: opacityOrFull(
            mixedFn((pos) => pos.noteGlowOpacityTop ?? pos.noteGlowOpacity, 70),
          ),
          bottom: opacityOrFull(
            mixedFn(
              (pos) => pos.noteGlowOpacityBottom ?? pos.noteGlowOpacity,
              70,
            ),
          ),
        },
        label: 'Gradient',
        isMixed: false,
      };
    }
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity,
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  // 테두리 색은 단색만 지원. 피커 열림 시 로컬값, 닫힘 시 실제 공통값/Mixed 표시
  const getBatchBorderColorDisplay = () => {
    if (batchPickerFor === 'borderColor') {
      const color = batchLocalColors.borderColor;
      return {
        color,
        gradient: undefined,
        opacity: batchLocalColors.borderOpacity / 100,
        label: color.replace(/^#/, ''),
        isMixed: false,
      };
    }

    const mixedFn =
      selectedKeyElements.length > 0 ? getMixedValueKeysOnly : getMixedValue;
    const { isMixed, value } = mixedFn((pos) => pos.noteBorderColor, '#FFFFFF');
    if (isMixed)
      return {
        color: 'var(--ui-fg-disabled)',
        gradient: undefined,
        opacity: 1,
        label: 'Mixed',
        isMixed: true,
      };
    const color = typeof value === 'string' ? value : '#FFFFFF';
    return {
      color,
      gradient: undefined,
      opacity: opacityOrFull(mixedFn((pos) => pos.noteBorderOpacity, 100)),
      label: color.replace(/^#/, ''),
      isMixed: false,
    };
  };

  const keysData = getSelectedKeysData();
  const keyOnlyPositions = getSelectedKeyOnlyPositions();
  const firstCounterPosition =
    keyOnlyPositions[0]?.position ?? keysData[0]?.position;
  const batchCounterSettings = firstCounterPosition
    ? normalizeCounterSettings(firstCounterPosition.counter)
    : createDefaultCounterSettings();
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
  const noteOpacityEdgesMixed = {
    top: noteMixedFn((pos) => pos.noteOpacityTop ?? pos.noteOpacity, 80)
      .isMixed,
    bottom: noteMixedFn((pos) => pos.noteOpacityBottom ?? pos.noteOpacity, 80)
      .isMixed,
  };
  const glowOpacityMixed = noteMixedFn(
    (pos) => pos.noteGlowOpacity,
    70,
  ).isMixed;
  const glowOpacityEdgesMixed = {
    top: noteMixedFn((pos) => pos.noteGlowOpacityTop ?? pos.noteGlowOpacity, 70)
      .isMixed,
    bottom: noteMixedFn(
      (pos) => pos.noteGlowOpacityBottom ?? pos.noteGlowOpacity,
      70,
    ).isMixed,
  };
  const isGradientNoteColor = (value: NoteColor) =>
    typeof value === 'object' && value !== null && 'type' in value;
  const batchNoteIsGradient = isGradientNoteColor(batchLocalColors.noteColor);
  const batchGlowIsGradient = isGradientNoteColor(batchLocalColors.glowColor);
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

  // 열린 배치 피커의 hex 칸·% 칸 Mixed. 두 칸은 따로 판단하고, 저장 표현(대소문자·rgba·hex8)이
  // 달라도 같은 색이면 공통값으로 본다
  const batchPickerMixed = ((): {
    hex: boolean;
    alpha: boolean | { top: boolean; bottom: boolean };
  } => {
    const paintHex = (value: NoteColor | undefined) =>
      typeof value === 'string' ? toRgbHexColor(value) : value;
    switch (batchPickerFor) {
      case 'noteColor':
        return {
          hex: noteMixedFn((pos) => paintHex(pos.noteColor), '#FFFFFF').isMixed,
          alpha: batchNoteIsGradient ? noteOpacityEdgesMixed : noteOpacityMixed,
        };
      case 'glowColor':
        return {
          hex: noteMixedFn(
            (pos) => paintHex(pos.noteGlowColor ?? pos.noteColor),
            '#FFFFFF',
          ).isMixed,
          alpha: batchGlowIsGradient ? glowOpacityEdgesMixed : glowOpacityMixed,
        };
      case 'borderColor':
        return {
          hex: noteMixedFn((pos) => toRgbHexColor(pos.noteBorderColor), '')
            .isMixed,
          alpha: noteMixedFn((pos) => pos.noteBorderOpacity, 100).isMixed,
        };
      case 'fill':
      case 'stroke': {
        // 입력 상태 색은 통계를 편집하지 않으므로 Mixed도 같은 집합으로
        const state = batchCounterColorState === 'active' ? 'active' : 'idle';
        const mixedFn =
          state === 'active' ? getMixedValueActiveCapable : getMixedValue;
        const colorOf = (pos: KeyPosition) =>
          normalizeCounterSettings(pos.counter)[batchPickerFor][state];
        return {
          hex: mixedFn((pos) => toRgbHexColor(colorOf(pos)), '').isMixed,
          alpha: mixedFn((pos) => parseAlphaPercent(colorOf(pos)), 100).isMixed,
        };
      }
      default:
        return { hex: false, alpha: false };
    }
  })();

  // 단일 선택과 같은 규칙: 상·하단은 각자 바꾸고 base는 평균, 단색은 셋을 같은 값으로.
  // base만 저장하면 남아 있는 상·하단이 우선해 바꾼 값이 보이지 않는다
  const nextNoteOpacities = (
    kind: 'note' | 'glow',
    value: number,
    target: OpacityTarget,
  ) => {
    if (target === 'solid') {
      return { opacity: value, opacityTop: value, opacityBottom: value };
    }
    const local = batchLocalOpacities;
    const top = kind === 'note' ? local.noteOpacityTop : local.glowOpacityTop;
    const bottom =
      kind === 'note' ? local.noteOpacityBottom : local.glowOpacityBottom;
    const nextTop = target === 'top' ? value : top;
    const nextBottom = target === 'bottom' ? value : bottom;
    return {
      opacity: Math.round((nextTop + nextBottom) / 2),
      opacityTop: nextTop,
      opacityBottom: nextBottom,
    };
  };

  const applyNoteOpacities = (
    kind: 'note' | 'glow',
    next: { opacity: number; opacityTop: number; opacityBottom: number },
  ) => {
    setBatchLocalOpacities((prev) =>
      kind === 'note'
        ? {
            ...prev,
            noteOpacity: next.opacity,
            noteOpacityTop: next.opacityTop,
            noteOpacityBottom: next.opacityBottom,
          }
        : {
            ...prev,
            glowOpacity: next.opacity,
            glowOpacityTop: next.opacityTop,
            glowOpacityBottom: next.opacityBottom,
          },
    );
  };

  const batchOpacityKind =
    batchPickerFor === 'noteColor'
      ? 'note'
      : batchPickerFor === 'glowColor'
      ? 'glow'
      : null;

  const getCounterColorDisplay = (target: 'fill' | 'stroke') => {
    const key =
      target === 'fill'
        ? batchCounterColorState === 'active'
          ? 'fillActive'
          : 'fillIdle'
        : batchCounterColorState === 'active'
        ? 'strokeActive'
        : 'strokeIdle';

    if (batchPickerFor === target) {
      return batchLocalColors[key];
    }

    return target === 'fill'
      ? batchCounterColorState === 'active'
        ? batchCounterSettings.fill.active
        : batchCounterSettings.fill.idle
      : batchCounterColorState === 'active'
      ? batchCounterSettings.stroke.active
      : batchCounterSettings.stroke.idle;
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
                onPaintCommit={commitPaint}
                onFontColorPreview={previewFontColor}
                onFontColorCommit={commitFontColor}
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
                          onChangeComplete={(value) =>
                            handleGraphBatchSharedSetting({
                              graphColor: value,
                            })
                          }
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
                keyVisual={batchKeyVisual}
                onCounterEnabledCommit={commitCounterEnabled}
                onCounterAnimationEnabledCommit={commitCounterAnimationEnabled}
                onCounterLayoutCommit={commitCounterLayout}
                onCounterTypographyCommit={commitCounterTypography}
                colorState={batchCounterColorState}
                getCounterColorDisplay={getCounterColorDisplay}
                onFillPickerToggle={() => handleBatchPickerToggle('fill')}
                onStrokePickerToggle={() => handleBatchPickerToggle('stroke')}
                batchCounterFillButtonRef={batchCounterFillButtonRef}
                batchCounterStrokeButtonRef={batchCounterStrokeButtonRef}
                isFillPickerOpen={batchPickerFor === 'fill'}
                isStrokePickerOpen={batchPickerFor === 'stroke'}
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
              color={getBatchPickerColor()}
              onColorChange={(color) => {
                handleBatchPickerColorChange(color);
                if (!previewNotePaint) return;
                if (
                  batchPickerFor === 'noteColor' &&
                  typeof color === 'string'
                ) {
                  previewNotePaint({ property: 'notePaint', value: { color } });
                } else if (
                  batchPickerFor === 'glowColor' &&
                  typeof color === 'string'
                ) {
                  previewNotePaint({
                    property: 'noteGlowPaint',
                    value: { color },
                  });
                } else if (batchPickerFor === 'borderColor') {
                  const raw = typeof color === 'string' ? color : undefined;
                  previewNotePaint({
                    property: 'noteBorderPaint',
                    value: {
                      color: toRgbHexColor(raw),
                      opacity: parseAlphaPercent(
                        raw,
                        batchLocalColors.borderOpacity,
                      ),
                    },
                  });
                }
              }}
              onColorChangeComplete={(color) => {
                if (
                  commitNotePaint &&
                  (batchPickerFor === 'noteColor' ||
                    batchPickerFor === 'glowColor' ||
                    batchPickerFor === 'borderColor')
                ) {
                  handleBatchNotePickerColorChangeComplete(
                    color,
                    commitNotePaint,
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
              solidOnly={
                batchPickerFor !== 'noteColor' && batchPickerFor !== 'glowColor'
              }
              stateMode={
                (batchPickerFor === 'fill' || batchPickerFor === 'stroke') &&
                selectedKeyElements.length > 0
                  ? batchCounterColorState
                  : undefined
              }
              onStateModeChange={
                (batchPickerFor === 'fill' || batchPickerFor === 'stroke') &&
                selectedKeyElements.length > 0
                  ? setBatchCounterColorState
                  : undefined
              }
              opacityPercent={
                batchPickerFor === 'noteColor'
                  ? batchNoteIsGradient
                    ? {
                        top: batchLocalOpacities.noteOpacityTop,
                        bottom: batchLocalOpacities.noteOpacityBottom,
                      }
                    : batchLocalOpacities.noteOpacity
                  : batchPickerFor === 'glowColor'
                  ? batchGlowIsGradient
                    ? {
                        top: batchLocalOpacities.glowOpacityTop,
                        bottom: batchLocalOpacities.glowOpacityBottom,
                      }
                    : batchLocalOpacities.glowOpacity
                  : undefined
              }
              onOpacityPercentChange={(value, target) => {
                if (!batchOpacityKind) return;
                const next = nextNoteOpacities(batchOpacityKind, value, target);
                applyNoteOpacities(batchOpacityKind, next);
                previewNotePaint?.({
                  property:
                    batchOpacityKind === 'note' ? 'notePaint' : 'noteGlowPaint',
                  value: next,
                });
              }}
              onOpacityPercentChangeComplete={(value, target) => {
                if (!batchOpacityKind) return;
                const next = nextNoteOpacities(batchOpacityKind, value, target);
                applyNoteOpacities(batchOpacityKind, next);
                commitNotePaint?.({
                  property:
                    batchOpacityKind === 'note' ? 'notePaint' : 'noteGlowPaint',
                  value: next,
                });
              }}
              onOpacityPercentCancel={() => {
                // Escape는 게스처를 통째로 되돌린다. 로컬 대표값도 canonical에서 다시 읽어야
                // 입력이 blur 뒤 옛 preview 값으로 재동기화되지 않는다
                if (batchPickerFor === 'noteColor') {
                  editGestureController.cancel();
                  const base = getMixedValueCanonical(
                    (pos) => pos.noteOpacity,
                    80,
                  ).value;
                  applyNoteOpacities('note', {
                    opacity: base,
                    opacityTop: getMixedValueCanonical(
                      (pos) => pos.noteOpacityTop ?? pos.noteOpacity,
                      base,
                    ).value,
                    opacityBottom: getMixedValueCanonical(
                      (pos) => pos.noteOpacityBottom ?? pos.noteOpacity,
                      base,
                    ).value,
                  });
                } else if (batchPickerFor === 'glowColor') {
                  editGestureController.cancel();
                  const base = getMixedValueCanonical(
                    (pos) => pos.noteGlowOpacity,
                    70,
                  ).value;
                  applyNoteOpacities('glow', {
                    opacity: base,
                    opacityTop: getMixedValueCanonical(
                      (pos) => pos.noteGlowOpacityTop ?? pos.noteGlowOpacity,
                      base,
                    ).value,
                    opacityBottom: getMixedValueCanonical(
                      (pos) => pos.noteGlowOpacityBottom ?? pos.noteGlowOpacity,
                      base,
                    ).value,
                  });
                } else if (batchPickerFor === 'borderColor') {
                  editGestureController.cancel();
                  const borderColor = getMixedValueCanonical(
                    (pos) => pos.noteBorderColor,
                    '#FFFFFF',
                  ).value;
                  const borderOpacity = getMixedValueCanonical(
                    (pos) => pos.noteBorderOpacity,
                    100,
                  ).value;
                  setBatchLocalColors((prev) => ({
                    ...prev,
                    borderColor,
                    borderOpacity,
                  }));
                } else if (
                  batchPickerFor === 'fill' ||
                  batchPickerFor === 'stroke'
                ) {
                  // 카운터 색 preview는 로컬에만 머물러 게스처가 없다. 표시 중인 확정값으로 되돌린다
                  const target = batchPickerFor;
                  const state =
                    batchCounterColorState === 'active' ? 'active' : 'idle';
                  const key = `${target}${
                    state === 'active' ? 'Active' : 'Idle'
                  }` as const;
                  setBatchLocalColors((prev) => ({
                    ...prev,
                    [key]: batchCounterSettings[target][state],
                  }));
                }
              }}
              opacityPercentLabel={
                batchPickerFor === 'noteColor'
                  ? t('keySetting.noteOpacity') || '노트 투명도'
                  : batchPickerFor === 'glowColor'
                  ? t('keySetting.noteGlowOpacity') || '글로우 투명도'
                  : undefined
              }
              opacityPercentMixed={batchPickerMixed.alpha}
              hexMixed={batchPickerMixed.hex}
            />
          ) : null}
        </PopupExit>

        {/* 다중 선택용 ImagePicker */}
        <PopupExit open={showBatchImagePicker}>
          {showBatchImagePicker && batchImageButtonRef.current ? (
            <ImagePicker
              open={showBatchImagePicker}
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
  onElementPropertyCommit?: (updates: BatchElementPropertyUpdate) => void;
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
  const commitPaint = createPaintCommitHandler(
    selectedGraphElements.map(({ id }) => ({
      elementType: 'graph',
      id,
    })),
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
                      onChangeComplete={(value) =>
                        handleGraphBatchSharedSetting({ graphColor: value })
                      }
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
  onElementPropertyCommit?: (updates: BatchElementPropertyUpdate) => void;
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
  const commitPaint = createPaintCommitHandler(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
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
