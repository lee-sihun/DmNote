// 낙관 커밋 훅들이 예약해 둔(rAF+타이머) 커밋의 전역 목록.
// 종료·재시작·히스토리·패널 이동은 예약된 프레임을 기다릴 수 없어
// focusedEditorSettlement가 쓰기 barrier 안에서 대기 커밋을 확정한다

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
export const drainPendingOptimisticCommits = (): boolean => {
  const flushes = [...pendingFlushes];
  pendingFlushes.clear();
  let succeeded = true;
  for (const flush of flushes) {
    try {
      flush();
    } catch (error) {
      succeeded = false;
      console.error('Failed to flush a pending editor commit', error);
    }
  }
  return succeeded;
};
