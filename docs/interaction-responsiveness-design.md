# 인터랙션 반응성 개선 설계

> 작성일: 2026-08-07
>
> 상태: 설계 및 단일 토글 파일럿 준비
>
> 최초 적용 후보: 프로퍼티 패널 `그림자 사용` 토글
>
> 목표: 사용자 입력의 첫 시각 반응과 무거운 렌더·저장 작업을 분리하고, 검증된 패턴만 앱 전반으로 확대

전체 적용 후보는 [인터랙션 최적화 전수 인벤토리](./interaction-optimization-inventory.md)에서 관리한다.
기준선과 개선 결과는 [인터랙션 성능 개선 추적표](./interaction-performance-tracker.md)에 기록한다.

---

## 1. 배경

DmNote의 공통 `Checkbox`는 실제 네이티브 체크박스가 아니라 `role="switch"`를 사용하는 제어형 토글 컴포넌트다. 표시 상태는 상위에서 전달하는 `checked`에 의해 결정되며, 클릭 시 `onChange()`를 호출할 뿐 자체 상태를 소유하지 않는다.

사용처에 따라 상위 상태 갱신 경로가 다르기 때문에 같은 컴포넌트라도 체감 반응성이 달라질 수 있다.

- 로컬 React 상태만 바꾸는 토글
- Zustand Store와 전체 positions 배열을 갱신하는 토글
- 캔버스 렌더와 CSS paint를 유발하는 토글
- Tauri IPC 및 편집 문서 커밋까지 연결되는 토글
- 다중 선택 요소 전체를 계산하고 여러 Store를 갱신하는 토글

현재 공통 토글 모션은 `--ui-duration-base`인 180ms를 사용한다. `usePressGatedSwap`은 직접 클릭 후 300ms 이내의 상태 변경에만 전환 애니메이션을 허용하고, 외부 상태 변경은 즉시 표시한다. 이 동작은 애니메이션 발생 조건을 제어하지만 상태 갱신을 앞당기는 낙관적 업데이트는 아니다.

## 2. 핵심 판단

공통 `Checkbox`에 임시 상태를 일괄 추가하는 것만으로는 앱 전반의 반응성 문제를 안전하게 해결할 수 없다.

이유:

- 컴포넌트는 저장 성공·실패와 authoritative 상태를 알지 못한다.
- 현재 `onChange: () => void` 계약은 다음 목표 상태를 명시하지 않는다.
- 상위 반영 전에 연속 클릭하면 오래된 Props를 기준으로 같은 값을 반복 요청할 수 있다.
- Undo/Redo, 외부 이벤트, 다중 선택의 Mixed 상태와 임시 상태가 충돌할 수 있다.
- 실제 병목이 React 렌더, 전체 문서 복제, CSS paint라면 표시만 바꾸는 것으로 원인이 제거되지 않는다.

따라서 다음 원칙을 적용한다.

> 입력에 대한 첫 시각 반응은 긴급 작업으로 처리하고, 캔버스 렌더·정합성 처리·저장은 별도의 작업 경로와 우선순위로 처리한다.

## 3. 업계 기준과 사실상의 표준

대형 앱마다 구현은 다르지만 다음 원칙은 공통적이다.

1. **즉시 로컬 투영**: 사용자가 의도한 상태를 로컬 UI 또는 클라이언트 캐시에 먼저 반영
2. **authoritative 상태 유지**: 서버·백엔드·편집 문서는 최종 정합성의 기준으로 유지
3. **우선순위 분리**: 체크 표시와 입력 피드백을 긴급 작업으로, 무거운 렌더를 비긴급 작업으로 분류
4. **작업 분할**: 긴 메인 스레드 작업을 쪼개 브라우저가 입력과 paint를 처리할 기회 제공
5. **렌더 격리**: 변경된 항목만 구독하고 렌더하도록 상태와 컴포넌트 경계 설계
6. **저장 병합**: UI는 매번 반영하되 중간 저장 요청은 합치고 마지막 의도를 보존
7. **실사용 계측**: 평균만 보지 않고 p75/p95/p99, Long Task, 프레임 드롭과 저사양 환경을 함께 확인

### 3.1 반응성 예산

웹의 공식 사용자 반응성 지표는 INP(Interaction to Next Paint)다. INP는 입력 이벤트부터 다음 화면 갱신까지의 지연을 측정한다. 전통적인 RAIL 모델은 입력 후 100ms 이내의 시각 반응을 사용자가 즉각적인 것으로 인식하는 기준으로 제시한다.

DmNote 파일럿에서는 이 수치를 **목표 예산**으로 사용한다. 측정하지 않은 결과값을 문서에 기록하지 않으며, 기준 장비·데이터 규모·빌드 종류와 함께 실제 측정값만 남긴다.

## 4. 적용 가능한 최적화 패턴

### 4.1 낙관적 상태 투영

화면 상태를 먼저 변경하고 저장 결과에 따라 확정 또는 복구한다.

필수 조건:

- 다음 상태를 명시적으로 전달하는 API
- 요청 또는 mutation 식별자
- 마지막 사용자 의도 우선 처리
- 실패 시 롤백 또는 authoritative 상태 재조회
- 외부 상태 변경과의 조정 규칙

### 4.2 긴급 UI와 비긴급 작업 분리

토글 표시, 눌림 효과, 포커스는 긴급 업데이트로 처리한다. 전체 캔버스 렌더, 선택 요소 일괄 계산, 문서 커밋은 비긴급 작업으로 분리한다.

React `startTransition`은 React가 소유한 상태 갱신의 우선순위를 낮추는 데 사용할 수 있다. 단, Zustand 같은 외부 Store 갱신은 동기 처리될 수 있으므로 실제 효과를 계측해야 한다.

### 4.3 메인 스레드 양보

긴 작업을 한 이벤트 핸들러 안에서 모두 완료하지 않고 작업 경계를 나눈다.

```text
클릭
→ 즉시 시각 상태 반영
→ 다음 paint 기회
→ 무거운 계산·캔버스 갱신
→ 비동기 저장
```

후보 API는 `scheduler.yield()`, `scheduler.postTask()`, `requestAnimationFrame()`, 태스크 큐 분리 등이다. Tauri의 Windows WebView2와 macOS WKWebView 지원 범위가 다르므로 기능 감지와 fallback이 필요하다. 단순 `queueMicrotask()` 또는 해결된 Promise는 paint 전에 계속 실행될 수 있어 프레임 양보 수단으로 간주하지 않는다.

### 4.4 렌더 격리와 세밀한 구독

- Zustand selector로 필요한 필드만 구독
- 요소 ID와 인덱스 단위 상태 구독
- 변경되지 않은 객체와 배열의 참조 유지
- 안정적인 callback과 `React.memo` 경계 유지
- 속성 패널의 시각 상태와 캔버스 데이터 구독 분리
- 화면에 보이는 요소만 렌더하거나 큰 작업을 여러 프레임으로 분할

### 4.5 증분 patch

전체 positions 또는 전체 편집 문서를 매번 재구성하지 않고 변경된 요소와 필드만 표현한다.

```ts
{
  type: 'key',
  index: 3,
  patch: {
    shadow: { enabled: true },
  },
}
```

`EditorDocumentV1`과 `editor_commit`의 현재 atomic commit 계약은 유지해야 한다. UI와 Store 내부에서는 작은 patch를 사용하되, 저장 경계에서 안전하게 병합하는 방향을 검토한다.

### 4.6 Write-behind와 요청 병합

로컬 상태는 즉시 변경하고 저장은 비동기로 실행한다. 저장 중 같은 필드에 새 의도가 들어오면 중간 요청을 합치고 마지막 상태가 최종적으로 저장되도록 한다.

필수 조건:

- 앱 종료와 모드 전환 전 flush
- 실패한 mutation의 재시도 또는 폐기 규칙
- 마지막 사용자 의도 보존
- 다른 편집 필드와의 atomic commit 유지

### 4.7 렌더링·paint 비용 최적화

`box-shadow`, 큰 blur, 넓은 반투명 영역은 브라우저 paint 비용을 키울 수 있다.

검토 항목:

- 그림자를 별도 레이어 또는 pseudo-element로 분리
- 전체 그림자 스타일 재생성 대신 `opacity` 중심으로 전환
- 동일 그림자 스펙 재사용
- 변경된 캔버스 요소만 렌더
- `will-change`는 메모리 비용을 측정하고 제한적으로 사용

## 5. 파일럿 대상: `그림자 사용` 토글

### 5.1 현재 경로

```text
Checkbox
→ ShadowControls.handleEnabledToggle
→ onEnabledChange
→ 단일 또는 다중 그림자 patch 생성
→ Zustand positions 갱신
→ Grid 및 선택 요소 렌더
→ box-shadow paint
→ editor_commit 저장
```

관련 파일:

- `src/renderer/components/main/common/Checkbox.tsx`
- `src/renderer/hooks/usePressGatedSwap.ts`
- `src/renderer/components/main/Grid/PropertiesPanel/ShadowControls.tsx`
- `src/renderer/components/main/Grid/PropertiesPanel/single/StyleTabContent.tsx`
- `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent.tsx`
- `src/renderer/components/main/Grid/PropertiesPanel/batch/useBatchHandlers.ts`
- `src/renderer/hooks/useKeyManager.ts`
- `src/renderer/editor/runtime/persistState.ts`
- `src/renderer/editor/runtime/editorCoordinator.ts`

### 5.2 현재 확인된 특성

- Store는 IPC 응답 전에 갱신되므로 백엔드 왕복 대기 구조는 아니다.
- 체크 상태는 `idleShadow.enabled || activeShadow.enabled` Props로 다시 계산된다.
- 한 번의 마스터 토글이 대기·입력 그림자를 함께 변경한다.
- 다중 선택은 선택된 키·통계·노브를 순회하고 여러 Store를 갱신한다.
- 켜짐 상태 변경 시 `설정하기` 행이 추가·제거되어 패널 layout도 변한다.
- 캔버스 요소의 실제 `box-shadow`가 같은 변경에서 적용된다.
- 공통 토글 애니메이션 완료에는 180ms가 사용된다.

정적 분석만으로 병목의 비율을 단정하지 않는다. 이벤트 처리, React render, layout, paint, 저장 준비 시간을 각각 측정한 뒤 개선안을 선택한다.

## 6. 파일럿 실험 계획

### 6.1 원칙

- 공통 `Checkbox`의 기본 동작을 먼저 변경하지 않는다.
- `ShadowControls`의 마스터 토글 하나에만 실험을 적용한다.
- 단일 선택과 다중 선택을 별도 시나리오로 측정한다.
- 기준 빌드와 실험 빌드를 동일한 장비와 데이터로 비교한다.
- 실제 측정값 없이 성능 향상을 주장하지 않는다.

### 6.2 기준선 측정

다음 시점을 `performance.mark()` 또는 동등한 계측으로 기록한다.

1. `pointerdown`
2. `click` 핸들러 시작과 종료
3. 체크 상태가 DOM에 반영된 시점
4. 다음 paint 이후 시점
5. Store 갱신 완료
6. 편집 커밋 요청 시작과 완료

Chrome DevTools 또는 WebView 진단 도구로 다음 항목을 함께 확인한다.

- Interaction to Next Paint에 해당하는 지연
- 50ms 이상 Long Task
- React commit 시간
- style recalculation, layout, paint 시간
- 선택 요소 수 증가에 따른 변화
- 그림자 활성화와 비활성화의 차이

### 6.3 실험 단계

#### 실험 A: 모션 비용 분리

`ShadowControls`에서 사용하는 토글만 `duration-base` 대신 `duration-fast` 또는 무전환으로 바꿔 측정한다.

목적:

- 180ms 애니메이션이 느린 체감의 주원인인지 확인
- 상태 반영 지연과 모션 완료 시간을 구분

#### 실험 B: 시각 상태 분리

`ShadowControls`가 파일럿용 로컬 표시 상태를 소유한다.

권장 계약:

```ts
interface ResponsiveToggleProps {
  checked: boolean;
  onCheckedChange: (nextChecked: boolean) => void | Promise<void>;
}
```

요구사항:

- 클릭 시 `nextChecked`를 로컬 표시 상태에 즉시 반영
- 상위 `checked`가 변경되면 authoritative 상태와 조정
- 빠른 연속 클릭에서 마지막 의도가 유지됨
- 실패와 외부 변경 시 명시적으로 복구
- 임의 timeout으로 성공 여부를 추정하지 않음

#### 실험 C: 무거운 작업 분리

시각 상태를 먼저 커밋한 뒤 캔버스·Store 작업에 실행 기회를 넘긴다. 어떤 스케줄링 방식이 실제로 중간 paint를 허용하는지 WebView별로 측정한다.

#### 실험 D: 렌더 범위 축소

실험 B와 C 이후에도 느리면 다음 순서로 병목을 줄인다.

1. 속성 패널과 Grid의 Store selector 점검
2. 변경되지 않은 요소의 Props 참조 유지
3. inline callback으로 인한 memo 무효화 점검
4. 선택 요소별 patch와 전체 문서 조립 경계 분리
5. 그림자 paint 비용 및 별도 레이어 방식 비교

### 6.4 제안 성능 게이트

아래 값은 파일럿의 목표이며 측정 결과가 아니다.

- 첫 시각 피드백: p95 100ms 이내
- 입력 핸들러: 50ms 이상 Long Task를 만들지 않음
- 60Hz 환경에서 토글 모션 중 눈에 띄는 프레임 드롭 없음
- 단일 선택과 현실적인 다중 선택 시나리오에서 모두 기준 충족
- 저장 실패, Undo/Redo, 외부 동기화에서 표시와 authoritative 상태 불일치 없음

장비, OS, WebView 버전, 빌드 종류, 선택 요소 수와 반복 방법을 결과에 함께 기록한다.

## 7. 정확성 테스트

파일럿에는 성능 계측과 별도로 다음 회귀 테스트가 필요하다.

- OFF → ON, ON → OFF
- 대기·입력 그림자 동시 변경
- 눌림 상태가 없는 통계 요소
- 단일 키, 단일 노브, 다중 혼합 선택
- Mixed 상태에서 전체 켜기와 전체 끄기
- 빠른 연속 클릭과 마지막 의도 보존
- 저장 성공, 재시도 가능 실패, 영구 실패
- Undo/Redo 및 외부 이벤트 수신
- 토글 직후 선택 변경 또는 컴포넌트 unmount
- 분리된 프로퍼티 패널 윈도우와 메인 윈도우 간 동기화

기존 `shadowControls.test.tsx`와 `batchShadowUpdate.test.ts`는 동작 계약을 검증하지만 클릭부터 paint까지의 반응성은 검증하지 않는다. 파일럿에서 계측 또는 브라우저 기반 성능 검증을 추가한다.

## 8. 앱 전반 확대 기준

파일럿이 성능과 정확성 게이트를 모두 통과한 경우에만 공통화한다.

### 8.1 사용처 분류

모든 토글을 다음 유형으로 분류한다.

| 유형                    | 예시                       | 기본 전략                     |
| ----------------------- | -------------------------- | ----------------------------- |
| 순수 로컬 상태          | 모달 내부 옵션             | 기존 제어형 토글 유지         |
| 로컬 우선 + 비동기 저장 | 일반 설정                  | Store 선반영 + 저장 실패 조정 |
| 무거운 렌더 연동        | 그림자, 대규모 캔버스 옵션 | 긴급 UI 분리 + 렌더 격리      |
| 권위 응답 필요          | 서비스 시작·중지           | pending 표시 + 성공/실패 조정 |
| 다중 선택               | 배치 스타일                | 마지막 의도 + patch 병합      |

모든 토글에 동일한 낙관 로직을 강제하지 않고 유형별 정책을 적용한다.

### 8.2 공통 API 후보

기존 `onChange()`를 장기적으로 다음 상태를 명시하는 형태로 전환한다.

```ts
interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (nextChecked: boolean) => void;
  disabled?: boolean;
  pending?: boolean;
}
```

낙관적 상태, rollback, mutation 순서 제어가 필요한 경우에는 표현 컴포넌트인 `Checkbox`가 아니라 별도 훅 또는 컨트롤러가 소유한다.

```text
Checkbox: 표현과 접근성
useResponsiveToggle: 임시 표시 상태와 마지막 의도
도메인 Store/Coordinator: authoritative 상태, 저장, 재시도, rollback
```

### 8.3 확대 순서

1. 그림자 토글 파일럿
2. 같은 프로퍼티 패널의 단순 boolean 토글과 비교
3. 캔버스 렌더를 유발하는 토글에 선택 적용
4. 일반 설정 토글의 오류 복구 계약 통일
5. 공통 API 전환과 호출부 마이그레이션
6. 성능 예산 및 회귀 계측을 CI 또는 릴리스 점검에 포함

## 9. 보류 사항

- 공통 훅 이름과 최종 API
- `scheduler.yield()` 사용 여부와 WebView fallback
- 캔버스 갱신을 React Transition으로 처리할 수 있는 Store 경계
- editor commit 병합 주기와 flush 정책
- 그림자 전용 합성 레이어의 필요성
- 성능 계측을 개발 빌드 전용으로 둘지 익명 로컬 진단에 포함할지 여부

이 항목은 파일럿의 실제 측정 결과를 바탕으로 하나씩 결정한다.

## 10. 외부 참고 자료

- [Interaction to Next Paint (web.dev)](https://web.dev/articles/inp)
- [RAIL 성능 모델 (web.dev)](https://web.dev/articles/rail)
- [React `useOptimistic`](https://react.dev/reference/react/useOptimistic)
- [React `startTransition`](https://react.dev/reference/react/startTransition)
- [Chrome `scheduler.yield()`](https://developer.chrome.com/blog/use-scheduler-yield)
- [Meta: Rebuilding the tech stack for the new Facebook.com](https://engineering.fb.com/2020/05/08/web/facebook-redesign/)
- [X Engineering: How we built Twitter Lite](https://blog.x.com/engineering/en_us/topics/open-source/2017/how-we-built-twitter-lite)

---

## 요약

DmNote는 공통 체크박스에 일괄적으로 낙관 상태를 넣기보다 `그림자 사용` 토글을 파일럿으로 삼는다. 파일럿에서는 첫 시각 피드백, 무거운 캔버스 갱신, 저장 작업을 분리하고 실제 click-to-paint 시간을 측정한다. 성능 개선과 상태 정합성이 모두 검증된 뒤 토글 유형별 정책과 공통 API를 정리해 앱 전반으로 확대한다.
