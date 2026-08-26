import { useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  useHistoryStatusStore,
  syncHistoryStatus,
} from '@stores/data/useHistoryStatusStore';
import { historyApi } from '@api/modules/historyApi';
import { rebindKeySlotById } from '@src/renderer/editor/runtime/elementOps';
import {
  reportElementOpError,
  reportElementOpSkipped,
} from '@src/renderer/editor/runtime/elementIntent';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { setUndoRedoInProgress } from '@api/pluginDisplayElements';
import type { KeySlot } from '@src/types/key/keys';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { keysApi } from '@api/modules/keysApi';

export function useKeyManager() {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);

  // undo/redo 로컬 single-flight 가드
  const historyActionInFlightRef = useRef(false);

  const handleKeyMappingChange = (index: number, newSlot: KeySlot) => {
    // keys 단독 full-record 커밋은 same-shape 재정렬과 겹치면 다른 위치
    // id와 잘못 결합된다 - 위치 안정 id로 paired index를 재결합해 커밋
    const positionId =
      useKeyStore.getState().canonicalPositions[selectedKeyType]?.[index]?.id;
    if (!positionId) {
      reportElementOpSkipped('missing canonical key position id');
      return;
    }
    void rebindKeySlotById(positionId, newSlot).catch(reportElementOpError);
  };

  // ────────────────────────────────────────────────────────────────────────
  // 리셋 / undo / redo
  // ────────────────────────────────────────────────────────────────────────

  const handleResetCurrentMode = async () => {
    try {
      const res = await keysApi.resetMode(selectedKeyType);
      // 백엔드가 초기화를 수행한 경우에만 후속 정리 — 커스텀 탭도 이제 지원됨
      if (!res.success) return;
      useGridSelectionStore.getState().clearSelection();
    } catch (error) {
      console.error('Failed to reset current mode', error);
    }
  };

  // undo/redo는 백엔드 authority가 실행 - 복원 결과는 canonical 이벤트로 각 창에 전파
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
    keyMappings,
    positions,
    handleKeyMappingChange,
    handleResetCurrentMode,
    handleUndo,
    handleRedo,
  };
}
