import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import {
  clearPendingCustomCursorHover,
  isCustomCursorHoverSuspended,
  setCustomCursorHover,
  setPendingCustomCursorHover,
  updatePendingCustomCursorHover,
  type CursorType,
} from '@utils/grid/cursorUtils';

// 캔버스 핸들 호버의 커스텀 커서 부기. 드래그 세션 중 enter는 보류했다가 릴리즈 뒤
// 포인터가 아직 핸들 안이면 적용하고, 호버 중 unmount로 leave가 유실되면 정리한다
export const useCustomCursorHover = (
  cursor: CursorType,
  onHoverChange?: (hovered: boolean) => void,
) => {
  const hoveredRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (pendingRef.current) {
      updatePendingCustomCursorHover(cursor, pendingRef.current);
    } else if (hoveredRef.current) {
      setCustomCursorHover(cursor);
    }
  }, [cursor]);

  useEffect(
    () => () => {
      if (pendingRef.current) {
        clearPendingCustomCursorHover(pendingRef.current);
        pendingRef.current = null;
      }
      if (hoveredRef.current) setCustomCursorHover(null);
    },
    [],
  );

  const setHovered = (next: boolean) => {
    hoveredRef.current = next;
    onHoverChange?.(next);
  };

  return {
    onPointerEnter: (event: PointerEvent) => {
      if (isCustomCursorHoverSuspended()) {
        const apply = () => {
          pendingRef.current = null;
          setHovered(true);
        };
        pendingRef.current = apply;
        setPendingCustomCursorHover(cursor, apply, event.nativeEvent);
        return;
      }
      setHovered(true);
      setCustomCursorHover(cursor, event.nativeEvent);
    },
    // 자기 보류 기록만 소거 - 다른 핸들의 pending은 건드리지 않는다
    onPointerLeave: (event: PointerEvent) => {
      if (pendingRef.current) {
        clearPendingCustomCursorHover(pendingRef.current);
        pendingRef.current = null;
      }
      setHovered(false);
      setCustomCursorHover(null, event.nativeEvent);
    },
  };
};
