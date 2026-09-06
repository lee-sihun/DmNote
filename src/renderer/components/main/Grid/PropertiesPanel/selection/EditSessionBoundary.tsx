import type { ReactNode } from 'react';

import { formatEditSessionTarget } from '@src/renderer/editor/runtime/intent/editSessionTarget';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';

interface EditSessionBoundaryProps {
  children: ReactNode;
}

// 편집 대상이 갈리면 편집 트리를 통째로 새로 마운트한다.
//
// 입력과 피커는 포커스나 열림이 유지되는 동안 새 prop을 반영하지 않는다
// (PropertyInputs의 !isFocused 동기화, StyleTabContent의 피커 열림 게이트).
// 그래서 대상만 갈리면 옛 draft가 살아남고, 다음 blur나 pointerup이 그 값을
// 새 대상에 저장한다. 언마운트는 blur도 pointerup도 만들지 않으므로
// 쓰기 자체가 사라진다 - 상태를 패널 상위가 들고 있어도 마찬가지다.
//
// 반드시 스크롤 뷰포트 **안쪽**에 둔다. 바깥에 두면 뷰포트 DOM이 함께 사라져
// 스크롤이 맨 위로 튀고 Lenis 인스턴스가 매번 재생성된다.
//
// 지문은 zustand 파생값이어야 한다. useState나 transition으로 만들면 갱신이
// sync lane을 벗어나 언마운트 정리가 예약 작업보다 늦어질 수 있다.
//
// 뷰포트 안의 내용 열을 겸한다. 별도 래퍼를 얹으면 중첩만 한 겹 늘고,
// 열 자체가 경계라는 사실이 코드에서 안 보인다
const EditSessionBoundary = ({ children }: EditSessionBoundaryProps) => {
  const mode = useKeyStore((state) => state.selectedKeyType);
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );

  return (
    <div
      key={formatEditSessionTarget(mode, selectedElements)}
      className="px-[12px] pb-[12px] flex flex-col gap-[12px]"
    >
      {children}
    </div>
  );
};

export default EditSessionBoundary;
