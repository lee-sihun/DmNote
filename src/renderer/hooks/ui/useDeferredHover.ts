import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 가리키는 대상을 붙잡는다.
 *
 * 행을 옮기면 떠난 행의 mouseleave와 들어온 행의 mouseenter가 따로 오고,
 * 그 사이 렌더에서 대상이 비어 화면이 한 프레임 통째로 사라진다.
 * 해제만 한 박자 미루면 바로 뒤따라오는 진입이 취소한다.
 */
export const useDeferredHover = (
  delayMs = 90,
): [string | null, (key: string | null) => void] => {
  const [hovered, setHovered] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const cancel = (): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hover = useCallback(
    (key: string | null): void => {
      cancel();
      if (key !== null) {
        setHovered(key);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setHovered(null);
      }, delayMs);
    },
    [delayMs],
  );

  useEffect(() => cancel, []);

  return [hovered, hover];
};
