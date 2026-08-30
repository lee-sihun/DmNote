import { useEffect } from 'react';
import { installPointerFocusGuard } from '@utils/focus/pointerFocusGuard';

// 창(ownerDocument)마다 클릭 잔류 포커스 가드 설치 - 분리 패널 창 포함
export const usePointerFocusGuard = (ownerDocument?: Document) => {
  useEffect(
    () => installPointerFocusGuard(ownerDocument ?? document),
    [ownerDocument],
  );
};
