# 인터랙션 성능 개선 추적표

> 작성일: 2026-08-07
>
> 상태: 그림자 토글 파일럿 자동 측정·WebView 검증 중
>
> 원칙: 실측값만 기록하며 추정값이나 임의의 성능 수치를 입력하지 않는다.
>
> 관련 문서: [인터랙션 최적화 전수 인벤토리](./interaction-optimization-inventory.md) · [인터랙션 반응성 개선 설계](./interaction-responsiveness-design.md)

---

## 1. 사용 방법

1. 측정 환경을 먼저 고정하고 아래 `측정 세션`에 기록한다.
2. 최적화 전 같은 시나리오를 반복해 기준선 P50·P95를 기록한다.
3. 최적화 구현과 커밋 또는 PR을 연결한다.
4. 같은 환경과 입력 데이터로 개선 후 값을 측정한다.
5. 개선율과 정확성 게이트를 확인한 뒤 상태를 `완료`로 바꾼다.

### 상태 값

| 상태   | 의미                                    |
| ------ | --------------------------------------- |
| 대기   | 아직 측정하지 않음                      |
| 기준선 | 최적화 전 기준선 측정 완료              |
| 실험   | 구현 또는 비교 실험 진행 중             |
| 검증   | 개선 후 성능·정확성 검증 중             |
| 완료   | 성능 목표와 정확성 게이트 통과          |
| 보류   | 효과가 작거나 다른 작업이 선행되어야 함 |
| 회귀   | 개선 후 값 또는 정확성이 악화됨         |

## 2. 측정 지표

| 코드   | 지표                      | 단위     | 측정 시작               | 측정 종료                     | 주 적용 대상                 |
| ------ | ------------------------- | -------- | ----------------------- | ----------------------------- | ---------------------------- |
| CTP    | Click-to-paint            | ms       | pointer/key 입력 시각   | 상태 변화가 처음 paint된 시각 | 버튼, 토글, 탭, 메뉴         |
| ETC    | End-to-complete           | ms       | 사용자 입력 시각        | 저장·IPC·렌더 정합성 완료     | 비동기 버튼, 설정, 파일 작업 |
| F95    | 연속 입력 프레임 시간 P95 | ms/frame | 드래그·휠·슬라이더 시작 | 제스처 종료                   | 드래그, 줌, 리사이즈, 색상   |
| DROP   | 긴 프레임 비율            | %        | 연속 입력 시작          | 제스처 종료                   | 모든 P0 연속 입력            |
| RENDER | 입력당 React commit 수    | count    | 입력 시작               | 최종 상태 반영                | Store·패널·캔버스 변경       |
| LONG   | 50ms 이상 Long Task       | count    | 시나리오 시작           | 시나리오 종료                 | 메인 스레드 병목 진단        |

주 지표는 항목의 체감 병목을 대표하는 값이다. 필요하면 `측정 세션`의 비고나 별도 원시 로그에 보조 지표를 함께 남긴다.

### 개선율

낮을수록 좋은 시간 지표의 개선율:

```text
개선율(%) = (기준선 P95 - 개선 후 P95) / 기준선 P95 × 100
```

- 양수: 개선
- 0% 부근: 유의미한 변화 없음
- 음수: 회귀
- 기준선이 없거나 0이면 계산하지 않음

## 3. 고정 측정 조건

측정 세션마다 바뀐 값만 다시 기록한다.

| 조건                   | 기준값                                       |
| ---------------------- | -------------------------------------------- |
| OS·버전                | —                                            |
| CPU·메모리             | —                                            |
| 디스플레이 주사율·배율 | —                                            |
| DmNote 빌드·커밋       | —                                            |
| 개발·프로덕션 빌드     | 프로덕션 빌드 권장                           |
| 창 크기·오버레이 상태  | —                                            |
| 테스트 탭·키 개수      | —                                            |
| 선택 요소 수           | 단일, 10개, 100개 등 시나리오별 고정         |
| 플러그인·CSS·JS 상태   | —                                            |
| 측정 도구·버전         | —                                            |
| 워밍업 횟수            | —                                            |
| 기록 반복 횟수         | 최소값을 정한 뒤 모든 비교에서 동일하게 유지 |

## 4. 핵심 현황

수치는 실제 측정이 시작되면 갱신한다.

| 지표                             | 현재 값 |
| -------------------------------- | ------- |
| 전체 추적 항목                   | 165개   |
| 대기                             | 131개   |
| 완료                             | 0개     |
| 실험·검증 중                     | 34개    |
| 회귀                             | 0개     |
| P0 완료율                        | —       |
| 측정 완료 항목의 P95 중앙 개선율 | —       |
| 가장 큰 개선                     | —       |
| 가장 큰 회귀                     | —       |

## 5. 전수 성능 추적표

모든 성능 값은 주 지표의 P95이며 단위는 `주 지표` 열을 따른다. 더 자세한 P50·P95·보조 지표는 `측정 세션`에 기록한다.

<!-- PILOT-01:RESULT:START -->

#### PILOT-01 최신 자동 측정

| 조건           | 값                                                                    |
| -------------- | --------------------------------------------------------------------- |
| 측정 경로      | 실제 `updateKeyStyle` + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 요소 수        | 500개                                                                 |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                                |
| 측정 코드 커밋 | `17e5baaa47ab7b561d2b237694988b1f91cfd870`                            |
| 비교 전략      | `sync` → `after-paint`                                                |
| 환경           | darwin arm64, v25.2.1                                                 |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| 시각 DOM commit       |     7.563ms |     0.431ms |  94.3% |
| canonical DOM commit  |     7.565ms |     8.345ms | -10.3% |
| React commit duration |     0.972ms |     0.950ms |   2.3% |

- 원시 결과: [기준선](../benchmarks/results/pilot-01-baseline.json) · [개선](../benchmarks/results/pilot-01-improved.json)
- 정확성 게이트: `npm run test:interaction:pilot` 통과
- 실제 WebView click-to-paint 값은 브라우저 또는 Tauri 자동화 표면에서 별도 검증 전까지 기록하지 않는다.
<!-- PILOT-01:RESULT:END -->

#### PILOT-01 Chromium 실제 렌더 경로 검증

커밋 `809f8fe1`, Google Chrome 151.0.7922.77, 500개 요소, 40회 반복과 5회 워밍업 조건이다. 새 Vite 프로세스에서 두 전략을 같은 순서로 실행했으며 Computer Use가 완료 후 창 제목에 노출된 P95를 수집했다.

| P95 지표              | sync 기준선 | after-paint |  변화율 |
| --------------------- | ----------: | ----------: | ------: |
| 시각 DOM commit       |    11.300ms |     3.100ms |   72.6% |
| canonical DOM commit  |    11.300ms |    27.400ms | -142.5% |
| paint opportunity     |    34.100ms |    34.200ms |   -0.3% |
| React commit duration |     2.300ms |     2.900ms |  -26.1% |

- 원시 결과: [Chromium P95](../benchmarks/results/pilot-01-chromium-p95.json)
- 해석: 시각 DOM 반영은 빨라졌고 paint opportunity는 같은 프레임 구간을 유지했다. canonical commit 증가는 첫 paint 뒤로 작업을 옮긴 의도된 교환관계다.
- 제한: macOS WKWebView와 Windows WebView2 실측은 아직 완료되지 않았다.

<!-- PILOT-02:RESULT:START -->

#### PILOT-02 최신 자동 측정

| 조건              | 값                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| 측정 경로         | 전체 선택 요소 shadow 쌍 배치 변환 + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 선택·렌더 요소 수 | 500개                                                                              |
| 반복              | 기준선 30회 / 개선 30회, 워밍업 각 5회                                             |
| 측정 코드 커밋    | `17e5baaa47ab7b561d2b237694988b1f91cfd870`                                         |
| 비교 전략         | `sync` → `after-paint`                                                             |
| 환경              | darwin arm64, v25.2.1                                                              |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| 시각 DOM commit       |     7.576ms |     0.454ms |  94.0% |
| canonical DOM commit  |     7.578ms |    10.455ms | -38.0% |
| React commit duration |     0.623ms |     0.889ms | -42.6% |

- 원시 결과: [기준선](../benchmarks/results/pilot-02-baseline.json) · [개선](../benchmarks/results/pilot-02-improved.json)
- 정확성 게이트: `npm run test:interaction:pilot` 통과
- 공통 `ShadowControls`의 시각 우선 반영이 배치 canonical 변환 비용과 분리되는지 검증한다.
<!-- PILOT-02:RESULT:END -->

### 5.1 파일럿·공통 기반

| ID       | 항목                               | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                                                                                                     |
| -------- | ---------------------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | ------------------------------------------------------------------------------------------------------------- |
| PILOT-01 | 단일 선택 그림자 사용 토글         | P1       | DOM P95 ms   |    7.563 |    0.431 |  94.3% | 검증 | [기준선](../benchmarks/results/pilot-01-baseline.json) · [개선](../benchmarks/results/pilot-01-improved.json) |
| PILOT-02 | 다중 선택 그림자 사용 토글         | P1       | DOM P95 ms   |    7.576 |    0.454 |  94.0% | 검증 | [기준선](../benchmarks/results/pilot-02-baseline.json) · [개선](../benchmarks/results/pilot-02-improved.json) |
| BASE-01  | 공통 Checkbox                      | 기반     | CTP ms       |        — |        — |      — | 실험 | `useOptimisticBooleanCommit`·선택적 `commitStrategy` 제공, PILOT-01·02 검증                                   |
| BASE-02  | SettingToggleRow                   | 기반     | CTP ms       |        — |        — |      — | 실험 | `05c02e43`, 선택적 `after-paint`·설정 토글 적용                                                               |
| BASE-03  | Dropdown                           | 기반     | CTP ms       |        — |        — |      — | 대기 | 열기·선택·닫기                                                                                                |
| BASE-04  | NumberInput·OptionalNumberInput    | P0/P1    | CTP ms       |        — |        — |      — | 대기 | draft·preview·commit                                                                                          |
| BASE-05  | TextInput·SearchField              | P1       | CTP ms       |        — |        — |      — | 대기 | local echo·검색 필터                                                                                          |
| BASE-06  | ColorInput·ColorSwatchButton       | P0/P1    | CTP ms       |        — |        — |      — | 대기 | 피커 첫 표시 포함                                                                                             |
| BASE-07  | TabSwitch                          | P3       | CTP ms       |        — |        — |      — | 대기 | 탭 콘텐츠 paint 포함                                                                                          |
| BASE-08  | ListPopup·FloatingPopup            | 기반     | CTP ms       |        — |        — |      — | 대기 | 메뉴·피커 표면                                                                                                |
| BASE-09  | Modal                              | 기반     | CTP ms       |        — |        — |      — | 대기 | 열기·닫기·포커스 복원                                                                                         |
| BASE-10  | TooltipGroup                       | P3       | CTP ms       |        — |        — |      — | 대기 | 의도된 hover delay는 별도 기록                                                                                |
| BASE-11  | PanelToggleButton                  | P1       | CTP ms       |        — |        — |      — | 대기 | 패널 mount·render 포함                                                                                        |
| BASE-12  | 패널 내부 PickerSurface·내비게이션 | P1/P3    | CTP ms       |        — |        — |      — | 대기 | 위치 계산과 첫 paint                                                                                          |
| BASE-13  | 프로퍼티 패널 smooth scroll        | P0       | F95 ms/frame |        — |        — |      — | 대기 | Lenis RAF 6개 영향 측정                                                                                       |
| BASE-14  | IconSwap·EyeToggleIcon             | 기반     | CTP ms       |        — |        — |      — | 대기 | 180ms 모션과 상태 반영 분리                                                                                   |
| BASE-15  | usePressAction·usePressGatedSwap   | 기반     | CTP ms       |        — |        — |      — | 대기 | pressed 피드백과 300ms gate                                                                                   |

### 5.2 설정·Grid·프로퍼티 토글

| ID     | 항목                                       | 우선순위 | 주 지표 | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                          |
| ------ | ------------------------------------------ | -------- | ------- | -------: | -------: | -----: | ---- | ---------------------------------- |
| TOG-01 | 오버레이 잠금                              | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, CTP·ETC 측정 대기      |
| TOG-02 | 항상 위                                    | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 재동기화 검증 대기     |
| TOG-03 | 전역 노트 효과                             | P1       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, WebView 측정 대기      |
| TOG-04 | 전역 키 카운터                             | P1       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, WebView 측정 대기      |
| TOG-05 | 트레이 모드                                | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, CTP·ETC 측정 대기      |
| TOG-06 | OBS 모드                                   | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 서비스 ETC 측정 대기   |
| TOG-07 | 자동 업데이트                              | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 저장 실패 검증 대기    |
| TOG-08 | 개발자 모드                                | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, DevTools ETC 측정 대기 |
| TOG-09 | 커스텀 CSS                                 | P1/P2    | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 스타일 CTP 측정 대기   |
| TOG-10 | 커스텀 JS                                  | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 런타임 ETC 측정 대기   |
| TOG-11 | Grid 미니맵 표시                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-12 | Grid 정렬 가이드                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 드래그 F95 측정 대기   |
| TOG-13 | Grid 간격 가이드                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 드래그 F95 측정 대기   |
| TOG-14 | Grid 크기 일치 가이드                      | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 리사이즈 F95 측정 대기 |
| TOG-15 | 단일 인라인 스타일 우선                    | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-16 | 단일 키 사운드 사용                        | P1/P2    | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-17 | 단일 노트 효과                             | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-18 | 단일 Y축 자동 보정                         | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-19 | 단일 글로우                                | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-20 | 단일 카운터 사용                           | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-21 | 단일 카운터 애니메이션                     | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-22 | 그래프 평균선                              | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-23 | 그래프 애니메이션                          | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-24 | 그래프 인라인 스타일                       | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-25 | 노브 방향 반전                             | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-26 | 노브 인라인 스타일                         | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-27 | 배치 인라인 스타일·사운드                  | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-28 | 배치 노트 효과·Y 보정·글로우               | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-29 | 배치 카운터·애니메이션                     | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-30 | 배치 그래프·노브 토글                      | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 중복 표면 측정 대기    |
| TOG-31 | 탭 CSS 사용                                | P2       | CTP ms  |        — |        — |      — | 대기 | ETC·실패 재조회                    |
| TOG-32 | 이미지 투명화                              | P1       | CTP ms  |        — |        — |      — | 대기 | 이미지 paint                       |
| TOG-33 | 설정 모달의 카운터·노트 토글               | P1/P3    | CTP ms  |        — |        — |      — | 대기 | 로컬 preview                       |
| TOG-34 | 플러그인 boolean 설정                      | P1/P2    | CTP ms  |        — |        — |      — | 대기 | 저장 병합·handler                  |
| TOG-35 | 업데이트 버전 건너뛰기                     | P2       | CTP ms  |        — |        — |      — | 대기 | 저장 상태                          |
| TOG-36 | Display Element·커스텀 다이얼로그 체크박스 | P1/P2    | CTP ms  |        — |        — |      — | 대기 | React 공통 토글과 별도 경로        |

### 5.3 Grid·레이어 연속 입력과 편집 액션

| ID       | 항목                  | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거          |
| -------- | --------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | ------------------ |
| GRID-01  | 단일 요소 드래그      | P0       | F95 ms/frame |        — |        — |      — | 대기 | 가이드 on/off 별도 |
| GRID-02  | 다중 선택 드래그      | P0       | F95 ms/frame |        — |        — |      — | 대기 | 선택 수별 측정     |
| GRID-03  | Grid 패닝             | P0       | F95 ms/frame |        — |        — |      — | 대기 | viewport transform |
| GRID-04  | 휠·핀치 줌            | P0       | F95 ms/frame |        — |        — |      — | 대기 | 이벤트 coalescing  |
| GRID-05  | 미들 버튼 팬          | P0       | F95 ms/frame |        — |        — |      — | 대기 | 전역 이벤트 경로   |
| GRID-06  | 단일 리사이즈         | P0       | F95 ms/frame |        — |        — |      — | 대기 | preview·commit     |
| GRID-07  | 그룹 리사이즈         | P0       | F95 ms/frame |        — |        — |      — | 대기 | 선택 수별 측정     |
| GRID-08  | 그라데이션 축 핸들    | P0       | F95 ms/frame |        — |        — |      — | 대기 | 캔버스 preview     |
| GRID-09  | 마퀴 선택             | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | 요소 수별 측정     |
| GRID-10  | 미니맵 클릭 이동      | P1       | CTP ms       |        — |        — |      — | 대기 | viewport 반영      |
| GRID-11  | 미니맵 드래그         | P0       | F95 ms/frame |        — |        — |      — | 대기 | viewport 반영      |
| GRID-12  | 요소 단일·다중 선택   | P1       | CTP ms       |        — |        — |      — | 대기 | 패널 교체 포함     |
| GRID-13  | Shift 범위 선택       | P1       | CTP ms       |        — |        — |      — | 대기 | 요소 수별 측정     |
| GRID-14  | 더블클릭 편집         | P1/P3    | CTP ms       |        — |        — |      — | 대기 | 모달 첫 paint      |
| GRID-15  | Grid 컨텍스트 메뉴    | P3       | CTP ms       |        — |        — |      — | 대기 | 메뉴 첫 paint      |
| GRID-16  | 요소 추가             | P1       | CTP ms       |        — |        — |      — | 대기 | 문서 commit ETC    |
| GRID-17  | 삭제·지우개           | P1       | CTP ms       |        — |        — |      — | 대기 | 문서 commit ETC    |
| GRID-18  | 복제·복사·붙여넣기    | P1       | CTP ms       |        — |        — |      — | 대기 | 다중 요소 시나리오 |
| GRID-19  | z-order 이동          | P1       | CTP ms       |        — |        — |      — | 대기 | 배열·zIndex 갱신   |
| GRID-20  | 그룹화·그룹 해제      | P1       | CTP ms       |        — |        — |      — | 대기 | 관계·문서 변경     |
| GRID-21  | 방향키 이동           | P0       | F95 ms/frame |        — |        — |      — | 대기 | 500ms gesture 병합 |
| GRID-22  | Undo·Redo             | P1       | CTP ms       |        — |        — |      — | 대기 | 문서·Store 동기화  |
| GRID-23  | 키 카운터 초기화      | P2       | ETC ms       |        — |        — |      — | 대기 | IPC 완료           |
| LAYER-01 | 레이어·Grid 탭 전환   | P3       | CTP ms       |        — |        — |      — | 대기 | 콘텐츠 paint       |
| LAYER-02 | 레이어 단일·다중 선택 | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 동기화      |
| LAYER-03 | 그룹 접기·펼치기      | P3       | CTP ms       |        — |        — |      — | 대기 | 목록 reflow        |
| LAYER-04 | 이름 변경             | P1/P2    | CTP ms       |        — |        — |      — | 대기 | blur commit ETC    |
| LAYER-05 | 표시·숨김             | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 paint       |
| LAYER-06 | 잠금·잠금 해제        | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 상태        |
| LAYER-07 | 위·아래 이동          | P1       | CTP ms       |        — |        — |      — | 대기 | 목록·캔버스 순서   |
| LAYER-08 | 드래그 순서 변경      | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | local preview      |
| LAYER-09 | 그룹 드래그·중첩      | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | hit-test           |
| LAYER-10 | 레이어 컨텍스트 메뉴  | P3       | CTP ms       |        — |        — |      — | 대기 | 메뉴 첫 paint      |
| LAYER-11 | 패널 detach·reattach  | P2       | ETC ms       |        — |        — |      — | 대기 | 창 handoff         |
| LAYER-12 | 분리 패널 창 이동     | P0       | F95 ms/frame |        — |        — |      — | 대기 | 네이티브 drag      |

### 5.4 프로퍼티 입력·편집기·피커

| ID      | 항목                             | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거              |
| ------- | -------------------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | ---------------------- |
| PROP-01 | 숫자 입력                        | P0/P1    | CTP ms       |        — |        — |      — | 대기 | 위치·크기·스타일       |
| PROP-02 | 텍스트 입력                      | P1       | CTP ms       |        — |        — |      — | 대기 | draft·blur commit      |
| PROP-03 | 색상 입력                        | P0       | F95 ms/frame |        — |        — |      — | 대기 | preview·commit         |
| PROP-04 | 그라데이션 입력                  | P0       | F95 ms/frame |        — |        — |      — | 대기 | stop·angle·format      |
| PROP-05 | 드롭다운 속성 변경               | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 반영            |
| PROP-06 | 폰트 스타일 버튼                 | P1       | CTP ms       |        — |        — |      — | 대기 | batch 포함             |
| PROP-07 | 키 매핑·실입력 캡처              | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 마지막 입력 보존       |
| PROP-08 | 이미지 설정                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | decode ETC             |
| PROP-09 | 사운드 설정                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 파일·오디오 ETC        |
| PROP-10 | 단일·다중 선택 탭 전환           | P1       | CTP ms       |        — |        — |      — | 대기 | keepalive 범위         |
| PROP-11 | 플러그인 설정 color              | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | handler 격리           |
| PROP-12 | 플러그인 설정 number·text·select | P1       | CTP ms       |        — |        — |      — | 대기 | local draft            |
| PROP-13 | 플러그인 설정 전체 저장          | P2       | ETC ms       |        — |        — |      — | 대기 | single-flight          |
| EDIT-01 | 색상 saturation·hue·alpha 드래그 | P0       | F95 ms/frame |        — |        — |      — | 대기 | picker 전체            |
| EDIT-02 | 색상 텍스트·퍼센트 입력          | P1       | CTP ms       |        — |        — |      — | 대기 | validation             |
| EDIT-03 | 그라데이션 stop 편집·형식 전환   | P0       | F95 ms/frame |        — |        — |      — | 대기 | draft·commit           |
| EDIT-04 | 카운터 bezier point 드래그       | P0       | F95 ms/frame |        — |        — |      — | 대기 | animation editor       |
| EDIT-05 | 카운터 미리보기 scrub·wheel·play | P0       | F95 ms/frame |        — |        — |      — | 대기 | precompute             |
| EDIT-06 | 사운드 파형 pan·zoom·trim        | P0       | F95 ms/frame |        — |        — |      — | 대기 | Worker 후보            |
| EDIT-07 | 사운드 재생·정지·seek            | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | media event coalescing |
| EDIT-08 | 사운드 처리 저장                 | P2       | ETC ms       |        — |        — |      — | 대기 | progress·취소          |
| PICK-01 | 사운드 선택·검색·필터            | P1       | CTP ms       |        — |        — |      — | 대기 | 목록 크기별 측정       |
| PICK-02 | 사운드 추가·삭제·이름·숨김       | P2       | ETC ms       |        — |        — |      — | 대기 | 파일 작업              |
| PICK-03 | 폰트 선택·검색·필터              | P1       | CTP ms       |        — |        — |      — | 대기 | font load 영향         |
| PICK-04 | 폰트 추가·삭제·이름 변경         | P2       | ETC ms       |        — |        — |      — | 대기 | 파일·검증              |
| PICK-05 | 카운터 애니메이션 선택·삭제      | P2       | ETC ms       |        — |        — |      — | 대기 | 목록 조정              |
| PICK-06 | 카운터 애니메이션 생성·편집      | P0/P2    | F95 ms/frame |        — |        — |      — | 대기 | 저장 ETC 별도          |
| PICK-07 | 이미지 idle·active 로드          | P2       | ETC ms       |        — |        — |      — | 대기 | decode 포함            |
| PICK-08 | 이미지 reset·fit·투명도          | P1       | CTP ms       |        — |        — |      — | 대기 | paint 포함             |
| PICK-09 | 그림자 상태·수치·색상            | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | 파일럿 후속            |
| PICK-10 | 팔레트 색상 선택·편집            | P1       | CTP ms       |        — |        — |      — | 대기 | 저장 ETC 별도          |

### 5.5 설정·툴바·모달·플러그인·전역

| ID       | 항목                                 | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                |
| -------- | ------------------------------------ | -------- | ------------ | -------: | -------: | -----: | ---- | ------------------------ |
| SET-01   | 키 사운드 출력 변경                  | P2       | ETC ms       |        — |        — |      — | 대기 | 장치 적용                |
| SET-02   | ASIO 버퍼 변경                       | P2       | ETC ms       |        — |        — |      — | 대기 | 적용·복구                |
| SET-03   | 리사이즈 앵커                        | P2       | CTP ms       |        — |        — |      — | 대기 | 설정 저장                |
| SET-04   | 언어 변경                            | P1       | CTP ms       |        — |        — |      — | 대기 | 전체 번역 rerender       |
| SET-05   | 렌더러·ANGLE 모드                    | P2       | ETC ms       |        — |        — |      — | 대기 | 재시작 상태              |
| SET-06   | 플러그인 추가·재로드                 | P2       | ETC ms       |        — |        — |      — | 대기 | 진행·중복 실행           |
| SET-07   | 플러그인 활성화                      | P2       | CTP ms       |        — |        — |      — | 대기 | ETC·rollback             |
| SET-08   | 플러그인 삭제·데이터 삭제            | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·목록 조정           |
| SET-09   | CSS 파일 로드·활성화·삭제            | P2       | ETC ms       |        — |        — |      — | 대기 | 목록 projection          |
| SET-10   | 단축키 캡처·삭제                     | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 저장 ETC                 |
| SET-11   | OBS URL 복사                         | P2       | CTP ms       |        — |        — |      — | 대기 | 완료 피드백              |
| SET-12   | OBS 토큰 재생성                      | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·결과                |
| SET-13   | 전체 초기화                          | P2       | ETC ms       |        — |        — |      — | 대기 | 전체 재부트스트랩        |
| SET-14   | 업데이트 확인                        | P2       | ETC ms       |        — |        — |      — | 대기 | single-flight            |
| TOOL-01  | 이동·지우개 도구 선택                | P3       | CTP ms       |        — |        — |      — | 대기 | 선택 표시                |
| TOOL-02  | 키·통계·그래프·노브 추가 메뉴        | P1       | CTP ms       |        — |        — |      — | 대기 | 메뉴·추가 분리           |
| TOOL-03  | 팔레트 열기                          | P3       | CTP ms       |        — |        — |      — | 대기 | 지연 mount               |
| TOOL-04  | 현재 탭·카운터 초기화                | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·동기화              |
| TOOL-05  | 기본 키 탭 전환                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | stale 응답 차단          |
| TOOL-06  | 커스텀 탭 팝업                       | P2/P3    | CTP ms       |        — |        — |      — | 대기 | 목록·파일 작업           |
| TOOL-07  | 프리셋 전체·탭 저장                  | P2       | ETC ms       |        — |        — |      — | 대기 | 진행·완료                |
| TOOL-08  | 프리셋 전체·탭 불러오기              | P2       | ETC ms       |        — |        — |      — | 대기 | bootstrap 완료           |
| TOOL-09  | 오버레이 표시                        | P2       | CTP ms       |        — |        — |      — | 대기 | 기존 optimistic+rollback |
| TOOL-10  | 설정 화면 열기·뒤로                  | P1       | CTP ms       |        — |        — |      — | 대기 | 큰 화면 전환             |
| TOOL-11  | 노트 트랙 설정 열기                  | P3       | CTP ms       |        — |        — |      — | 대기 | 모달 첫 paint            |
| TOOL-12  | 외부 링크·창 최소화·닫기             | P2       | ETC ms       |        — |        — |      — | 대기 | 네이티브 호출            |
| MODAL-01 | 통합 키 설정 저장·취소               | P2       | ETC ms       |        — |        — |      — | 대기 | atomic commit            |
| MODAL-02 | 키·노트·카운터 설정 전체             | P1/P2    | CTP ms       |        — |        — |      — | 대기 | preview·commit           |
| MODAL-03 | 탭 CSS 로드·이력·저장                | P2       | ETC ms       |        — |        — |      — | 대기 | authoritative 재조회     |
| MODAL-04 | 탭 이름 변경                         | P2       | ETC ms       |        — |        — |      — | 대기 | validation               |
| MODAL-05 | 커스텀 탭 생성·선택·삭제             | P1/P2    | ETC ms       |        — |        — |      — | 대기 | generation               |
| MODAL-06 | 업데이트 다운로드·릴리스·건너뛰기    | P2       | ETC ms       |        — |        — |      — | 대기 | progress·재시도          |
| MODAL-07 | 플러그인 데이터 삭제                 | P2       | ETC ms       |        — |        — |      — | 대기 | 위험 액션                |
| MODAL-08 | Alert·Confirm·Custom Dialog          | 기반/P3  | CTP ms       |        — |        — |      — | 대기 | Promise settle           |
| PLUG-01  | Promise plugin button handler        | P2       | ETC ms       |        — |        — |      — | 대기 | pending·오류 격리        |
| PLUG-02  | plugin input onInput                 | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | handler duration         |
| PLUG-03  | plugin dropdown                      | P1/P3    | CTP ms       |        — |        — |      — | 대기 | 전역 listener            |
| PLUG-04  | Display Element 선택·드래그·리사이즈 | P0       | F95 ms/frame |        — |        — |      — | 대기 | 호스트 Grid와 비교       |
| PLUG-05  | plugin remove·context action         | P2       | ETC ms       |        — |        — |      — | 대기 | 실패 조정                |
| WIN-01   | 모드 전환 단축키                     | P1/P2    | CTP ms       |        — |        — |      — | 대기 | generation               |
| WIN-02   | 프로퍼티 패널 토글 단축키            | P1       | CTP ms       |        — |        — |      — | 대기 | handoff 포함             |
| WIN-03   | 키 슬롯·단축키 실입력 캡처           | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 이벤트 격리              |
| WIN-04   | 분리 패널 Cmd·Ctrl+W                 | P2       | ETC ms       |        — |        — |      — | 대기 | reattach                 |
| WIN-05   | 오버레이 컨텍스트 메뉴               | P2       | CTP ms       |        — |        — |      — | 대기 | native menu 생성         |
| WIN-06   | 편집 flush 입력 잠금                 | 기반     | ETC ms       |        — |        — |      — | 대기 | 잠금 시간·피드백         |
| WIN-07   | focus·visibility 재동기화            | 기반     | ETC ms       |        — |        — |      — | 대기 | 사용자 입력과 경쟁 여부  |

## 6. 측정 세션

한 항목에 여러 세션을 추가할 수 있다. 원시 trace·프로파일 파일이 크면 저장소에 직접 넣지 않고 접근 가능한 경로나 CI artifact를 연결한다.

<!-- PILOT-01:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기      | 반복 |   P50 |   P95 |  최대 | 보조 지표                               | 원시 자료                                            | 비고             |
| -------------- | ---------- | -------- | ------ | ---------- | ---------------------------------------------------- | ------------------------- | ---: | ----: | ----: | ----: | --------------------------------------- | ---------------------------------------------------- | ---------------- |
| PILOT-01-SYNC  | 2026-08-07 | PILOT-01 | 기준선 | `17e5baaa` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 단일 선택·렌더 요소 500개 |   30 | 3.542 | 7.563 | 9.545 | canonical P95 7.565ms·React P95 0.972ms | [JSON](../benchmarks/results/pilot-01-baseline.json) | DOM commit proxy |
| PILOT-01-PAINT | 2026-08-07 | PILOT-01 | 개선   | `17e5baaa` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 단일 선택·렌더 요소 500개 |   30 | 0.303 | 0.431 | 0.443 | canonical P95 8.345ms·React P95 0.950ms | [JSON](../benchmarks/results/pilot-01-improved.json) | DOM commit proxy |

<!-- PILOT-01:SESSIONS:END -->

### 6.1 실제 브라우저 세션

| 세션 ID               | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                     | 시나리오·데이터 크기  | 반복 | P50 |    P95 | 최대 | 보조 지표          | 원시 자료                                                | 비고                    |
| --------------------- | ---------- | -------- | ------ | ---------- | ------------------------ | --------------------- | ---: | --: | -----: | ---: | ------------------ | -------------------------------------------------------- | ----------------------- |
| PILOT-01-CHROME-SYNC  | 2026-08-07 | PILOT-01 | 기준선 | `809f8fe1` | Chrome 151, darwin-arm64 | 단일 선택, 요소 500개 |   40 |   — | 11.300 |    — | paint P95 34.100ms | [JSON](../benchmarks/results/pilot-01-chromium-p95.json) | 실제 Chromium 렌더 경로 |
| PILOT-01-CHROME-PAINT | 2026-08-07 | PILOT-01 | 개선   | `809f8fe1` | Chrome 151, darwin-arm64 | 단일 선택, 요소 500개 |   40 |   — |  3.100 |    — | paint P95 34.200ms | [JSON](../benchmarks/results/pilot-01-chromium-p95.json) | 실제 Chromium 렌더 경로 |

<!-- PILOT-02:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기      | 반복 |   P50 |   P95 |  최대 | 보조 지표                                | 원시 자료                                            | 비고                   |
| -------------- | ---------- | -------- | ------ | ---------- | ---------------------------------------------------- | ------------------------- | ---: | ----: | ----: | ----: | ---------------------------------------- | ---------------------------------------------------- | ---------------------- |
| PILOT-02-SYNC  | 2026-08-07 | PILOT-02 | 기준선 | `17e5baaa` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 다중 선택·렌더 요소 500개 |   30 | 3.937 | 7.576 | 7.762 | canonical P95 7.578ms·React P95 0.623ms  | [JSON](../benchmarks/results/pilot-02-baseline.json) | batch DOM commit proxy |
| PILOT-02-PAINT | 2026-08-07 | PILOT-02 | 개선   | `17e5baaa` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 다중 선택·렌더 요소 500개 |   30 | 0.298 | 0.454 | 0.477 | canonical P95 10.455ms·React P95 0.889ms | [JSON](../benchmarks/results/pilot-02-improved.json) | batch DOM commit proxy |

<!-- PILOT-02:SESSIONS:END -->

## 7. 실험 기록

최적화 하나당 아래 블록을 복사한다.

<!-- PILOT-01:EXPERIMENT:START -->

### EXP-001: 그림자 사용 토글 시각 반응 우선 처리

| 필드               | 내용                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 항목 ID            | PILOT-01                                                                                                                       |
| 가설               | 무거운 문서 상태 커밋을 첫 paint 뒤로 미루면 토글의 시각 반응이 선택 요소 수와 무관하게 빨라진다.                              |
| 변경 내용          | 로컬 checked를 먼저 반영하고 `requestAnimationFrame` 다음 태스크에서 canonical 상태를 커밋한다. 연타는 마지막 의도로 병합한다. |
| 적용 기법          | 낙관적 상태 투영·메인 스레드 양보·입력 병합                                                                                    |
| 커밋·PR            | `17e5baaa`                                                                                                                     |
| 기준선 세션        | PILOT-01-SYNC                                                                                                                  |
| 개선 후 세션       | PILOT-01-PAINT                                                                                                                 |
| P50 변화           | 3.542ms → 0.303ms (91.4%)                                                                                                      |
| P95 변화           | 7.563ms → 0.431ms (94.3%)                                                                                                      |
| canonical P95 변화 | 7.565ms → 8.345ms (-10.3%)                                                                                                     |
| 정확성 검증        | 마지막 의도 병합·paint 전 unmount 의도 보존·접근성 checked 상태 단위 테스트 통과                                               |
| 플랫폼 검증        | jsdom proxy 완료·실제 Chromium 세션은 6.1 참조·macOS WKWebView 및 Windows WebView2 대기                                        |
| 결론               | WebView 실측 전까지 검증 상태로 유지                                                                                           |
| 후속 작업          | 실제 WebView CTP 측정 후 PILOT-02와 공통 정책 후보로 확대                                                                      |

<!-- PILOT-01:EXPERIMENT:END -->

<!-- PILOT-02:EXPERIMENT:START -->

### EXP-002: 다중 선택 그림자 사용 토글 시각 반응 검증

| 필드               | 내용                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 항목 ID            | PILOT-02                                                                        |
| 가설               | 공통 컨트롤의 로컬 checked 반영은 전체 선택 요소의 배치 변환보다 먼저 표시된다. |
| 변경 내용          | PILOT-01에서 적용한 공통 `ShadowControls` 계약을 다중 선택 경로에서 재사용한다. |
| 적용 기법          | 낙관적 상태 투영·메인 스레드 양보·입력 병합                                     |
| 커밋·PR            | `17e5baaa`                                                                      |
| 기준선 세션        | PILOT-02-SYNC                                                                   |
| 개선 후 세션       | PILOT-02-PAINT                                                                  |
| P95 변화           | 7.576ms → 0.454ms (94.0%)                                                       |
| canonical P95 변화 | 7.578ms → 10.455ms (-38.0%)                                                     |
| 정확성 검증        | 요소별 그림자 값 보존·통계 activeShadow 차단·연타 마지막 의도 보존 테스트 통과  |
| 플랫폼 검증        | jsdom batch proxy 완료·실제 WebView 대기                                        |
| 결론               | 공통 최적화가 다중 선택에도 유효하며 WebView 실측 전까지 검증 상태로 유지       |
| 후속 작업          | 공통 Checkbox 확대 전 BASE-01 사용처별 상태 소유권 분류                         |

<!-- PILOT-02:EXPERIMENT:END -->

### EXP-003: 공통 Checkbox 시각 우선 커밋 계약

| 필드        | 내용                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| 항목 ID     | BASE-01                                                                                                                  |
| 가설        | 상태 소유권을 강제로 바꾸지 않고 옵트인 계약을 제공하면 느린 토글만 안전하게 paint와 canonical 작업을 분리할 수 있다.    |
| 변경 내용   | `useOptimisticBooleanCommit` 공통 훅과 Checkbox의 선택적 `commitStrategy`를 추가하고 그림자 토글의 중복 구현을 교체했다. |
| 안전 기본값 | 기존 36개 JSX 사용처는 `sync` 유지, 검증된 사용처만 `after-paint` 옵트인                                                 |
| 정확성 검증 | sync 호환·즉시 시각 반영·연타 병합·언마운트 의도 보존 테스트 통과                                                        |
| 성능 근거   | PILOT-01 단일 선택과 PILOT-02 다중 선택 자동 비교 결과                                                                   |
| 결론        | 공통 기반 채택, 사용처별 저장·rollback 계약 분류 후 단계 확대                                                            |

### EXP-004: 프로퍼티 패널 P1 토글 첫 확대

| 필드        | 내용                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-15~21, TOG-27~29                                                                           |
| 적용 범위   | 단일·다중 선택의 인라인 스타일, 사운드, 노트 효과, Y축 보정, 글로우, 카운터, 카운터 애니메이션 |
| 변경 내용   | 공통 Checkbox의 `after-paint` 전략을 14개 사용처에 옵트인                                      |
| 커밋·PR     | `07976df8`                                                                                     |
| 안전성 분류 | 실패 rollback이 필요한 원격·IPC 토글을 제외하고 기존 로컬 상태 커밋 경로만 적용                |
| 정확성 검증 | 타입 검사·린트·공통 Checkbox 및 다중 선택 관련 20개 테스트 통과                                |
| 성능 값     | 개별 사용처 기준선·개선 후 WebView CTP 미측정 — 실측 전까지 수치 미기재                        |
| 결론        | 구현은 실험 상태이며 실제 WebView 자동 측정과 사용처별 정합성 검증 후 완료 여부 결정           |

### EXP-005: Grid·그래프·노브 토글 확대

| 필드        | 내용                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-11~14, TOG-22~26, TOG-30                                                                  |
| 적용 범위   | Grid 미니맵·스마트 가이드, 단일·다중 그래프 평균선·애니메이션, 그래프·노브 스타일과 방향 반전 |
| 변경 내용   | 공통 Checkbox의 `after-paint` 전략을 사용자 표면 14개에 옵트인                                |
| 커밋·PR     | `99e64f07`                                                                                    |
| 안전성 분류 | 로컬 상태를 먼저 갱신하는 그래프·노브 경로와 로컬 갱신 후 저장 IPC를 실행하는 Grid 경로       |
| 정확성 검증 | 타입 검사·린트·공통 Checkbox, 패널 계약, 배치 handler, 렌더 계약의 34개 테스트 통과           |
| 성능 값     | 개별 WebView CTP와 Grid 드래그·리사이즈 F95 미측정 — 실측 전까지 수치 미기재                  |
| 결론        | 구현은 실험 상태이며 플랫폼 자동 측정과 저장 실패 재동기화 검증 후 완료 여부 결정             |

### EXP-006: 설정 토글 행 시각 우선 계약

| 필드        | 내용                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| 항목 ID     | BASE-02, TOG-01~10                                                                                 |
| 적용 범위   | 오버레이 잠금, 항상 위, 전역 노트·카운터, 트레이, OBS, 자동 업데이트, 개발자 모드, 커스텀 CSS·JS   |
| 변경 내용   | 행 버튼이 소유한 `SettingToggleRow`에 선택적 `after-paint` 계약을 추가하고 10개 설정 표면에 옵트인 |
| 커밋·PR     | `05c02e43`                                                                                         |
| 정확성 검증 | 기본 sync 호환·행과 장식 체크박스의 동시 시각 반영·연타 최종 의도 병합 테스트 통과                 |
| 성능 값     | 개별 WebView CTP와 IPC·서비스 ETC 미측정 — 실측 전까지 수치 미기재                                 |
| 남은 게이트 | 저장·IPC 실패 시 authoritative 재동기화, OBS 연속 조작, macOS WKWebView·Windows WebView2 자동 측정 |
| 결론        | 공통 기반과 사용처 구현은 실험 상태이며 실패 정합성과 플랫폼 측정 후 완료 여부 결정                |

## 8. 완료 게이트

성능이 빨라졌더라도 다음 항목 중 하나가 깨지면 완료 처리하지 않는다.

- 마지막 사용자 의도가 최종 상태에 보존됨
- 실패 시 rollback 또는 authoritative 재동기화가 동작함
- 빠른 연속 입력과 중복 실행이 안전함
- 취소·Escape·blur·저장 경합이 안전함
- Undo/Redo와 외부 상태 변경이 정확함
- 접근성 역할·키보드 조작·포커스 복원이 유지됨
- macOS·Windows의 실제 WebView에서 검증됨
- 기존 테스트와 관련 신규 테스트가 통과함

## 9. 우선 적용 순서

1. `PILOT-01` 단일 선택 그림자 사용 토글
2. `PILOT-02` 다중 선택 그림자 사용 토글
3. `BASE-13`, `GRID-*`, `LAYER-08~09`, `PROP-03~04`, `EDIT-*`의 P0 경로
4. 나머지 프로퍼티·토글 P1 경로
5. IPC·파일·플러그인 P2 경로
6. 검증된 계약의 공통 컴포넌트 확대
