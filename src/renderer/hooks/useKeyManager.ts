import { useState, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  useHistoryStatusStore,
  syncHistoryStatus,
} from '@stores/data/useHistoryStatusStore';
import { historyApi } from '@api/modules/historyApi';
import {
  reconcileSelectionAfterIndexedElementDeletion,
  useGridSelectionStore,
} from '@stores/grid/useGridSelectionStore';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { setUndoRedoInProgress } from '@api/pluginDisplayElements';
import { removeDisplayElementsInternal } from '@plugins/runtime/displayElement/displayElementApi';
import type {
  KeyMappings,
  KeyPositions,
  NoteColor,
  KeyCounterSettings,
  ImageFit,
} from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';

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
  counter?: KeyCounterSettings;
};

/** 플러그인 요소에서 zIndex + bounds 정보 추출 */
function getPluginExternalElements(): ExternalZIndexSource[] {
  const pluginElements = selectPropertyPanelPluginElements(
    usePluginDisplayElementStore.getState(),
  );
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
  const pluginElements = selectPropertyPanelPluginElements(
    usePluginDisplayElementStore.getState(),
  );
  return pluginElements.map((el) => el.zIndex ?? 0);
}

// 프리뷰 patch 구성: undefined 필드 제외, width/height는 유효 숫자만
const buildPreviewPatch = (
  updates: Record<string, unknown>,
): Record<string, unknown> | null => {
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (
      (field === 'width' || field === 'height') &&
      (typeof value !== 'number' || Number.isNaN(value))
    ) {
      continue;
    }
    patch[field] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
};

export function useKeyManager() {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  // 커밋 base는 canonical - rendered에는 다른 세션의 미커밋 프리뷰가 섞일 수 있음
  const canonicalPositions = useKeyStore((state) => state.canonicalPositions);
  const setKeyMappings = useKeyStore((state) => state.setKeyMappings);
  const setPositions = useKeyStore((state) => state.setPositions);
  const setLocalUpdateInProgress = useKeyStore(
    (state) => state.setLocalUpdateInProgress,
  );

  const [selectedKey, setSelectedKey] = useState<SelectedKey>(null);

  // undo/redo 로컬 single-flight 가드
  const historyActionInFlightRef = useRef(false);

  // ────────────────────────────────────────────────────────────────────────
  // 키 CRUD
  // ────────────────────────────────────────────────────────────────────────

  const handlePositionChange = (index: number, dx: number, dy: number) => {
    const nextPositions = updateKeyPosition(
      canonicalPositions,
      selectedKeyType,
      index,
      dx,
      dy,
    );
    setPositions(nextPositions);
    editGestureController.settleCommit(
      persistPositions(
        nextPositions,
        editGestureController.activeGestureId() ?? undefined,
      ),
    );
  };

  const handleKeyUpdate = (keyData: KeyUpdatePayload) => {
    const mapping = keyMappings[selectedKeyType] || [];
    const pos = canonicalPositions[selectedKeyType] || [];

    if (selectedKey) {
      const updatedMappings: KeyMappings = {
        ...keyMappings,
        [selectedKeyType]: mapping.map((value, idx) =>
          idx === selectedKey.index ? keyData.key : value,
        ),
      };

      const updatedPositions: KeyPositions = {
        ...canonicalPositions,
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
                // 모달 Save의 counter까지 단일 커밋으로 병합 (이중 커밋 방지)
                counter: keyData.counter
                  ? normalizeCounterSettings(keyData.counter)
                  : value.counter,
              }
            : value,
        ),
      };

      setKeyMappings(updatedMappings);
      setPositions(updatedPositions);
      editGestureController.settleCommit(
        persistMappingsAndPositions(
          updatedMappings,
          updatedPositions,
          editGestureController.activeGestureId() ?? undefined,
        ),
      );
      setSelectedKey(null);
    }
  };

  const handleAddKey = () => {
    const result = addKey(keyMappings, canonicalPositions, selectedKeyType);
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleAddKeyAt = (dx: number, dy: number) => {
    const result = addKey(
      keyMappings,
      canonicalPositions,
      selectedKeyType,
      dx,
      dy,
    );
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleDuplicateKey = (sourceIndex: number, dx: number, dy: number) => {
    const result = duplicateKey(
      keyMappings,
      canonicalPositions,
      selectedKeyType,
      sourceIndex,
      dx,
      dy,
    );
    if (!result) return;

    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
  };

  const handleDeleteKey = (indexToDelete: number) => {
    const result = removeKey(
      keyMappings,
      canonicalPositions,
      selectedKeyType,
      indexToDelete,
    );
    setKeyMappings(result.mappings);
    setPositions(result.positions);
    persistMappingsAndPositions(result.mappings, result.positions);
    reconcileSelectionAfterIndexedElementDeletion('key', indexToDelete);
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
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateNoteColor(
      state.canonicalPositions,
      mode,
      index,
      {
        noteColor,
        noteOpacity,
        noteGlowEnabled,
        noteGlowSize,
        noteGlowOpacity,
        noteGlowColor,
      },
    );
    setPositions(updatedPositions);
    editGestureController.settleCommit(
      persistPositions(
        updatedPositions,
        editGestureController.activeGestureId() ?? undefined,
      ),
    );
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
    if (!(state.canonicalPositions[mode] || [])[index]) return;
    editGestureController.preview(mode, [
      {
        index,
        patch: {
          noteColor,
          noteOpacity,
          noteGlowEnabled,
          noteGlowSize,
          noteGlowOpacity,
          noteGlowColor: noteGlowColor ?? noteColor,
          ...(noteAutoYCorrection !== undefined && { noteAutoYCorrection }),
          ...(noteEffectEnabled !== undefined && { noteEffectEnabled }),
        },
      },
    ]);
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
    if (!(state.canonicalPositions[mode] || [])[index]) return;

    const patch = buildPreviewPatch(updates);
    if (!patch) return;
    editGestureController.preview(mode, [{ index, patch }]);
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

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const current = state.canonicalPositions[mode] || [];

    const entries: Array<{ index: number; patch: Record<string, unknown> }> =
      [];
    for (const { index, ...fields } of updates) {
      if (!current[index]) continue;
      const patch = buildPreviewPatch(fields);
      if (patch) entries.push({ index, patch });
    }
    if (entries.length === 0) return;
    editGestureController.preview(mode, entries);
  };

  const handleCounterSettingsUpdate = (
    index: number,
    payload: KeyCounterSettings,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = updateCounterSettings(
      state.canonicalPositions,
      mode,
      index,
      payload,
    );
    setPositions(updatedPositions);
    editGestureController.settleCommit(
      persistPositions(
        updatedPositions,
        editGestureController.activeGestureId() ?? undefined,
      ),
    );
  };

  const handleCounterSettingsPreview = (
    index: number,
    payload: KeyCounterSettings,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    if (!(state.canonicalPositions[mode] || [])[index]) return;
    editGestureController.preview(mode, [
      { index, patch: { counter: normalizeCounterSettings(payload) } },
    ]);
  };

  // ────────────────────────────────────────────────────────────────────────
  // z-order 이동
  // ────────────────────────────────────────────────────────────────────────

  const handleMoveToFront = async (index: number) => {
    const pos = canonicalPositions[selectedKeyType] || [];
    const updated = computeMoveToFront(pos, index, getPluginZIndexes());
    const updatedPositions: KeyPositions = {
      ...canonicalPositions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveToBack = async (index: number) => {
    const pos = canonicalPositions[selectedKeyType] || [];
    const updated = computeMoveToBack(pos, index, getPluginZIndexes());
    const updatedPositions: KeyPositions = {
      ...canonicalPositions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveForward = async (index: number) => {
    const pos = canonicalPositions[selectedKeyType] || [];
    const updated = computeMoveForward(pos, index, getPluginExternalElements());
    const updatedPositions: KeyPositions = {
      ...canonicalPositions,
      [selectedKeyType]: updated,
    };
    await persistPositionsWithSync(
      updatedPositions,
      setPositions,
      setLocalUpdateInProgress,
    );
  };

  const handleMoveBackward = async (index: number) => {
    const pos = canonicalPositions[selectedKeyType] || [];
    const updated = computeMoveBackward(
      pos,
      index,
      getPluginExternalElements(),
    );
    const updatedPositions: KeyPositions = {
      ...canonicalPositions,
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
    if (!(state.canonicalPositions[mode] || [])[index]) return;

    const updatedPositions = updateKeyStyle(
      state.canonicalPositions,
      mode,
      index,
      updates,
    );
    editGestureController.settleCommit(
      persistPositionsWithFlag(
        updatedPositions,
        setPositions,
        setLocalUpdateInProgress,
        editGestureController.activeGestureId() ?? undefined,
      ),
    );
  };

  const handleKeyBatchStyleUpdate = (
    updates: Array<{ index: number } & Partial<KeyPositions[string][number]>>,
    options?: { deferSave?: boolean },
  ) => {
    if (updates.length === 0) return;

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const updatedPositions = batchUpdateKeyStyle(
      state.canonicalPositions,
      mode,
      updates,
    );
    if (updatedPositions === state.canonicalPositions) return;

    if (options?.deferSave) {
      setPositions(updatedPositions);
      return;
    }
    editGestureController.settleCommit(
      persistPositionsWithFlag(
        updatedPositions,
        setPositions,
        setLocalUpdateInProgress,
        editGestureController.activeGestureId() ?? undefined,
      ),
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // 리셋 / undo / redo
  // ────────────────────────────────────────────────────────────────────────

  const handleResetCurrentMode = async () => {
    try {
      const res = await window.api.keys.resetMode(selectedKeyType);
      // 백엔드가 초기화를 수행한 경우에만 후속 정리 — 커스텀 탭도 이제 지원됨
      if (!res.success) return;
      // 이 탭에 놓인 플러그인 표시 요소도 함께 제거 (백엔드 저장소와 별개)
      const staleElements = usePluginDisplayElementStore
        .getState()
        .elements.filter((el) => el.tabId === selectedKeyType);
      removeDisplayElementsInternal(
        staleElements.map((element) => element.fullId),
      );
      setSelectedKey(null);
      useGridSelectionStore.getState().clearSelection();
    } catch (error) {
      console.error('Failed to reset current mode', error);
    }
  };

  // undo/redo는 백엔드 authority가 실행 - 복원 결과는 canonical 이벤트로 각 창에 전파
  // 플러그인 표시 요소는 백엔드 canonical 승격 전까지 undo 대상이 아님
  const executeHistoryAction = async (
    direction: 'undo' | 'redo',
  ): Promise<void> => {
    // 로컬 single-flight - 연타가 busy 검사를 동시에 통과하는 것 방지
    if (historyActionInFlightRef.current) return;
    if (useHistoryStatusStore.getState().busy) return;
    historyActionInFlightRef.current = true;
    setUndoRedoInProgress(true);
    try {
      // 현재 창 프리뷰 취소 후 백엔드가 모든 편집 창의 저장을 정산
      editGestureController.cancel();

      const operationId = crypto.randomUUID();
      const status =
        direction === 'undo'
          ? await historyApi.undo(operationId)
          : await historyApi.redo(operationId);
      useHistoryStatusStore.getState().applyStatus(status);
    } catch (error) {
      const message = String(error);
      const nothingToApply =
        message.includes('HISTORY_NOTHING_TO_UNDO') ||
        message.includes('HISTORY_NOTHING_TO_REDO');
      if (!nothingToApply) {
        console.error(`Failed to apply ${direction}`, error);
      }
      void syncHistoryStatus();
    } finally {
      historyActionInFlightRef.current = false;
      setUndoRedoInProgress(false);
    }
  };

  const handleUndo = () => void executeHistoryAction('undo');
  const handleRedo = () => void executeHistoryAction('redo');

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
  };
}
