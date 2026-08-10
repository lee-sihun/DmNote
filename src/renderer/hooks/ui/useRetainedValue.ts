import { useLayoutEffect, useRef } from 'react';

// 열려 있는 동안의 값을 붙잡는다. 호출부가 닫으면서 내용을 비우는 팝업·모달용 -
// 퇴장 구간에는 마지막 열림 값을 그대로 보여준다
export const useRetainedWhileOpen = <T>(open: boolean, value: T): T => {
  const latestRef = useRef(value);

  // 커밋된 렌더에서만 붙잡는다. 렌더 중에 쓰면 버려진 concurrent 렌더의 값이
  // 커밋된 값처럼 남아, 화면에 뜬 적 없는 내용이 퇴장 구간에 보일 수 있다
  useLayoutEffect(() => {
    if (open) latestRef.current = value;
  });

  // 닫히는 첫 렌더부터 마지막 열림 값을 돌려줘야 한다. state로 옮기면 한 커밋
  // 늦어서 그 사이 자식이 언마운트됐다 다시 붙고, 퇴장 모션과 편집 상태가 날아간다.
  // 렌더 중 ref 읽기지만 값은 직전 열림 커밋에서 확정된 것이라 안정적이다
  // eslint-disable-next-line react-hooks/refs
  return open ? value : latestRef.current;
};

// 값 자체가 열림 여부를 뜻하는 경우 - null이면 닫힌 것으로 보고 마지막 값을 유지한다
export const useRetainedValue = <T>(value: T | null | undefined): T | null =>
  useRetainedWhileOpen(value != null, value ?? null);
