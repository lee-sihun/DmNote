import { invoke } from '@tauri-apps/api/core';

import { subscribe } from './shared';

// 백엔드 undo authority 상태 projection (B-3 전환에서 소비)
export interface HistoryStatus {
  historyRevision: number;
  // barrier(undo/redo·프리셋 복원) 시작마다 전진 - mutation의 낡은 관측 거절 기준
  historyEpoch: number;
  // 모든 status 발행마다 전진하는 단조 시퀀스 (busy 전환·실패 포함, 순서 역전 방지 기준)
  statusSeq: number;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  truncated?: { reason: string } | null;
}

export const historyApi = {
  status: () => invoke<HistoryStatus>('history_status'),
  undo: (operationId: string) =>
    invoke<HistoryStatus>('history_undo', { operationId }),
  redo: (operationId: string) =>
    invoke<HistoryStatus>('history_redo', { operationId }),
  onStatus: (listener: (status: HistoryStatus) => void) =>
    subscribe<HistoryStatus>('history:status', listener),
};
