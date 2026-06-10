import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useDialItemStore } from '@stores/data/useDialItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { setUndoRedoInProgress } from '@api/pluginDisplayElements';
import type {
  KeyMappings,
  KeyPositions,
  NoteColor,
  KeyCounterSettings,
  ImageFit,
} from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

// editor/model — 순수 상태 변환 함수
import {
  addKey,
  removeKey,
  duplicateKey,
  updateKeyPosition,
  updateKeyStyle,
  batchUpdateKeyStyle,
  updateNoteColor,
  updateCounterSettings,
  updateKeyMapping,
} from '@src/renderer/editor/model/keys';
import {
  computeMoveToFront,
  computeMoveToBack,
  computeMoveForward,
  computeMoveBackward,
  type ExternalZIndexSource,
} from '@src/renderer/editor/model/zOrder';

// editor/runtime — store/API 연동
import {
  pushCurrentStateToHistory,
  applyRestoredStateToStores,
  applyRestoredPluginElements,
  persistRestoredState,
} from '@src/renderer/editor/runtime/editorSnapshot';
import {
  persistPositionsWithSync,
  persistMappingsAndPositions,
  persistPositions,
  persistPositionsWithFlag,
} from '@src/renderer/editor/runtime/persistState';

type SelectedKey = { key: string; index: number } | null;

type KeyUpdatePayload = {
  key: string;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  width: number;
  height: number;
  noteColor?: NoteColor;
  noteOpacity?: number;
  noteEffectEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowEnabled?: boolean;
  noteGlowColor?: NoteColor;
  noteAutoYCorrection?: boolean;
  className?: string;
};

/** 플러그인 요소에서 zIndex + bounds 정보 추출 */
function getPluginExternalElements(): ExternalZIndexSource[] {
  const pluginElements = usePluginDisplayElementStore.getState().elements;
  return pluginElements.map((el) => ({
    zIndex: el.zIndex ?? 0,
    bounds: {
      x: el.position.x,
      y: el.position.y,
      width: el.measuredSize?.width ?? el.estimatedSize?.width ?? 100,
      height: el.measuredSize?.height ?? el.estimatedSize?.height ?? 100,
    },
  }));
}

/** 플러그인 요소의 zIndex 목록 추출 */
function getPluginZIndexes(): number[] {
  const pluginElements = usePluginDisplayElementStore.getState().elements;
  return pluginElements.map((el) => el.zIndex ?? 0);
}

export function useKeyManager() {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  const setKeyMappings = useKeyStore((state) => state.setKeyMappings);
  const setPositions = useKeyStore((state) => state.setPositions);
  const setLocalUpdateInProgress = useKeyStore(
    (state) => state.setLocalUpdateInProgress,
  );

  const canUndo = useHistoryStore((state) => state.canUndo);
  const canRedo = useHistoryStore((state) => state.canRedo);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);

  const [selectedKey, setSelectedKey] = useState<SelectedKey>(null);

  // preview 시작 시 히스토리 저장 여부 추적
  // preview가 store를 직접 변경하므로, commit 시점이 아닌 preview 시작 시점에 저장해야 함
  const previewHistorySavedRef = useRef(false);

  // ────────────────────────────────────────────────────────────────────────
  // 키 CRUD
  // ────────────────────────────────────────────────────────────────────────

  const handlePositionChange = (index: number, dx: number, dy: number) => {
    const current = positions[selectedKeyType] || [];
    const oldPosition = current[index];
    if (oldPosition && (oldPosition.dx !== dx || oldPosition.dy !== dy)) {
      pushCurrentStateToHistory();
    }

    const nextPositions = updateKeyPosition(
      positions,
      selectedKeyType,
      index,
      dx,
      dy,
    );
    setPositions(nextPositions);
    persistPositions(nextPositions);
  };

  const handleKeyUpdate = (keyData: KeyUpdatePayload) => {
    pushCurrentStateToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];

    if (selectedKey) {
      const updatedMappings: KeyMappings = {
        ...keyMappings,
        [selectedKeyType]: mapping.map((value, idx) =>
          idx === selectedKey.index ? keyData.key : value,
        ),
      };

      const updatedPositions: KeyPositions = {
        ...positions,
        [selectedKeyType]: pos.map((value, idx) =>
          idx === selectedKey.index
            ? {
                ...value,
                activeImage: keyData.activeImage ?? value.activeImage,
                inactiveImage: keyData.inactiveImage ?? value.inactiveImage,
                activeTransparent:
                  keyData.activeTransparent ?? value.activeTransparent ?? false,
                idleTransparent:
                  keyData.idleTransparent ?? value.idleTransparent ?? false,
                width: keyData.width,
                height: keyData.height,
                noteColor: keyData.noteColor ?? value.noteColor ?? '#FFFFFF',
                noteOpacity: keyData.noteOpacity ?? value.noteOpacity ?? 80,
                noteEffectEnabled:
                  keyData.noteEffectEnabled ?? value.noteEffectEnabled ?? true,
                noteGlowEnabled:
                  keyData.noteGlowEnabled ?? value.noteGlowEnabled ?? true,
                noteGlowSize: keyData.noteGlowSize ?? value.noteGlowSize ?? 20,
                noteGlowOpacity:
                  keyData.noteGlowOpacity ?? value.noteGlowOpacity ?? 70,
                noteGlowColor: keyData.noteGlowColor ?? value.noteGlowColor,
                noteAutoYCorrection:
                  keyData.noteAutoYCorrection ??
                  value.noteAutoYCorrection ??
                  true,
                className: keyData.className ?? value.className ?? '',
              }
            : value,
        ),
      };

      setKeyMappings(updatedMappings);
      setPositions(updatedPositions);
      persistMappingsAndPositions(updatedMappings, updatedPositions);
      setSelectedKey(null);
    }
  };

  const handleAddKey = () => {
    pushCurrentStateToHistory();
    const result = addKey(keyMappings, positions, selectedKeyType);
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleAddKeyAt = (dx: number, dy: number) => {
    pushCurrentStateToHistory();
    const result = addKey(keyMappings, positions, selectedKeyType, dx, dy);
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleDuplicateKey = (sourceIndex: number, dx: number, dy: number) => {
    const result = duplicateKey(
      keyMappings,
      positions,
      selectedKeyType,
      sourceIndex,
      dx,
      dy,
    );
    if (!result) return;

    pushCurrentStateToHistory();
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleDeleteKey = (indexToDelete: number) => {
    pushCurrentStateToHistory();
    const result = removeKey(
      keyMappings,
      positions,
      selectedKeyType,
      indexToDelete,
    );
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
    setSelectedKey(null);
  };

  // ────────────────────────────────────────────────────────────────────────
  // 스타일 / 노트 / 카운터 업데이트
  // ────────────────────────────────────────────────────────────────────────

  const handleNoteColorUpdate = (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor | undefined,
  ) => {
    pushCurrentStateToHistory();
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateNoteColor(state.positions, mode, index, {
      noteColor,
      noteOpacity,
      noteGlowEnabled,
      noteGlowSize,
      noteGlowOpacity,
      noteGlowColor,
    });
    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  const handleNoteColorPreview = (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor | undefined,
    noteAutoYCorrection?: boolean,
    noteEffectEnabled?: boolean,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateNoteColor(state.positions, mode, index, {
      noteColor,
      noteOpacity,
      noteGlowEnabled,
      noteGlowSize,
      noteGlowOpacity,
      noteGlowColor,
      noteAutoYCorrection,
      noteEffectEnabled,
    });
    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  const handleKeyPreview = (
    index: number,
    updates: Partial<{
      activeImage: string;
      inactiveImage: string;
      soundPath: string;
      soundVolume: number;
      activeTransparent: boolean;
      idleTransparent: boolean;
      width: number;
      height: number;
      className: string;
      backgroundColor: string;
      activeBackgroundColor: string;
      borderColor: string;
      activeBorderColor: string;
      borderWidth: number;
      borderRadius: number;
      fontSize: number;
      fontColor: string;
      activeFontColor: string;
      idleImageFit: ImageFit;
      activeImageFit: ImageFit;
      imageFit: ImageFit;
      useInlineStyles: boolean;
      displayText: string;
    }>,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const current = state.positions[mode] || [];
    if (!current[index]) return;

    // preview가 store를 직접 변경하므로, 첫 preview 시 히스토리 저장
    if (!previewHistorySavedRef.current) {
      pushCurrentStateToHistory();
      previewHistorySavedRef.current = true;
    }

    // 프리뷰는 필드별 undefined 체크를 유지해야 하므로 직접 매핑
    const updatedPositions: KeyPositions = {
      ...state.positions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              activeImage:
                updates.activeImage !== undefined
                  ? updates.activeImage
                  : pos.activeImage,
              inactiveImage:
                updates.inactiveImage !== undefined
                  ? updates.inactiveImage
                  : pos.inactiveImage,
              soundPath:
                updates.soundPath !== undefined
                  ? updates.soundPath
                  : pos.soundPath,
              soundVolume:
                updates.soundVolume !== undefined
                  ? updates.soundVolume
                  : pos.soundVolume,
              activeTransparent:
                updates.activeTransparent !== undefined
                  ? updates.activeTransparent
                  : pos.activeTransparent ?? false,
              idleTransparent:
                updates.idleTransparent !== undefined
                  ? updates.idleTransparent
                  : pos.idleTransparent ?? false,
              width:
                typeof updates.width === 'number' &&
                !Number.isNaN(updates.width)
                  ? updates.width
                  : pos.width,
              height:
                typeof updates.height === 'number' &&
                !Number.isNaN(updates.height)
                  ? updates.height
                  : pos.height,
              className:
                updates.className !== undefined
                  ? updates.className
                  : pos.className ?? '',
              backgroundColor:
                updates.backgroundColor !== undefined
                  ? updates.backgroundColor
                  : pos.backgroundColor,
              activeBackgroundColor:
                updates.activeBackgroundColor !== undefined
                  ? updates.activeBackgroundColor
                  : pos.activeBackgroundColor,
              borderColor:
                updates.borderColor !== undefined
                  ? updates.borderColor
                  : pos.borderColor,
              activeBorderColor:
                updates.activeBorderColor !== undefined
                  ? updates.activeBorderColor
                  : pos.activeBorderColor,
              borderWidth:
                updates.borderWidth !== undefined
                  ? updates.borderWidth
                  : pos.borderWidth,
              borderRadius:
                updates.borderRadius !== undefined
                  ? updates.borderRadius
                  : pos.borderRadius,
              fontSize:
                updates.fontSize !== undefined
                  ? updates.fontSize
                  : pos.fontSize,
              fontColor:
                updates.fontColor !== undefined
                  ? updates.fontColor
                  : pos.fontColor,
              activeFontColor:
                updates.activeFontColor !== undefined
                  ? updates.activeFontColor
                  : pos.activeFontColor,
              idleImageFit:
                updates.idleImageFit !== undefined
                  ? updates.idleImageFit
                  : pos.idleImageFit,
              activeImageFit:
                updates.activeImageFit !== undefined
                  ? updates.activeImageFit
                  : pos.activeImageFit,
              imageFit:
                updates.imageFit !== undefined
                  ? updates.imageFit
                  : pos.imageFit,
              useInlineStyles:
                updates.useInlineStyles !== undefined
                  ? updates.useInlineStyles
                  : pos.useInlineStyles,
              displayText:
                updates.displayText !== undefined
                  ? updates.displayText
                  : pos.displayText,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  const handleKeyBatchPreview = (
    updates: Array<{
      index: number;
      activeImage?: string;
      inactiveImage?: string;
      soundPath?: string;
      soundVolume?: number;
      activeTransparent?: boolean;
      idleTransparent?: boolean;
      width?: number;
      height?: number;
      className?: string;
      backgroundColor?: string;
      activeBackgroundColor?: string;
      borderColor?: string;
      activeBorderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
      fontSize?: number;
      fontColor?: string;
      activeFontColor?: string;
      idleImageFit?: ImageFit;
      activeImageFit?: ImageFit;
      imageFit?: ImageFit;
      useInlineStyles?: boolean;
      displayText?: string;
      noteColor?: NoteColor;
      noteGlowColor?: NoteColor;
    }>,
  ) => {
    if (updates.length === 0) return;

    // preview가 store를 직접 변경하므로, 첫 preview 시 히스토리 저장
    if (!previewHistorySavedRef.current) {
      pushCurrentStateToHistory();
      previewHistorySavedRef.current = true;
    }

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const current = state.positions[mode] || [];

    const updateMap = new Map<number, (typeof updates)[number]>();
    for (const update of updates) {
      if (current[update.index]) {
        updateMap.set(update.index, update);
      }
    }
    if (updateMap.size === 0) return;

    const updatedPositions: KeyPositions = {
      ...state.positions,
      [mode]: current.map((pos, i) => {
        const update = updateMap.get(i);
        if (!update) return pos;

        return {
          ...pos,
          activeImage:
            update.activeImage !== undefined
              ? update.activeImage
              : pos.activeImage,
          inactiveImage:
            update.inactiveImage !== undefined
              ? update.inactiveImage
              : pos.inactiveImage,
          soundPath:
            update.soundPath !== undefined ? update.soundPath : pos.soundPath,
          soundVolume:
            update.soundVolume !== undefined
              ? update.soundVolume
              : pos.soundVolume,
          activeTransparent:
            update.activeTransparent !== undefined
              ? update.activeTransparent
              : pos.activeTransparent ?? false,
          idleTransparent:
            update.idleTransparent !== undefined
              ? update.idleTransparent
              : pos.idleTransparent ?? false,
          width:
            typeof update.width === 'number' && !Number.isNaN(update.width)
              ? update.width
              : pos.width,
          height:
            typeof update.height === 'number' && !Number.isNaN(update.height)
              ? update.height
              : pos.height,
          className:
            update.className !== undefined
              ? update.className
              : pos.className ?? '',
          backgroundColor:
            update.backgroundColor !== undefined
              ? update.backgroundColor
              : pos.backgroundColor,
          activeBackgroundColor:
            update.activeBackgroundColor !== undefined
              ? update.activeBackgroundColor
              : pos.activeBackgroundColor,
          borderColor:
            update.borderColor !== undefined
              ? update.borderColor
              : pos.borderColor,
          activeBorderColor:
            update.activeBorderColor !== undefined
              ? update.activeBorderColor
              : pos.activeBorderColor,
          borderWidth:
            update.borderWidth !== undefined
              ? update.borderWidth
              : pos.borderWidth,
          borderRadius:
            update.borderRadius !== undefined
              ? update.borderRadius
              : pos.borderRadius,
          fontSize:
            update.fontSize !== undefined ? update.fontSize : pos.fontSize,
          fontColor:
            update.fontColor !== undefined ? update.fontColor : pos.fontColor,
          activeFontColor:
            update.activeFontColor !== undefined
              ? update.activeFontColor
              : pos.activeFontColor,
          idleImageFit:
            update.idleImageFit !== undefined
              ? update.idleImageFit
              : pos.idleImageFit,
          activeImageFit:
            update.activeImageFit !== undefined
              ? update.activeImageFit
              : pos.activeImageFit,
          imageFit:
            update.imageFit !== undefined ? update.imageFit : pos.imageFit,
          useInlineStyles:
            update.useInlineStyles !== undefined
              ? update.useInlineStyles
              : pos.useInlineStyles,
          displayText:
            update.displayText !== undefined
              ? update.displayText
              : pos.displayText,
          noteColor:
            update.noteColor !== undefined ? update.noteColor : pos.noteColor,
          noteGlowColor:
            update.noteGlowColor !== undefined
              ? update.noteGlowColor
              : pos.noteGlowColor,
        };
      }),
    };

    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  const handleCounterSettingsUpdate = (
    index: number,
    payload: KeyCounterSettings,
  ) => {
    pushCurrentStateToHistory();
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateCounterSettings(
      state.positions,
      mode,
      index,
      payload,
    );
    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  const handleCounterSettingsPreview = (
    index: number,
    payload: KeyCounterSettings,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateCounterSettings(
      state.positions,
      mode,
      index,
      payload,
    );
    setPositions(updatedPositions);
    persistPositions(updatedPositions);
  };

  // ────────────────────────────────────────────────────────────────────────
  // z-order 이동
  // ────────────────────────────────────────────────────────────────────────

  const handleMoveToFront = async (index: number) => {
    pushCurrentStateToHistory();
    const pos = positions[selectedKeyType] || [];
    const updated = computeMoveToFront(pos, index, getPluginZIndexes());
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveToBack = async (index: number) => {
    pushCurrentStateToHistory();
    const pos = positions[selectedKeyType] || [];
    const updated = computeMoveToBack(pos, index, getPluginZIndexes());
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveForward = async (index: number) => {
    pushCurrentStateToHistory();
    const pos = positions[selectedKeyType] || [];
    const updated = computeMoveForward(pos, index, getPluginExternalElements());
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveBackward = async (index: number) => {
    pushCurrentStateToHistory();
    const pos = positions[selectedKeyType] || [];
    const updated = computeMoveBackward(
      pos,
      index,
      getPluginExternalElements(),
    );
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // 키 스타일 업데이트 (속성 패널)
  // ────────────────────────────────────────────────────────────────────────

  const handleKeyMappingChange = (index: number, newKey: string) => {
    pushCurrentStateToHistory();
    const updatedMappings = updateKeyMapping(
      keyMappings,
      selectedKeyType,
      index,
      newKey,
    );
    setKeyMappings(updatedMappings);
    window.api.keys.update(updatedMappings).catch((error) => {
      console.error('Failed to update key mapping', error);
    });
  };

  const handleKeyStyleUpdate = (
    index: number,
    updates: Partial<KeyPositions[string][number]>,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    if (!(state.positions[mode] || [])[index]) return;

    // preview에서 이미 히스토리를 저장했으면 skip
    if (!previewHistorySavedRef.current) {
      pushCurrentStateToHistory();
    }
    previewHistorySavedRef.current = false;
    const updatedPositions = updateKeyStyle(
      state.positions,
      mode,
      index,
      updates,
    );
    persistPositionsWithFlag(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleKeyBatchStyleUpdate = (
    updates: Array<{ index: number } & Partial<KeyPositions[string][number]>>,
    options?: { skipHistory?: boolean },
  ) => {
    if (updates.length === 0) return;

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = batchUpdateKeyStyle(
      state.positions,
      mode,
      updates,
    );
    if (updatedPositions === state.positions) return;

    // preview에서 이미 히스토리를 저장했으면 skip
    if (!options?.skipHistory && !previewHistorySavedRef.current) {
      pushCurrentStateToHistory();
    }
    previewHistorySavedRef.current = false;
    persistPositionsWithFlag(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // 리셋 / undo / redo
  // ────────────────────────────────────────────────────────────────────────

  const handleResetCurrentMode = async () => {
    try {
      await window.api.keys.resetMode(selectedKeyType);
      setSelectedKey(null);
    } catch (error) {
      console.error('Failed to reset current mode', error);
    }
  };

  const executeHistoryAction = async (
    action: typeof undo | typeof redo,
    label: string,
  ) => {
    setUndoRedoInProgress(true);
    try {
      const currentKeyState = useKeyStore.getState();
      const currentStatPositions = useStatItemStore.getState().positions;
      const currentGraphPositions = useGraphItemStore.getState().positions;
      const currentDialPositions = useDialItemStore.getState().positions;
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
      const targetState = action({
        keyMappings: currentKeyState.keyMappings,
        positions: currentKeyState.positions,
        statPositions: currentStatPositions,
        graphPositions: currentGraphPositions,
        dialPositions: currentDialPositions,
        pluginElements: currentPluginElements,
        layerGroups: currentLayerGroups,
      });

      if (targetState) {
        applyRestoredStateToStores(targetState);

        applyRestoredPluginElements(
          targetState.pluginElements as
            | PluginDisplayElementInternal[]
            | undefined,
          currentPluginElements,
          targetState.pluginElements
            ? new Set(targetState.pluginElements.map((el) => el.fullId))
            : undefined,
        );

        try {
          await persistRestoredState(targetState);
        } catch (error) {
          console.error(`Failed to apply ${label}`, error);
        }
      }
    } finally {
      setUndoRedoInProgress(false);
    }
  };

  const handleUndo = () => executeHistoryAction(undo, 'undo');
  const handleRedo = () => executeHistoryAction(redo, 'redo');

  return {
    selectedKey,
    setSelectedKey,
    keyMappings,
    positions,
    handlePositionChange,
    handleKeyUpdate,
    handleKeyPreview,
    handleKeyBatchPreview,
    handleKeyStyleUpdate,
    handleKeyBatchStyleUpdate,
    handleKeyMappingChange,
    handleNoteColorUpdate,
    handleNoteColorPreview,
    handleCounterSettingsUpdate,
    handleCounterSettingsPreview,
    handleAddKey,
    handleAddKeyAt,
    handleDuplicateKey,
    handleDeleteKey,
    handleMoveToFront,
    handleMoveToBack,
    handleMoveForward,
    handleMoveBackward,
    handleResetCurrentMode,
    handleUndo,
    handleRedo,
    canUndo: canUndo(),
    canRedo: canRedo(),
  };
}
