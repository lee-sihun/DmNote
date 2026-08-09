import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorShake } from './useErrorShake';

// 표시 시간이지 모션이 아니다. 모션 축소 설정에서도 그대로 유지해야
// 무엇이 잘못됐는지 읽을 시간이 남는다
const ERROR_HOLD_MS = 3000;

// 확정할 수 없는 입력을 알리는 상태. 링과 말풍선은 잠깐만 떠 있다가 스스로 접힌다 -
// 값을 고칠 때까지 계속 붉게 두면 좁은 패널에서 다음 입력을 방해한다.
//
// 에러가 값을 고칠 때까지 남아 있어야 하는 폼은 이 훅 대신 useErrorShake만 쓴다
export const useFieldError = () => {
  const [active, setActive] = useState(false);
  const { shaking, shake, stop, handleAnimationEnd } = useErrorShake();
  const holdRef = useRef<number | null>(null);

  const clearHold = () => {
    if (holdRef.current === null) return;
    window.clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  useEffect(() => clearHold, []);

  const clear = useCallback(() => {
    clearHold();
    setActive(false);
    stop();
  }, [stop]);

  const raise = useCallback(() => {
    clearHold();
    setActive(true);
    shake();
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null;
      setActive(false);
    }, ERROR_HOLD_MS);
  }, [shake]);

  return { active, shaking, raise, clear, handleAnimationEnd };
};
