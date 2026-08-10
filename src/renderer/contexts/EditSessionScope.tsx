import { createContext, useContext, type ReactNode } from 'react';

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
