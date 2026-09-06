import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react';

import { getEditSessionMode } from '@src/renderer/editor/runtime/intent/editSessionTarget';

// 이 아래 트리는 캔버스 편집 대상에 묶여 있다는 표시.
//
// 대상 전환 시 예약 작업을 버려야 하는 규칙은 속성 패널 안에서만 성립한다.
// 같은 피커 컴포넌트가 전역 플러그인 설정처럼 캔버스 선택과 무관한 곳에서도
// 쓰이므로, 그쪽까지 억제하면 멀쩡한 편집이 사라진다.
//
// 값은 상수라 provider가 재렌더를 만들지 않는다. 지금 대상이 무엇인지는
// 필요한 쪽이 getEditSessionTarget()으로 직접 읽는다
const EditSessionScopeContext = createContext(false);

interface EditSessionScopeProps {
  children: ReactNode;
}

export const EditSessionScope = ({ children }: EditSessionScopeProps) => (
  <EditSessionScopeContext.Provider value={true}>
    {children}
  </EditSessionScopeContext.Provider>
);

// eslint-disable-next-line react-refresh/only-export-components
export const useIsEditSessionScoped = (): boolean =>
  useContext(EditSessionScopeContext);

// 비동기 완료 콜백이 옛 편집 세션에 값을 연결하려 할 때 쓰는 가드.
//
// 네이티브 대화상자나 IPC 응답을 기다리는 동안 모드가 갈릴 수 있다.
// 이미 시작된 Promise는 언마운트로 취소되지 않으므로 마지막 연결 단계에서
// 직접 확인해야 한다. 자산 생성 자체는 막지 않는다 - 파일 복사와 preset 생성은
// 그대로 끝내고 옛 세션에 연결하는 한 걸음만 버린다.
//
// **모드만 비교한다.** 전체 대상 지문으로 넓히지 말 것 - 같은 모드에서
// A를 편집하다 B를 고른 경우는 옛 index가 여전히 A를 가리키므로 연결이 맞다.
// 같은 모드 안의 배열 재정렬은 이 가드가 잡지 못한다 (의도된 한계).
//
// 캔버스 대상에 묶이지 않은 곳(전역 키 설정 모달 등)에서는 항상 통과시킨다
// eslint-disable-next-line react-refresh/only-export-components
export const useEditSessionModeGuard = (): (() => boolean) => {
  const scoped = useIsEditSessionScoped();
  const sessionMode = useRef(getEditSessionMode());

  return useCallback(
    () => !scoped || sessionMode.current === getEditSessionMode(),
    [scoped],
  );
};

// 비동기 완료 콜백의 대상 결합 방식.
//
// session-mode: 위 mode guard 그대로 - 완료 writer가 실행 시점 모드를 다시
// 읽는 레거시 index 경로용 기본값.
// element-id: 가드를 통과시킨다 - 완료 콜백이 안정 ID applier로 라우팅되어
// 유효성 판정(현재 mode·index 재결정, 삭제 시 중단)을 resolver가 전담한다.
// 호출부는 대상 요소에 id가 있을 때만 element-id를 선언해야 한다
export type CompletionBinding = 'session-mode' | 'element-id';

// eslint-disable-next-line react-refresh/only-export-components
export const useEditSessionCompletionGuard = (
  binding: CompletionBinding = 'session-mode',
): (() => boolean) => {
  const isSameMode = useEditSessionModeGuard();
  return useCallback(
    () => binding === 'element-id' || isSameMode(),
    [binding, isSameMode],
  );
};
