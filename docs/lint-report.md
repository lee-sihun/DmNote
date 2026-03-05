# ESLint Report

## Warnings (718개) — 점진 개선 대상

| 수 | 규칙 | 원인 |
|---|---|---|
| **502** | `no-explicit-any` | 타입을 `any`로 선언한 곳. TS 마이그레이션이 불완전해서 타입 정의 대신 `any`를 쓴 경우 |
| **99** | `no-unused-vars` | 선언만 하고 실제로 사용하지 않는 변수/import. 리팩토링 과정에서 남은 잔재 |
| **60** | `react-hooks/exhaustive-deps` | `useEffect`/`useCallback`/`useMemo`의 의존성 배열에 빠진 값이 있음. 예: deps에 `count`를 안 넣었는데 콜백 안에서 `count`를 참조 |
| **49** | `react-hooks/rules-of-hooks` | 조건문(`if`) 안에서 Hook을 호출. React 규칙상 Hook은 항상 동일한 순서로 호출돼야 함 |
| **6** | `react-refresh/only-export-components` | 파일에서 컴포넌트 외의 것(상수, 유틸 함수 등)도 같이 export. Vite HMR이 제대로 안 될 수 있음 |
| **2** | `no-console` | `console.log()` 사용. `console.warn`/`console.error`만 허용 |

## Errors (78개) — react-compiler 관련

| 수 | 규칙 | 원인 |
|---|---|---|
| **33** | `setState in effect` | `useEffect` 안에서 동기적으로 `setState` 호출 -> 무한 렌더링 또는 불필요한 cascade 렌더 유발 가능 |
| **26** | `refs during render` | 렌더링 중에 `ref.current`를 읽음. ref는 렌더 후에만 읽어야 안정적 (렌더 중 값이 불확실) |
| **11** | `memoization skipped` | `useMemo`/`useCallback`의 의존성이 불안정해서 react-compiler가 최적화를 포기한 경우 |
| **3** | `variable before declared` | 변수 선언 전에 접근. 호이스팅 관련 문제 |
| **2** | `Function type` | `Function` 타입 사용 - 어떤 함수든 받아서 타입 안전성 없음. `() => void` 등 구체적 시그니처 필요 |
| **2** | `value cannot be modified` | react-compiler가 immutable로 판단한 값을 수정하려 함 |
| **1** | `impure function in render` | 렌더링 중 부수효과 함수 호출 (사이드이펙트는 `useEffect`에서 해야 함) |

## 요약

- **warning의 핵심**: `any` 타입 (전체의 ~70%)
- **error의 핵심**: 렌더링 중 잘못된 Hook/ref/setState 사용
- error는 전부 컴포넌트 구조 리팩토링이 필요한 항목
- warning은 점진적으로 개선 가능

## 진행 기록

| 시점 | errors | warnings | 비고 |
|------|--------|----------|------|
| Phase 1-2 전 | 78 | 718 | 초기 상태 |
| Phase 1-2 완료 | 76 | 794 | JS→TS 전환 완료, `any` 타입 증가 (의도적), TS 컴파일 에러 0개 |
| Phase 6 완료 | 0 | 818 | errors 전부 해결 (no-useless-assignment, react-hooks 규칙 정리), unused vars 다수 정리 |
| 최종 검증 | 0 | 868 | TS 0 errors, Vite build 통과 (29.3s), warnings는 대부분 `no-explicit-any` |
