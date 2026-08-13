/* eslint-disable react-hooks/refs */
import React from 'react';
import type {
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { ElementShadowSpec } from '@src/types/key/shadows';
import {
  paintPropertyFields,
  type ColorModeValue,
  type PaintDescriptorV1,
} from '@src/types/color';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  normalizeCounterSettings,
  createDefaultCounterSettings,
} from '@src/types/key/keys';
import {
  PropertyRow,
  NumberInput,
  ColorInput,
  Tabs,
  BatchStyleTabContent,
  BatchNoteTabContent,
  BatchCounterTabContent,
  TABS,
  TabType,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import EditSessionBoundary from '../EditSessionBoundary';
import type { ElementIdSelection } from '@src/renderer/editor/runtime/elementPatch';
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
  patchStylePropertyByTargets,
  patchInactiveImageByTargets,
  patchIdleTransparentByTargets,
  patchSoundEnabledByIds,
  patchSoundVolumeByIds,
  patchSoundPathByIds,
} from '@src/renderer/editor/runtime/elementOps';
import {
  patchActiveImageViaAuthority,
  patchActiveTransparentViaAuthority,
  patchCounterAnimationEnabledViaAuthority,
  patchCounterEnabledViaAuthority,
  patchCounterLayoutViaAuthority,
  patchCounterTypographyViaAuthority,
  patchPaintViaAuthority,
  patchShadowViaAuthority,
  patchNotePaintViaAuthority,
  patchStylePropertyViaAuthority,
  patchInactiveImageViaAuthority,
  patchIdleTransparentViaAuthority,
  patchSoundEnabledViaAuthority,
  patchSoundVolumeViaAuthority,
  patchSoundPathViaAuthority,
} from '@plugins/rpc/pluginElementActions';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import {
  captureBatchElementBinding,
  useBatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import { usePanelNav } from '../PanelNavContext';
import { BATCH_COUNTER_ANIMATION_PAGE_KEY } from './BatchCounterTabContent';
import { BATCH_STYLE_SOUND_PAGE_KEY } from './BatchStyleTabContent';
import {
  isSyntheticElementId,
  resolveElementById,
} from '@src/renderer/editor/model/elementIdMap';
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
} from '@src/types/editor';

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
    targets.every(({ id }) => id.length > 0 && !isSyntheticElementId(id)) &&
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
    previewStyleProperty: (patch: EditorPreviewStylePropertyPatchV1) => {
      const grouped = new Map<
        'key' | 'stat' | 'graph' | 'knob',
        Array<{ index: number; patch: EditorPreviewStylePropertyPatchV1 }>
      >();
      for (const target of stableTargets) {
        const locator = resolveElementById(target.elementType, target.id);
        if (!locator || locator.mode !== selectedKeyType) return;
        const entries = grouped.get(target.elementType) ?? [];
        entries.push({ index: locator.index, patch });
        grouped.set(target.elementType, entries);
      }
      for (const [type, entries] of grouped) {
        editGestureController.preview(selectedKeyType, entries, {
          domain:
            type === 'key'
              ? 'keyPosition'
              : type === 'stat'
              ? 'statPosition'
              : type === 'graph'
              ? 'graphPosition'
              : 'knobPosition',
        });
      }
    },
    commitStyleProperty: (patch: EditorPreviewStylePropertyPatchV1) => {
      const gestureId = options.settleGesture
        ? editGestureController.activeGestureId() ?? undefined
        : undefined;
      const persisted =
        window.__dmn_window_type === 'panel'
          ? patchStylePropertyViaAuthority(stableTargets, patch, gestureId)
          : patchStylePropertyByTargets(stableTargets, patch, { gestureId });
      if (options.settleGesture) {
        editGestureController.settleCommit(persisted);
      }
      void persisted.catch(reportElementOpError);
    },
  };
};

const paintPatchDetails = (patch: EditorPaintPropertyPatchV1) => {
  const field = Object.keys(patch)[0] as
    | 'backgroundPaint'
    | 'activeBackgroundPaint'
    | 'borderPaint'
    | 'activeBorderPaint';
  const descriptor = patch[field] as PaintDescriptorV1;
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
    legacy: (
      target: 'backgroundColor' | 'borderColor',
      state: 'idle' | 'active',
      value: ColorModeValue,
    ) => void,
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
      relevant.every(({ id }) => id.length > 0 && !isSyntheticElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    if (!stable) {
      legacy(
        details.target,
        details.active ? 'active' : 'idle',
        details.descriptor.gradient
          ? { mode: 'gradient', spec: details.descriptor.gradient }
          : { mode: 'solid', color: details.descriptor.color },
      );
      return;
    }
    const persisted =
      window.__dmn_window_type === 'panel'
        ? patchPaintViaAuthority(relevant, patch)
        : patchPaintByTargets(relevant, patch);
    void persisted.catch(reportElementOpError);
  };

const createShadowCommitHandler =
  (
    targets: readonly {
      elementType: 'key' | 'stat' | 'knob';
      id: string;
    }[],
    legacyChange: (
      state: 'idle' | 'active',
      patch: Partial<ElementShadowSpec>,
    ) => void,
    legacyEnabled: (enabled: boolean) => void,
  ) =>
  (patch: EditorShadowPropertyPatchV1) => {
    const relevant =
      'activeShadow' in patch
        ? targets.filter(({ elementType }) => elementType !== 'stat')
        : targets;
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && !isSyntheticElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    if (!stable) {
      if ('shadowEnabled' in patch) {
        legacyEnabled(patch.shadowEnabled);
      } else if ('activeShadow' in patch) {
        legacyChange('active', patch.activeShadow);
      } else {
        legacyChange('idle', patch.shadow);
      }
      return;
    }
    const persisted =
      window.__dmn_window_type === 'panel'
        ? patchShadowViaAuthority(relevant, patch)
        : patchShadowByTargets(relevant, patch);
    void persisted.catch(reportElementOpError);
  };

const commitBoundInactiveImage = (
  binding: 'element-id' | 'session-mode',
  selection: ElementIdSelection,
  inactiveImage: string,
  legacy: () => void,
) => {
  if (binding !== 'element-id') {
    legacy();
    return;
  }
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted =
    window.__dmn_window_type === 'panel'
      ? patchInactiveImageViaAuthority(targets, inactiveImage)
      : patchInactiveImageByTargets(targets, inactiveImage);
  void persisted.catch(reportElementOpError);
};

const commitBoundActiveImage = (
  binding: 'element-id' | 'session-mode',
  selection: ElementIdSelection,
  activeImage: string,
  legacy: () => void,
) => {
  if (binding !== 'element-id') {
    legacy();
    return;
  }
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted =
    window.__dmn_window_type === 'panel'
      ? patchActiveImageViaAuthority(targets, activeImage)
      : patchActiveImageByTargets(targets, activeImage);
  void persisted.catch(reportElementOpError);
};

const commitBoundIdleTransparent = (
  binding: 'element-id' | 'session-mode',
  selection: ElementIdSelection,
  idleTransparent: boolean,
  legacy: () => void,
) => {
  if (binding !== 'element-id') {
    legacy();
    return;
  }
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted =
    window.__dmn_window_type === 'panel'
      ? patchIdleTransparentViaAuthority(targets, idleTransparent)
      : patchIdleTransparentByTargets(targets, idleTransparent);
  void persisted.catch(reportElementOpError);
};

const commitBoundActiveTransparent = (
  binding: 'element-id' | 'session-mode',
  selection: ElementIdSelection,
  activeTransparent: boolean,
  legacy: () => void,
) => {
  if (binding !== 'element-id') {
    legacy();
    return;
  }
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted =
    window.__dmn_window_type === 'panel'
      ? patchActiveTransparentViaAuthority(targets, activeTransparent)
      : patchActiveTransparentByTargets(targets, activeTransparent);
  void persisted.catch(reportElementOpError);
};

const commitBoundSoundPath = (
  binding: 'element-id' | 'session-mode',
  selection: ElementIdSelection,
  soundPath: string,
  legacy: () => void,
) => {
  if (binding !== 'element-id') {
    legacy();
    return;
  }
  const ids = selection.key ?? [];
  if (ids.length === 0) return;
  const persisted =
    window.__dmn_window_type === 'panel'
      ? patchSoundPathViaAuthority(ids, soundPath)
      : patchSoundPathByIds(ids, soundPath);
  void persisted.catch(reportElementOpError);
};

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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 3.5C17.3284 2.67157 18.6716 2.67157 19.5 3.5V3.5C20.3284 4.32843 20.3284 5.67157 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
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

interface BatchKeyLikePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
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
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchShadowChangeComplete: (
    state: 'idle' | 'active',
    patch: Partial<ElementShadowSpec>,
  ) => void;
  handleBatchShadowEnabledChange?: (enabled: boolean) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
  ) => void;
  handleKeyOnlyStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  handleBatchCounterUpdate: (
    updates: Partial<KeyCounterSettings>,
    options?: {
      activeStateOnly?: boolean;
      colorState?: 'idle' | 'active';
    },
  ) => void;
  handleBatchNoteColorChange: (value: NoteColor) => void;
  handleBatchNoteColorChangeComplete: (value: NoteColor) => void;
  handleBatchGlowColorChange: (value: NoteColor) => void;
  handleBatchGlowColorChangeComplete: (value: NoteColor) => void;
  handleGraphBatchSharedSetting: (updates: Partial<GraphItemPosition>) => void;
  // mixed value getters
  getMixedValue: MixedValueGetter<KeyPosition>;
  getMixedValueBatch: MixedValueGetter<KeyPosition>;
  getMixedValueGraphs: MixedValueGetter<GraphItemPosition>;
  getMixedValueGraphsAsKey: MixedValueGetter<KeyPosition>;
  getMixedValueKeysOnly: MixedValueGetter<KeyPosition>;
  getMixedValueActiveCapable: MixedValueGetter<KeyPosition>;
  handleActiveCapableStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  getSelectedKeysData: () => KeyData[];
  getSelectedGraphsData: () => KeyData[];
  getSelectedBatchStyleData: () => KeyData[];
  getSelectedKeyOnlyPositions: () => { index: number; position: KeyPosition }[];
  // batch key-only handlers
  handleBatchKeyOnlyStyleChangeComplete: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => void;
  handleBatchNoteColorChangeKeysOnly: (value: NoteColor) => void;
  handleBatchNoteColorChangeCompleteKeysOnly: (value: NoteColor) => void;
  handleBatchGlowColorChangeKeysOnly: (value: NoteColor) => void;
  handleBatchGlowColorChangeCompleteKeysOnly: (value: NoteColor) => void;
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
  batchLocalOpacities: { noteOpacity: number; glowOpacity: number };
  setBatchLocalOpacities: React.Dispatch<
    React.SetStateAction<{ noteOpacity: number; glowOpacity: number }>
  >;
  handleBatchPickerToggle: (target: BatchPickerTarget) => void;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
  handleBatchNotePickerColorChangeComplete: (
    newColor: NoteColor,
    onNotePaintCommit: (patch: EditorNotePaintPropertyPatchV1) => void,
  ) => void;
  handleBatchKeyOnlyStyleChange: (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchShadowChangeComplete,
  handleBatchShadowEnabledChange,
  handleBatchGradientCommit,
  handleKeyOnlyStyleChangeComplete,
  handleBatchCounterUpdate,
  handleGraphBatchSharedSetting,
  getMixedValue,
  getMixedValueBatch,
  getMixedValueGraphs,
  getMixedValueKeysOnly,
  getMixedValueActiveCapable,
  handleActiveCapableStyleChangeComplete,
  getSelectedKeysData,
  getSelectedGraphsData,
  getSelectedBatchStyleData,
  getSelectedKeyOnlyPositions,
  handleBatchKeyOnlyStyleChangeComplete,
  handleBatchNoteColorChangeKeysOnly: _handleBatchNoteColorChangeKeysOnly,
  handleBatchNoteColorChangeCompleteKeysOnly:
    _handleBatchNoteColorChangeCompleteKeysOnly,
  handleBatchGlowColorChangeKeysOnly: _handleBatchGlowColorChangeKeysOnly,
  handleBatchGlowColorChangeCompleteKeysOnly:
    _handleBatchGlowColorChangeCompleteKeysOnly,
  handleBatchNoteColorChange: _handleBatchNoteColorChange,
  handleBatchNoteColorChangeComplete: _handleBatchNoteColorChangeComplete,
  handleBatchGlowColorChange: _handleBatchGlowColorChange,
  handleBatchGlowColorChangeComplete: _handleBatchGlowColorChangeComplete,
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
  setBatchLocalColors: _setBatchLocalColors,
  batchLocalOpacities,
  setBatchLocalOpacities,
  handleBatchPickerToggle,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  handleBatchNotePickerColorChangeComplete,
  handleBatchKeyOnlyStyleChange,
  getBatchPickerColor,
  getBatchPickerRef,
  batchColorPickerInteractiveRefs,
  panelElement,
  useCustomCSS,
  selectedKeyType,
  t,
}) => {
  // 피커 open 시점의 선택을 ID로 고정 - 대기 중 재정렬·모드 전환에도
  // 완료가 시작 시점 요소들에 적용된다 (전원이 ID를 가질 때만, 아니면 legacy).
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
    counterTargets.every(({ id }) => id.length > 0 && !isSyntheticElementId(id))
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
  const commitPaint = createPaintCommitHandler(
    textPropertyTargets,
    handleBatchGradientCommit ?? (() => undefined),
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
  const commitShadow = createShadowCommitHandler(
    shadowTargets,
    handleBatchShadowChangeComplete,
    handleBatchShadowEnabledChange ?? (() => undefined),
  );
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
    notePaintIds.every((id) => id.length > 0 && !isSyntheticElementId(id)) &&
    new Set(notePaintIds).size === notePaintIds.length
      ? notePaintIds
      : null;
  const commitNotePaint = stableNotePaintIds
    ? (patch: EditorNotePaintPropertyPatchV1) => {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchNotePaintViaAuthority(stableNotePaintIds, patch, gestureId)
            : patchNotePaintByIds(stableNotePaintIds, patch, { gestureId });
        editGestureController.settleCommit(persisted);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const soundTargets = selectedKeyElements.map(({ id }) => id);
  const stableSoundTargets =
    soundTargets.length > 0 &&
    soundTargets.every((id) => id.length > 0 && !isSyntheticElementId(id))
      ? soundTargets
      : null;
  const commitSoundEnabled = stableSoundTargets
    ? (soundEnabled: boolean) => {
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchSoundEnabledViaAuthority(stableSoundTargets, soundEnabled)
            : patchSoundEnabledByIds(stableSoundTargets, soundEnabled);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitSoundVolume = stableSoundTargets
    ? (soundVolume: number) => {
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchSoundVolumeViaAuthority(stableSoundTargets, soundVolume)
            : patchSoundVolumeByIds(stableSoundTargets, soundVolume);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterEnabled = stableCounterTargets
    ? (enabled: boolean) => {
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchCounterEnabledViaAuthority(stableCounterTargets, enabled)
            : patchCounterEnabledByTargets(stableCounterTargets, enabled);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterAnimationEnabled = stableCounterTargets
    ? (enabled: boolean) => {
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchCounterAnimationEnabledViaAuthority(
                stableCounterTargets,
                enabled,
              )
            : patchCounterAnimationEnabledByTargets(
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
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchCounterLayoutViaAuthority(stableCounterTargets, patch)
            : patchCounterLayoutByTargets(stableCounterTargets, patch);
        void persisted.catch(reportElementOpError);
      }
    : undefined;
  const commitCounterTypography = stableCounterTargets
    ? (
        patch: import('@src/types/editor').EditorCounterTypographyPropertyPatchV1,
      ) => {
        const persisted =
          window.__dmn_window_type === 'panel'
            ? patchCounterTypographyViaAuthority(stableCounterTargets, patch)
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
        color: '#666',
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
        color: '#666',
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
        color: '#666',
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
  const noteOpacityMixed = getMixedValue((pos) => pos.noteOpacity, 80).isMixed;
  const glowOpacityMixed = getMixedValue(
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
        {/* 헤더 */}
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
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
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
              <span className="text-fg-faint text-body">
                ({selectedBatchStyleElements.length})
              </span>
            )}
          </div>
        </div>

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
                soundBinding={soundBinding}
                onSoundPathCommit={(soundPath) =>
                  commitBoundSoundPath(
                    soundBinding.binding,
                    soundBinding.selection,
                    soundPath,
                    () =>
                      handleKeyOnlyStyleChangeComplete('soundPath', soundPath),
                  )
                }
                onSoundEnabledCommit={commitSoundEnabled}
                onSoundVolumeCommit={commitSoundVolume}
                onStylePropertyPreview={previewStyleProperty}
                onStylePropertyCommit={commitStyleProperty}
                onPaintCommit={commitPaint}
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
                handleBatchStyleChange={handleBatchStyleChange}
                handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
                handleBatchShadowChangeComplete={
                  handleBatchShadowChangeComplete
                }
                handleBatchShadowEnabledChange={handleBatchShadowEnabledChange}
                handleBatchGradientCommit={handleBatchGradientCommit}
                getKeyOnlyMixedValue={getMixedValueKeysOnly}
                getActiveCapableMixedValue={getMixedValueActiveCapable}
                handleActiveCapableStyleChangeComplete={
                  handleActiveCapableStyleChangeComplete
                }
                handleKeyOnlyStyleChangeComplete={
                  handleKeyOnlyStyleChangeComplete
                }
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
                  handleBatchStyleChangeComplete={
                    handleBatchKeyOnlyStyleChangeComplete
                  }
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
                handleBatchCounterUpdate={handleBatchCounterUpdate}
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
              onColorChange={handleBatchPickerColorChange}
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
                  ? batchLocalOpacities.noteOpacity
                  : batchPickerFor === 'glowColor'
                  ? batchLocalOpacities.glowOpacity
                  : undefined
              }
              onOpacityPercentChange={(value: number) => {
                if (batchPickerFor === 'noteColor') {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    noteOpacity: value,
                  }));
                  handleBatchKeyOnlyStyleChange('noteOpacity', value);
                } else if (batchPickerFor === 'glowColor') {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    glowOpacity: value,
                  }));
                  handleBatchKeyOnlyStyleChange('noteGlowOpacity', value);
                }
              }}
              onOpacityPercentChangeComplete={(value: number) => {
                if (batchPickerFor === 'noteColor') {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    noteOpacity: value,
                  }));
                  if (commitNotePaint) {
                    commitNotePaint({ notePaint: { opacity: value } });
                  } else {
                    handleBatchKeyOnlyStyleChangeComplete('noteOpacity', value);
                  }
                } else if (batchPickerFor === 'glowColor') {
                  setBatchLocalOpacities((prev) => ({
                    ...prev,
                    glowOpacity: value,
                  }));
                  if (commitNotePaint) {
                    commitNotePaint({ noteGlowPaint: { opacity: value } });
                  } else {
                    handleBatchKeyOnlyStyleChangeComplete(
                      'noteGlowOpacity',
                      value,
                    );
                  }
                }
              }}
              opacityPercentLabel={
                batchPickerFor === 'noteColor'
                  ? t('keySetting.noteOpacity') || '노트 투명도'
                  : batchPickerFor === 'glowColor'
                  ? t('keySetting.noteGlowOpacity') || '글로우 투명도'
                  : undefined
              }
              opacityPercentMixed={
                batchPickerFor === 'noteColor'
                  ? noteOpacityMixed
                  : batchPickerFor === 'glowColor'
                  ? glowOpacityMixed
                  : false
              }
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
                commitBoundInactiveImage(
                  batchImageBinding.binding,
                  batchImageBinding.selection,
                  imageUrl,
                  () =>
                    handleBatchStyleChangeComplete('inactiveImage', imageUrl),
                );
              }}
              onActiveImageChange={(imageUrl: string) => {
                commitBoundActiveImage(
                  batchImageBinding.binding,
                  batchImageBinding.selection,
                  imageUrl,
                  () =>
                    handleActiveCapableStyleChangeComplete(
                      'activeImage',
                      imageUrl,
                    ),
                );
              }}
              onIdleTransparentChange={(value: boolean) => {
                commitBoundIdleTransparent(
                  idleTransparencyBinding.binding,
                  idleTransparencyBinding.selection,
                  value,
                  () =>
                    handleBatchStyleChangeComplete('idleTransparent', value),
                );
              }}
              onActiveTransparentChange={(value: boolean) => {
                commitBoundActiveTransparent(
                  activeTransparencyBinding.binding,
                  activeTransparencyBinding.selection,
                  value,
                  () =>
                    handleActiveCapableStyleChangeComplete(
                      'activeTransparent',
                      value,
                    ),
                );
              }}
              onIdleImageReset={() => {
                commitBoundInactiveImage(
                  batchImageBinding.binding,
                  batchImageBinding.selection,
                  '',
                  () => handleBatchStyleChangeComplete('inactiveImage', ''),
                );
              }}
              onActiveImageReset={() => {
                commitBoundActiveImage(
                  batchImageBinding.binding,
                  batchImageBinding.selection,
                  '',
                  () =>
                    handleActiveCapableStyleChangeComplete('activeImage', ''),
                );
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
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchGradientCommit,
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
    handleBatchGradientCommit ?? (() => undefined),
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
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
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
              <span className="text-fg-faint text-body">
                ({selectedGraphElements.length})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              selectedCount={selectedGraphElements.length}
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
              handleBatchStyleChange={handleBatchStyleChange}
              handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
              handleBatchGradientCommit={handleBatchGradientCommit}
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
              commitBoundInactiveImage(
                graphImageBinding.binding,
                graphImageBinding.selection,
                imageUrl,
                () =>
                  handleGraphBatchSharedSetting({ inactiveImage: imageUrl }),
              );
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                graphTransparencyBinding.binding,
                graphTransparencyBinding.selection,
                value,
                () => handleGraphBatchSharedSetting({ idleTransparent: value }),
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(
                graphImageBinding.binding,
                graphImageBinding.selection,
                '',
                () => handleGraphBatchSharedSetting({ inactiveImage: '' }),
              );
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
  handleBatchStyleChange: (property: keyof KeyPosition, value: unknown) => void;
  handleBatchStyleChangeComplete: (
    property: keyof KeyPosition,
    value: unknown,
  ) => void;
  handleBatchShadowChangeComplete: (
    state: 'idle' | 'active',
    patch: Partial<ElementShadowSpec>,
  ) => void;
  handleBatchShadowEnabledChange?: (enabled: boolean) => void;
  handleBatchGradientCommit?: (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
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
  handleBatchStyleChange,
  handleBatchStyleChangeComplete,
  handleBatchShadowChangeComplete,
  handleBatchShadowEnabledChange,
  handleBatchGradientCommit,
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
    handleBatchGradientCommit ?? (() => undefined),
  );
  const commitShadow = createShadowCommitHandler(
    selectedKnobElements.map(({ id }) => ({
      elementType: 'knob',
      id,
    })),
    handleBatchShadowChangeComplete,
    handleBatchShadowEnabledChange ?? (() => undefined),
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
                    className="w-[18px] h-[18px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors flex-shrink-0"
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
              <span className="text-fg-faint text-body">
                ({selectedKnobElements.length})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={batchScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            <BatchStyleTabContent
              selectedCount={selectedKnobElements.length}
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
              handleBatchStyleChange={handleBatchStyleChange}
              handleBatchStyleChangeComplete={handleBatchStyleChangeComplete}
              handleBatchShadowChangeComplete={handleBatchShadowChangeComplete}
              handleBatchShadowEnabledChange={handleBatchShadowEnabledChange}
              handleBatchGradientCommit={handleBatchGradientCommit}
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
              commitBoundInactiveImage(
                knobImageBinding.binding,
                knobImageBinding.selection,
                imageUrl,
                () => handleKnobBatchSharedSetting({ inactiveImage: imageUrl }),
              );
            }}
            onActiveImageChange={(imageUrl: string) => {
              commitBoundActiveImage(
                knobImageBinding.binding,
                knobImageBinding.selection,
                imageUrl,
                () => handleKnobBatchSharedSetting({ activeImage: imageUrl }),
              );
            }}
            onIdleTransparentChange={(value: boolean) => {
              commitBoundIdleTransparent(
                knobTransparencyBinding.binding,
                knobTransparencyBinding.selection,
                value,
                () => handleKnobBatchSharedSetting({ idleTransparent: value }),
              );
            }}
            onActiveTransparentChange={(value: boolean) => {
              commitBoundActiveTransparent(
                knobTransparencyBinding.binding,
                knobTransparencyBinding.selection,
                value,
                () =>
                  handleKnobBatchSharedSetting({ activeTransparent: value }),
              );
            }}
            onIdleImageReset={() => {
              commitBoundInactiveImage(
                knobImageBinding.binding,
                knobImageBinding.selection,
                '',
                () => handleKnobBatchSharedSetting({ inactiveImage: '' }),
              );
            }}
            onActiveImageReset={() => {
              commitBoundActiveImage(
                knobImageBinding.binding,
                knobImageBinding.selection,
                '',
                () => handleKnobBatchSharedSetting({ activeImage: '' }),
              );
            }}
            onClose={() => setShowBatchImagePicker(false)}
          />
        ) : null}
      </PopupExit>
    </div>
  );
};
