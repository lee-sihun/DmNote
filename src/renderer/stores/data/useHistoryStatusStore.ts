import { create } from 'zustand';

import { historyApi, type HistoryStatus } from '@api/modules/editor/historyApi';

interface HistoryStatusState {
  historyRevision: number;
  historyEpoch: number;
  statusSeq: number;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  applyStatus: (status: HistoryStatus) => void;
}

/**
 * 백엔드 undo authority 상태 projection
 * 단조 statusSeq 기준으로만 최신을 선택해 busy 역전을 막음
 */
export const useHistoryStatusStore = create<HistoryStatusState>((set, get) => ({
  historyRevision: 0,
  historyEpoch: 0,
  statusSeq: 0,
  canUndo: false,
  canRedo: false,
  busy: false,
  applyStatus: (status) => {
    if (status.statusSeq <= get().statusSeq) return;
    set({
      historyRevision: status.historyRevision,
      historyEpoch: status.historyEpoch,
      statusSeq: status.statusSeq,
      canUndo: status.canUndo,
      canRedo: status.canRedo,
      busy: status.busy,
    });
  },
}));

/** bootstrap·재구독 시 현재 상태 조회 */
export const syncHistoryStatus = async (): Promise<void> => {
  try {
    const status = await historyApi.status();
    useHistoryStatusStore.getState().applyStatus(status);
  } catch (error) {
    console.error('Failed to sync history status', error);
  }
};
