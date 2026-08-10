import { createContext } from 'react';
import type { PopupMotionState } from '@hooks/ui/usePopupPresence';

// 자손이 부모의 퇴장을 알아야 하는 경우가 있다. 부모가 닫히기 시작하면
// 자식 팝업은 잔상을 남기지 않고 즉시 정리돼야 레이어 소유권도 함께 풀린다
export const FloatingPopupMotionContext =
  createContext<PopupMotionState>('open');
