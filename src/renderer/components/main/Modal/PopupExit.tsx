import React, { useState } from 'react';
import { usePopupPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';

interface PopupExitProps {
  open: boolean;
  /** 열려 있을 때만 만들어지는 팝업 엘리먼트. 닫히면 null을 줘도 된다 */
  children: React.ReactElement | null;
}

// 팝업 수명을 호출부 조건에서 떼어낸다.
//
// 대부분의 피커는 {대상 && <Picker open ... />} 형태라 대상이 비는 순간 통째로
// 언마운트돼 퇴장 모션이 돌 자리가 없다. 그렇다고 조건만 걷어내면 닫히는 동안
// 대상이 null인 채로 다시 렌더돼, 핸들러가 대상을 잃고 마지막 커밋을 버린다
// (드래그 중 언마운트 저장 계약 - colorPickerPrimitives 참고).
//
// 그래서 값이 아니라 엘리먼트를 통째로 붙잡는다. 퇴장 구간에는 마지막 열림
// 렌더에서 만든 엘리먼트를 그대로 쓰므로, props에 묶인 핸들러도 그때의 대상을
// 그대로 들고 있다. open만 현재 값으로 갈아끼워 퇴장 상태를 전달한다.
const PopupExit = ({ open, children }: PopupExitProps) => {
  const { mounted } = usePopupPresence(open);
  const retained = useRetainedWhileOpen(open, children);

  // 열 때마다 새 인스턴스. 퇴장 유예 동안 재오픈하면 인스턴스가 재사용돼
  // 피커의 탭·모드처럼 마운트 때 한 번만 잡는 상태가 되살아난다.
  //
  // presence의 cycle은 layout effect에서 오르므로 재오픈 첫 렌더에는 아직 옛 값이다.
  // 그 한 렌더 동안 옛 인스턴스가 새 대상을 받고, 그 상태로 언마운트되면서
  // 마지막 커밋을 엉뚱한 대상에 쏜다. 세션은 렌더 중에 끊어야 한다
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setSession((prev) => prev + 1);
  }

  if (!mounted || !retained) return null;

  return React.cloneElement(retained as React.ReactElement<{ open: boolean }>, {
    open,
    key: session,
  });
};

export default PopupExit;
