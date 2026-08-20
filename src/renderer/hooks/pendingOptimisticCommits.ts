// 낙관 커밋 훅들이 예약해 둔(rAF+타이머) 커밋의 전역 목록.
// 패널 분리/도킹은 창을 숨겨 그 창의 rAF를 멈추므로, 훅이 리마운트되지 않는 호스트 이동
// 직전에 대기 커밋을 지금 확정해야 한다 - usePanelHostStore.settleEditsBeforeMove가 비운다

const pendingFlushes = new Set<() => void>();

export const registerPendingOptimisticCommit = (
  flush: () => void,
): (() => void) => {
  pendingFlushes.add(flush);
  return () => {
    pendingFlushes.delete(flush);
  };
};

// flush가 자기 등록을 지워도 안전하게 스냅샷으로 순회
export const drainPendingOptimisticCommits = (): void => {
  const flushes = [...pendingFlushes];
  pendingFlushes.clear();
  flushes.forEach((flush) => flush());
};
