import { create } from 'zustand';

interface CommittedApplyState {
  // canonical 반영마다 증가 - 열린 피커·패널이 낡은 로컬 값을 다음 커밋에
  // 재저장하지 않게 재동기화 시점을 알린다 (undo/redo, 플러그인, 다른 창 포함)
  commitTick: number;
  // undo/redo 반영에만 증가 - 진행 중 드래그와 미커밋 초안을 취소하는 신호.
  // 일반 커밋 echo에는 올리지 않아 직전 커밋 뒤 시작한 드래그를 끊지 않는다
  historyTick: number;
  bump: (origin: string | undefined) => void;
}

/** editorStateCoordinator의 onCommittedApplied에서 bump */
export const useCommittedApplyStore = create<CommittedApplyState>((set) => ({
  commitTick: 0,
  historyTick: 0,
  bump: (origin) =>
    set((state) => ({
      commitTick: state.commitTick + 1,
      historyTick:
        origin === 'historyUndo' || origin === 'historyRedo'
          ? state.historyTick + 1
          : state.historyTick,
    })),
}));
