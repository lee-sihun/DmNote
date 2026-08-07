# 사용자 상호작용 최적화 인벤토리

> 조사일: 2026-08-07
>
> 상태: 정적 전수 조사 완료 / 실제 성능 계측 대기
>
> 기반 설계: [인터랙션 반응성 개선 설계](interaction-responsiveness-design.md)
>
> 성능 기록: [인터랙션 성능 개선 추적표](interaction-performance-tracker.md)
>
> 최초 파일럿: 프로퍼티 패널 `그림자 사용` 토글

---

## 1. 목적

DmNote에서 사용자가 직접 조작하는 버튼, 토글, 입력, 선택, 드래그, 리사이즈, 팝업, 키보드 단축키와 플러그인 UI 표면을 전수 조사한다. 각 상호작용을 후속 작업의 성격에 따라 분류하고, 파일럿 이후 어떤 순서와 기법으로 최적화할지 결정하기 위한 기준 목록으로 사용한다.

이 문서는 **최적화 적용 후보 인벤토리**다. 목록에 포함됐다는 이유만으로 모든 항목에 낙관적 업데이트를 적용하지 않는다. 실제 계측에서 병목이 확인된 항목만 해당 유형의 기법을 적용한다.

## 2. 조사 범위와 방법

### 2.1 포함 범위

- 메인 창
- 인라인·분리 프로퍼티 패널
- Grid 캔버스와 요소 편집
- 설정 화면과 사이드 패널
- 툴바
- 모달, 팝업, 피커, 편집기
- 전역 키보드 단축키
- 오버레이 창의 사용자 메뉴
- 플러그인 생성 UI와 Display Element 조작

### 2.2 제외·제한 범위

- 테스트 코드의 가짜 이벤트
- 표시만 수행하고 입력을 받지 않는 오버레이 렌더 컴포넌트
- 운영체제 파일 선택기 내부 UI
- 설치된 외부 플러그인이 런타임에 임의로 생성하는 HTML의 실제 개수

플러그인 UI는 실제 인스턴스 수를 정적으로 알 수 없으므로 생성 팩토리와 이벤트 위임 경로를 조사 대상으로 삼았다.

### 2.3 정적 조사 결과

테스트를 제외한 현재 소스 기준:

- 이벤트 패턴 또는 공통 입력 사용이 정적으로 탐지된 소스: **100개**
- JSX `on*` 콜백 속성: **623곳**
- 직접 `addEventListener()` 등록: **129곳**
- 네이티브 `<button>`: **126개**, 48개 파일
- `NumberInput`: **56개**, 13개 파일
- 네이티브 `<input>`: **38개**, 17개 파일
- 직접 `<Checkbox>` 사용: **36개**, 17개 파일
- `Dropdown`: **27개**, 12개 파일
- `ColorSwatchButton`: **19개**, 10개 파일
- `SettingToggleRow`: **10개**, 3개 파일
- `ColorInput`: **9개**, 4개 파일
- `TextInput`: **8개**, 5개 파일
- `TabSwitch`: **7개**, 6개 파일
- `OptionalNumberInput`: **6개**, 2개 파일

JSX 수치는 DOM 이벤트뿐 아니라 하위 컴포넌트에 전달하는 callback Props도 포함한다. 직접 이벤트 리스너 수에는 resize·focus·visibility 같은 생명주기 리스너도 포함되므로 성능 후보 수와 일치하지 않는다. Prop spread로 이벤트를 주입하는 `usePressAction` 계열과 스크롤·내비게이션 지원 모듈은 이 수치와 별도로 수동 추적했다.

## 3. 분류 기준

### 3.1 우선순위

| 우선순위 | 의미                                                  | 대표 사례                                         |
| -------- | ----------------------------------------------------- | ------------------------------------------------- |
| **P0**   | 프레임마다 들어오는 연속 입력. 끊김이 즉시 체감됨     | 드래그, 리사이즈, 휠 줌, 색상 슬라이더, 파형 편집 |
| **P1**   | 단발 입력이지만 큰 Store·캔버스·문서 변경을 유발      | 그림자 토글, 배치 스타일, 요소 추가·삭제, 탭 전환 |
| **P2**   | IPC·파일·서비스 작업을 기다리는 비동기 액션           | 프리셋, CSS/JS, OBS, 파일 로드, 저장·삭제         |
| **P3**   | 가벼운 로컬 UI 상태 변경                              | 팝업 열기, 탭 선택, 단순 모달 닫기                |
| **기반** | 다수 사용처의 반응성과 접근성에 영향을 주는 공통 계층 | Checkbox, Dropdown, NumberInput, Modal            |

### 3.2 적용 기법 코드

| 코드  | 기법                                | 적용 목적                                         |
| ----- | ----------------------------------- | ------------------------------------------------- |
| **F** | 즉시 시각 피드백                    | pressed/selected/checked 상태를 먼저 표시         |
| **O** | 낙관적 상태 + 조정                  | 성공 전 로컬 반영, 실패 시 rollback 또는 재동기화 |
| **Y** | 작업 우선순위 분리·메인 스레드 양보 | 다음 paint 전에 무거운 작업이 막지 않게 분리      |
| **R** | 렌더 격리·세밀한 Store 구독         | 변경되지 않은 패널·캔버스 요소 재렌더 방지        |
| **V** | rAF·ref 기반 프리뷰                 | 연속 이벤트를 프레임당 한 번으로 제한             |
| **C** | coalescing·write-behind             | 중간 저장을 합치고 마지막 의도만 커밋             |
| **P** | pending·single-flight·취소          | 중복 실행과 불명확한 대기 상태 방지               |
| **W** | Worker·오프메인 스레드              | 파형·대규모 계산을 UI 스레드에서 분리             |
| **M** | click-to-paint·프레임 계측          | 추측이 아닌 실제 병목 판별                        |

## 4. 공통 UI 기반

공통 계층 변경은 파급 범위가 크므로 그림자 파일럿의 결과를 확인한 후 별도 변경한다.

| 대상                                              | 현재 역할                                      | 잠재 영향                                       | 우선순위 | 후보 기법                                      |
| ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | -------- | ---------------------------------------------- |
| `common/Checkbox.tsx`                             | 30×18 토글, 제어형 `checked`                   | 직접 사용 36곳과 `SettingToggleRow` 경유 사용처 | 기반     | F, M; API는 `onCheckedChange(next)` 검토       |
| `common/SettingRow.tsx`                           | 행 전체가 토글인 설정 UI                       | 설정 토글 10개                                  | 기반     | F, O, P, 오류 조정 계약                        |
| `common/Dropdown.tsx`                             | 키보드·클릭·외부 닫기 지원 드롭다운            | 27개 사용처                                     | 기반     | F, R, M; 옵션이 많으면 virtualization          |
| `PropertiesPanel/PropertyInputs.tsx`              | 숫자·옵션 숫자·텍스트·색상·탭 입력             | 속성 편집의 핵심 경로                           | 기반/P0  | V, C, R, Escape rollback, preview/commit 분리  |
| `common/SearchField.tsx`                          | 검색 입력과 Escape 처리                        | 탭·리소스 목록 검색                             | 기반     | local echo, debounce, R                        |
| `common/KeySlotPicker.tsx`                        | 키 슬롯 조각 선택                              | 키 매핑                                         | P1       | F, O, 마지막 의도, 키 캡처 격리                |
| `common/TabSwitch.tsx`                            | 상태별·설정별 탭 전환                          | 7개 사용처                                      | 기반/P3  | F, R                                           |
| `common/IconSwap.tsx`·`EyeToggleIcon.tsx`         | 상태 버튼의 180ms 아이콘 전환                  | 표시·숨김과 상태형 아이콘                       | 기반     | 첫 paint M, reduced motion, 상태와 모션 분리   |
| `pickers/ColorSwatch.tsx`                         | 색상·그라데이션 피커 진입 버튼                 | 19개 사용처                                     | 기반/P1  | F, 피커 지연 mount와 좌표 측정 M               |
| `common/AddIconButton.tsx`                        | 목록 추가 진입                                 | 폰트·탭 등                                      | P2/P3    | F, P                                           |
| `Modal/ListPopup.tsx`                             | 메뉴 선택·서브메뉴·키보드 탐색                 | 13개 사용처                                     | 기반     | F, R, 키보드 응답 계측                         |
| `Modal/FloatingPopup.tsx`                         | 피커·목록 표면과 click-away                    | 4개 직접 사용 + 다수 래핑                       | 기반     | R, 이벤트 리스너 범위 축소                     |
| `Modal/Modal.tsx`                                 | 배경 클릭·Escape·wheel/context 차단            | 8개 직접 사용                                   | 기반     | F, 포커스 복원, 불필요한 전역 리스너 점검      |
| `Modal/TooltipGroup.tsx`                          | 첫 hover 지연과 그룹 내 이동 최적화            | 툴바·아이콘 도움말                              | 기반/P3  | 기존 잔여 지연 유지, hover-to-paint M          |
| `PropertiesPanel/PanelToggleButton.tsx`           | press-action 기반 패널 개폐, 180ms WAAPI 전환  | 프로퍼티 패널 진입·이탈                         | 기반/P1  | F, M, 개폐 시 대형 패널 mount·render 분리      |
| `PropertiesPanel/PickerSurface.tsx`               | 인라인·분리 창의 피커 배치와 닫기 계약         | 속성 피커 전반                                  | 기반/P3  | 첫 open 측정, layout read/write 분리, R        |
| `PropertiesPanel/PanelNavContext.tsx`             | 패널 내부 서브 페이지 open/close               | 리소스·설정 피커 전반                           | 기반/P3  | F, exit 전환 중 입력 일관성                    |
| `PropertiesPanel/usePanelScroll.ts`·`useLenis.ts` | keepalive 탭 6개에 smooth scroll RAF 루프 유지 | 프로퍼티 패널 스크롤과 메인 스레드 예산         | 기반/P0  | M, 비활성 탭 루프 정지 또는 단일 RAF 공유 검토 |
| `usePressGatedSwap.ts`                            | 직접 클릭 여부에 따른 모션 허용                | Checkbox·아이콘 전환                            | 기반     | M, 300ms 휴리스틱 검증                         |
| `usePressAction.ts`                               | pointer press와 취소 상태 관리                 | 공통 pressed 피드백                             | 기반     | F, 이벤트 위임 비용 점검                       |

## 5. 토글 전수 목록

### 5.1 일반 설정 토글

`Settings.tsx`, `SettingsPanel/CssPanelContent.tsx`, `SettingsPanel/PluginsPanelContent.tsx`의 `SettingToggleRow` 경로다.

| 토글          | 후속 작업                          | 우선순위 | 후보 기법                           |
| ------------- | ---------------------------------- | -------- | ----------------------------------- |
| 오버레이 잠금 | `overlay.setLock` IPC              | P2       | F, O, rollback, P, M                |
| 항상 위       | settings 저장 + 창 상태            | P2       | F, O, authoritative 재동기화        |
| 노트 효과     | settings 저장 + 오버레이 렌더 변경 | P1       | F, O, R, M                          |
| 키 카운터     | settings 저장 + 키 렌더 변경       | P1       | F, O, R, M                          |
| 트레이 모드   | settings 저장                      | P2       | F, O, 실패 조정                     |
| OBS 모드      | 서비스 시작·중지 + 상태 조회       | P2       | F, P, 명시적 pending, 실패 rollback |
| 자동 업데이트 | settings 저장                      | P2       | F, O                                |
| 개발자 모드   | settings 저장 + DevTools 열기      | P2       | F, P                                |
| 커스텀 CSS    | CSS 활성화 IPC + 화면 스타일 변경  | P1/P2    | F, O, R, 실패 조정                  |
| 커스텀 JS     | 플러그인 런타임 활성화 IPC         | P2       | F, P, 실패 조정                     |

### 5.2 Grid 설정 토글

`PropertiesPanel/GridTabContent.tsx`의 `CheckboxRow` 경로다.

| 토글             | 후속 작업                                  | 우선순위 | 후보 기법             |
| ---------------- | ------------------------------------------ | -------- | --------------------- |
| 미니맵 표시      | Grid 보조 UI mount/unmount + settings 저장 | P1       | F, O, R               |
| 정렬 가이드      | 드래그 프레임 계산 정책 변경               | P1       | F, O, 드래그 경로 M   |
| 간격 가이드      | 드래그·배치 계산 정책 변경                 | P1       | F, O, 드래그 경로 M   |
| 크기 일치 가이드 | 리사이즈 프레임 계산 정책 변경             | P1       | F, O, 리사이즈 경로 M |

### 5.3 단일 선택 프로퍼티 토글

| 파일                              | 토글                                                   | 우선순위      | 후보 기법        |
| --------------------------------- | ------------------------------------------------------ | ------------- | ---------------- |
| `single/StyleTabContent.tsx`      | 인라인 스타일 우선, 키 사운드 사용                     | P1/P2         | F, O, R, P       |
| `single/NoteTabContent.tsx`       | 노트 효과, Y축 자동 보정, 글로우                       | P1            | F, O, R, C       |
| `single/CounterTabContent.tsx`    | 카운터 사용, 카운터 애니메이션 사용                    | P1            | F, O, R          |
| `single/SingleSelectionPanel.tsx` | 그래프 평균선, 그래프 애니메이션, 그래프 인라인 스타일 | P1            | F, O, R          |
| `single/SingleSelectionPanel.tsx` | 노브 방향 반전, 노브 인라인 스타일                     | P1            | F, O, R          |
| `ShadowControls.tsx`              | 그림자 사용(대기·입력 마스터)                          | **P1 파일럿** | F, O, Y, R, C, M |

### 5.4 다중 선택 프로퍼티 토글

| 파일                                         | 토글                                     | 우선순위           | 후보 기법        |
| -------------------------------------------- | ---------------------------------------- | ------------------ | ---------------- |
| `batch/BatchStyleTabContent.tsx`             | 인라인 스타일 우선, 사운드 사용          | P1                 | F, O, Y, R, C    |
| `batch/BatchNoteTabContent.tsx`              | 노트 효과, Y축 자동 보정, 글로우         | P1                 | F, O, Y, R, C    |
| `batch/BatchCounterTabContent.tsx`           | 카운터 사용, 애니메이션 사용             | P1                 | F, O, Y, R, C    |
| `batch/BatchSelectionPanel.tsx`              | 그래프 평균선·애니메이션, 노브 방향 반전 | P1                 | F, O, Y, R, C    |
| `ShadowControls.tsx` + `useBatchHandlers.ts` | 선택 요소 전체 그림자 마스터             | **P1 파일럿 확장** | F, O, Y, R, C, M |

`BatchSelectionPanel`에는 선택 조합별 레이아웃 분기로 같은 그래프 토글이 두 표면에 렌더되는 경로가 있다. 공통 상태와 마지막 의도가 두 표면에서 일치하는지 함께 검증한다.

### 5.5 모달·피커 토글

| 파일                             | 토글                             | 우선순위 | 후보 기법                             |
| -------------------------------- | -------------------------------- | -------- | ------------------------------------- |
| `editors/TabCssModal.tsx`        | 탭 CSS 사용                      | P2       | F, O, P, 실패 시 authoritative 재조회 |
| `pickers/ImagePicker.tsx`        | 이미지 투명화                    | P1       | F, O, R                               |
| `settings/CounterTabContent.tsx` | 카운터 사용                      | P3/P1    | F, 로컬 상태 우선                     |
| `settings/NoteSetting.tsx`       | 효과 반전, 지연 노트             | P3       | F                                     |
| `settings/NoteTabContent.tsx`    | 글로우, 노트 효과, Y축 자동 보정 | P3/P1    | F, 로컬 preview 격리                  |
| `PropertiesPanel.tsx`            | 플러그인 boolean 설정            | P1/P2    | F, O, 플러그인 설정 커밋 조정         |
| `dialogs/UpdateModal.tsx`        | 버전 건너뛰기 네이티브 체크박스  | P2       | F, 저장 상태 조정                     |

### 5.6 플러그인 토글

`utils/plugin/pluginComponents.ts`의 `createCheckbox()`는 React 공통 `Checkbox`와 별도 구현이다. `PluginElement.tsx`와 `pluginDialogInteractions.ts`가 DOM 이벤트 위임으로 상태를 바꾸고 플러그인 handler를 실행한다.

| 대상                                 | 우선순위 | 후보 기법                               |
| ------------------------------------ | -------- | --------------------------------------- |
| Display Element 내 플러그인 체크박스 | P1/P2    | F, handler pending 격리, 실패 조정 계약 |
| 플러그인 설정 스키마 boolean         | P1/P2    | F, O, 마지막 의도, 설정 저장 병합       |
| 커스텀 다이얼로그 체크박스           | P2       | F, Promise handler pending·오류 표면화  |

공통 React 토글 파일럿의 결과가 플러그인 토글에 자동 적용되지는 않는다. 별도 팩토리와 이벤트 위임 구현에 같은 계약을 이식해야 한다.

## 6. Grid·캔버스 상호작용

Grid는 가장 높은 우선순위의 연속 입력 표면이다.

| 상호작용              | 주요 파일                                                            | 현재 후속 작업                             | 우선순위 | 후보 기법                         |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------ | -------- | --------------------------------- |
| 단일 요소 드래그      | `useDraggable.ts`, `shared/Key.tsx`, `GraphItem.tsx`, `KnobItem.tsx` | 좌표, 스마트 가이드, 선택, 종료 커밋       | **P0**   | V, R, C, M                        |
| 다중 선택 드래그      | `useSelectionDrag.ts`                                                | 그룹 bounds, 선택 요소 전체 preview        | **P0**   | V, R, C, precompute, M            |
| Grid 패닝             | `useGridZoomPan.ts`                                                  | pan Store와 전체 viewport transform        | **P0**   | V, ref, 합성 transform, M         |
| 휠·핀치 줌            | `useGridZoomPan.ts`                                                  | zoom+pan 계산, 전체 viewport transform     | **P0**   | V, coalesce, 수동 passive 정책, M |
| 미들 버튼 팬          | `useGridZoomPan.ts`                                                  | 전역 mousemove/up                          | **P0**   | V, pointer capture, M             |
| 단일 리사이즈         | `useGridResize.ts`, `ResizeHandles.tsx`                              | preview bounds, 스마트 가이드, 종료 커밋   | **P0**   | V, R, C, M                        |
| 그룹 리사이즈         | `useGridResize.ts`, `GroupResizeHandles.tsx`                         | 선택 전체 비율 계산과 preview              | **P0**   | V, precompute, R, C, M            |
| 그라데이션 축 핸들    | `GradientAxisHandle.tsx`                                             | 캔버스 gradient preview와 commit           | **P0**   | V, R, C, M                        |
| 마퀴 선택             | `useGridMarquee.ts`                                                  | 모든 키·통계·그래프·노브·플러그인 hit-test | P0/P1    | V, 공간 인덱스 검토, R, M         |
| 미니맵 클릭 이동      | `GridMinimap.tsx`                                                    | viewport pan 변경                          | P1       | F, V, M                           |
| 미니맵 드래그         | `GridMinimap.tsx`                                                    | 연속 viewport pan 변경                     | **P0**   | V, R, M                           |
| 요소 단일·다중 선택   | `Grid.tsx`, `useGridSelection.ts`                                    | 선택 Store, 패널 내용 교체                 | P1       | F, R, 선택 selector 축소          |
| Shift 범위 선택       | `Grid.tsx`                                                           | 모든 요소 bounds 순회                      | P1       | F, precompute/공간 인덱스, M      |
| 더블클릭 편집         | `Grid.tsx`, 요소 컴포넌트                                            | 편집 모달 mount                            | P3/P1    | F, 모달 코드 지연 로드 검토       |
| 컨텍스트 메뉴         | `Grid.tsx`, `useGridContextMenu.ts`                                  | 메뉴 모델과 위치 계산                      | P3       | F, R                              |
| 요소 추가             | `CanvasTool.tsx`, `Grid.tsx`, `useGridCanvasActions.ts`              | 요소 생성, Store·문서 저장                 | P1       | F, O, R, C                        |
| 삭제·지우개           | `CanvasTool.tsx`, `Grid.tsx`, `useGridCanvasActions.ts`              | 선택/인덱스 정합성, 전체 문서 커밋         | P1       | F, O, P, M                        |
| 복제·복사·붙여넣기    | `Grid.tsx`, `useGridCanvasActions.ts`, `useGridKeyboard.ts`          | 새 요소와 위치 배열 생성                   | P1       | F, O, R, C                        |
| z-order 이동          | `Grid.tsx`, layer action, 키보드 `[`/`]`                             | 배열·zIndex 갱신                           | P1       | F, O, R, C                        |
| 그룹화·그룹 해제      | `useGridKeyboard.ts`, `groupActions`                                 | 선택 요소 관계와 문서 변경                 | P1       | F, O, R, C                        |
| 방향키 이동           | `useGridKeyboard.ts`                                                 | 반복 입력, 500ms gesture 병합              | **P0**   | C, R, M; 현재 병합 유지 검증      |
| Undo/Redo             | `useHistoryShortcuts.ts`, `useKeyManager.ts`                         | 편집 문서 교체·Store 동기화                | P1       | F, P, R, authoritative 표시       |
| 현재 키 카운터 초기화 | `Grid.tsx`                                                           | IPC + 표시값 변경                          | P2       | F, P, 결과 조정                   |

## 7. 레이어 패널 상호작용

| 상호작용              | 주요 파일                                         | 우선순위    | 후보 기법                                 |
| --------------------- | ------------------------------------------------- | ----------- | ----------------------------------------- |
| 레이어·Grid 탭 전환   | `LayerPanel.tsx`                                  | P3          | F, R                                      |
| 레이어 단일·다중 선택 | `LayerTabContent.tsx`                             | P1          | F, R, 캔버스 선택과 단일 source of truth  |
| 그룹 접기·펼치기      | `LayerTabContent.tsx`                             | P3          | F, R                                      |
| 이름 변경             | `LayerTabContent.tsx`                             | P2/P1       | local draft, blur commit, Escape rollback |
| 표시·숨김             | `LayerTabContent.tsx`, `useLayerActions.ts`       | P1          | F, O, R, C                                |
| 잠금·잠금 해제        | `LayerTabContent.tsx`, `useLayerActions.ts`       | P1          | F, O, R                                   |
| 위·아래 이동          | `LayerTabContent.tsx`, `useLayerActions.ts`       | P1          | F, O, R, C                                |
| 드래그 순서 변경      | `useLayerDnD.ts`                                  | **P0/P1**   | V, local preview, 종료 commit, C, M       |
| 그룹 드래그·중첩      | `useLayerDnD.ts`                                  | **P0/P1**   | V, hit-test 최적화, C, M                  |
| 컨텍스트 메뉴         | `LayerTabContent.tsx`                             | P3          | F                                         |
| 패널 detach/reattach  | `PanelHeaderActions.tsx`, `windows/panel/App.tsx` | P2          | F, P, handoff 상태 표시                   |
| 분리 패널 창 이동     | `windows/panel/App.tsx`                           | P0/네이티브 | native drag 유지, 중복 시작 방지          |

## 8. 프로퍼티 패널 입력

### 8.1 공통 편집 유형

| 편집 유형        | 대표 항목                                   | 우선순위 | 후보 기법                                  |
| ---------------- | ------------------------------------------- | -------- | ------------------------------------------ |
| 숫자 입력        | 위치, 크기, 테두리, 반경, 간격, 그림자 수치 | P0/P1    | local draft, preview/commit, C, R, M       |
| 텍스트 입력      | 표시 텍스트, className, 플러그인 문자열     | P1       | local draft, debounce preview, blur commit |
| 색상 입력        | 배경·테두리·글자·노트·글로우·카운터         | **P0**   | V, R, preview/commit, C                    |
| 그라데이션       | 색상 정지점, 방향, 형식                     | **P0**   | V, R, C, M                                 |
| 드롭다운         | 정렬, 타입, 배치, 애니메이션, 이미지 fit    | P1       | F, O, R                                    |
| 폰트 스타일 버튼 | bold, italic, underline, strike             | P1       | F, O, C                                    |
| 키 매핑          | 키 슬롯 picker와 실입력 캡처                | P1/P2    | F, P, 캡처 상태 격리, 마지막 입력          |
| 이미지 설정      | idle/active 파일, 투명도, fit, reset        | P2/P1    | F, P, O, blob/image decode 격리            |
| 사운드 설정      | 활성화, 파일 선택, 볼륨                     | P2/P1    | F, P, preview/commit                       |

패널 자체 상호작용도 포함한다.

| 상호작용                        | 주요 파일                                                                    | 우선순위 | 후보 기법                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| 패널 열기·닫기                  | `PanelToggleButton.tsx`, `PropertiesPanel.tsx`                               | P1       | pointerdown 즉시 피드백, 패널 렌더 분리, click-to-paint M |
| 단일·다중 선택 탭 전환          | `PropertiesPanel.tsx`, `SingleSelectionPanel.tsx`, `BatchSelectionPanel.tsx` | P1       | F, keepalive 렌더 범위 점검, R                            |
| 패널 내부 피커 페이지 열기·닫기 | `PanelNavContext.tsx`, `PickerSurface.tsx`                                   | P3/P1    | F, 좌표 측정과 콘텐츠 mount 분리                          |
| 패널 스크롤                     | `usePanelScroll.ts`, `useLenis.ts`                                           | **P0**   | 6개 RAF 루프 실측, 비활성 탭 정지·단일 scheduler 검토     |

### 8.2 단일 선택 패널

`single/StyleTabContent.tsx`, `single/NoteTabContent.tsx`, `single/CounterTabContent.tsx`, `single/SingleSelectionPanel.tsx`가 대상이다.

- 키: 매핑, 위치, 크기, 배경·테두리, 그라데이션, 반경, 이미지, 그림자, 텍스트, 폰트, 인라인 CSS, 사운드
- 노트: 색상·그라데이션, 투명도, 효과, Y 보정, 길이·속도·오프셋, 글로우, 테두리
- 카운터: 활성화, 배치·정렬, 간격, 글자·배경·테두리, 애니메이션
- 통계: 통계 종류, 그래프·표시 스타일, 크기·색상·그림자
- 그래프: 종류, 평균선, 애니메이션, 데이터·스타일·그라데이션
- 노브: 방향, 이미지, 색상·그라데이션, 반경·테두리·그림자, 인라인 CSS

단일 선택도 전체 mode positions 배열을 갱신하는 경로가 있으므로 단순 필드 수와 무관하게 P1로 계측한다.

### 8.3 다중 선택 패널

`batch/BatchStyleTabContent.tsx`, `BatchNoteTabContent.tsx`, `BatchCounterTabContent.tsx`, `BatchSelectionPanel.tsx`, `useBatchHandlers.ts`가 대상이다.

- 정렬, 분배, 간격
- 위치·크기·반경·테두리
- 배경·글자·테두리·그라데이션
- 이미지·그림자·폰트 스타일
- 노트 효과·색상·글로우·길이·속도·오프셋
- 카운터 활성화·배치·간격·색상·애니메이션
- 그래프 평균선·애니메이션·형태
- 노브 방향과 스타일
- Mixed 값 해소

모든 batch commit은 선택 요소 수에 따라 비용이 증가할 수 있으므로 P1로 분류한다. 타이핑·슬라이더 preview는 P0로 분리해 프레임 단위로 계측한다.

### 8.4 플러그인 프로퍼티 설정

`PropertiesPanel.tsx`의 스키마 기반 boolean, color, number, text, select 설정 렌더와 `PluginSettingsPanelView.tsx`의 저장 CTA가 대상이다.

| 설정 타입 | 우선순위 | 후보 기법                                                 |
| --------- | -------- | --------------------------------------------------------- |
| boolean   | P1/P2    | F, O, 마지막 의도                                         |
| color     | P0/P1    | preview/commit, V, C                                      |
| number    | P1       | local draft, validation, C                                |
| text      | P1       | local draft, debounce/blur commit                         |
| select    | P1       | F, O                                                      |
| 전체 저장 | P2       | press 즉시 피드백, P, 중복 저장 차단, 성공·실패 상태 표시 |

저장 버튼은 입력 blur와 click 경합을 `usePressAction`으로 방어하고 있다. 여기에 저장 pending·single-flight와 결과 피드백을 추가할지 실제 저장 시간으로 판단한다. 플러그인 callback이 동기적으로 오래 실행되는 경우 호스트 UI를 막을 수 있으므로 handler 실행 시간과 오류 격리가 필요하다.

## 9. 설정 화면과 툴바

### 9.1 설정 화면

| 상호작용                  | 주요 파일                                 | 우선순위 | 후보 기법                              |
| ------------------------- | ----------------------------------------- | -------- | -------------------------------------- |
| 키 사운드 출력 변경       | `Settings.tsx`                            | P2       | P, 상태 표시, 실패 시 재동기화         |
| ASIO 버퍼 변경            | `Settings.tsx`                            | P2       | P, 적용 중 표시, 실패 복구             |
| 리사이즈 앵커             | `Settings.tsx`                            | P2       | F, O                                   |
| 언어 변경                 | `Settings.tsx`                            | P1       | F, R, 번역 전체 재렌더 M               |
| 렌더러/ANGLE 모드         | `Settings.tsx`                            | P2       | 확인, P, 재시작 상태                   |
| 플러그인 추가·재로드      | `Settings.tsx`                            | P2       | P, 진행 상태, 중복 실행 차단           |
| 플러그인 활성화           | `Settings.tsx`, `PluginsPanelContent.tsx` | P2       | F, O 또는 pending, 실패 조정           |
| 플러그인 삭제·데이터 삭제 | 설정 패널·확인 모달                       | P2       | P, 취소, 완료 후 목록 조정             |
| CSS 파일 로드·활성화·삭제 | `CssPanelContent.tsx`                     | P2       | P, 목록 local projection, 실패 조정    |
| 단축키 캡처·삭제          | `ShortcutsPanelContent.tsx`               | P1/P2    | F, 캡처 격리, 충돌 검증, 저장 rollback |
| OBS URL 복사              | `Settings.tsx`                            | P2       | 즉시 완료 피드백                       |
| OBS 토큰 재생성           | `Settings.tsx`                            | P2       | 확인, P, 결과 표시                     |
| 전체 초기화               | `Settings.tsx`                            | P2       | 확인, P, 전체 상태 재부트스트랩        |
| 업데이트 확인             | `Settings.tsx`, update hook               | P2       | P, 중복 실행 차단                      |

### 9.2 툴바

| 상호작용                      | 주요 파일                    | 우선순위    | 후보 기법                               |
| ----------------------------- | ---------------------------- | ----------- | --------------------------------------- |
| 이동·지우개 도구 선택         | `CanvasTool.tsx`             | P3          | F, 단일 source of truth                 |
| 키·통계·그래프·노브 추가 메뉴 | `CanvasTool.tsx`             | P1          | F, O, R                                 |
| 팔레트 열기                   | `CanvasTool.tsx`             | P3          | F, 지연 mount 점검                      |
| 현재 탭·카운터 초기화         | `CanvasTool.tsx`             | P2          | 확인, P, 결과 동기화                    |
| 기본 4/5/6/8키 탭 전환        | `TabTool.tsx`                | P1/P2       | F, O, 요청 generation, R                |
| 커스텀 탭 팝업                | `TabTool.tsx`, `TabList.tsx` | P3/P2       | F, P                                    |
| 프리셋 전체·탭 저장           | `SettingTool.tsx`            | P2          | P, 진행·완료 표시                       |
| 프리셋 전체·탭 불러오기       | `SettingTool.tsx`            | P2          | P, 선택 초기화, authoritative bootstrap |
| 오버레이 표시                 | `SettingTool.tsx`            | P2          | 현재 O+rollback 유지, M                 |
| 설정 화면 열기·뒤로           | `SettingTool.tsx`            | P1          | F, R, 큰 화면 전환 M                    |
| 노트 트랙 설정 열기           | `ToolBar.tsx`                | P3          | F                                       |
| GitHub·이슈 외부 링크         | `ToolBar.tsx`                | P2/네이티브 | F, 오류 표면화                          |
| 창 최소화·닫기                | `TitleBar.tsx`               | P2/네이티브 | F, 중복 호출 차단 필요 여부 점검        |

## 10. 모달·피커·편집기

### 10.1 고빈도 편집기

| 상호작용                                   | 주요 파일                                                 | 우선순위 | 후보 기법                            |
| ------------------------------------------ | --------------------------------------------------------- | -------- | ------------------------------------ |
| 색상 saturation·hue·alpha 드래그           | `ColorPicker.tsx`, `colorPickerPrimitives.tsx`            | **P0**   | V, R, preview/commit, C, M           |
| 색상 텍스트·퍼센트 입력                    | `ColorPicker.tsx`                                         | P1       | local draft, blur commit, validation |
| 그라데이션 stop 드래그·추가·삭제·형식 전환 | `GradientFormatControls.tsx`, `useGradientColorState.tsx` | **P0**   | V, R, C, draft/commit 분리, M        |
| 카운터 bezier point 드래그                 | `CounterAnimationEditorModal.tsx`                         | **P0**   | V, R, M                              |
| 카운터 미리보기 scrub·wheel·play           | 같은 파일                                                 | **P0**   | V, precompute, M                     |
| 사운드 파형 pan·zoom·trim handle           | `SoundTrimModal.tsx`                                      | **P0**   | V, W, R, M                           |
| 사운드 재생·정지·seek                      | `SoundTrimModal.tsx`                                      | P0/P1    | ref 기반 표시, media event coalesce  |
| 사운드 처리 저장                           | `SoundTrimModal.tsx`                                      | P2       | P, 취소, progress, 실패 복구         |

### 10.2 리소스 피커

| 상호작용                        | 주요 파일                                     | 우선순위 | 후보 기법                              |
| ------------------------------- | --------------------------------------------- | -------- | -------------------------------------- |
| 사운드 선택·검색·필터           | `SoundPicker.tsx`, `CommonListPickerPage.tsx` | P1       | F, debounce, R, 큰 목록 virtualization |
| 사운드 추가·삭제·이름 변경·숨김 | `SoundPicker.tsx`                             | P2       | P, O, 실패 조정                        |
| 폰트 선택·검색·필터             | `FontPicker.tsx`, `CommonListPickerPage.tsx`  | P1       | F, debounce, R, font load 격리         |
| 폰트 추가·삭제·이름 변경        | `FontPicker.tsx`, `WebFontInputModal.tsx`     | P2       | P, validation, 실패 조정               |
| 카운터 애니메이션 선택·삭제     | `CounterAnimationPicker.tsx`                  | P2       | F, P, 목록 조정                        |
| 카운터 애니메이션 생성·편집     | `CounterAnimationEditorModal.tsx`             | P2/P0    | local draft, P, 고빈도 경로 분리       |
| 이미지 idle/active 로드         | `ImagePicker.tsx`                             | P2       | P, decode 비용 분리, 결과 조정         |
| 이미지 reset·fit·투명도         | `ImagePicker.tsx`                             | P1       | F, O, R                                |
| 그림자 상태 탭·수치·색상        | `ShadowPicker.tsx`                            | P0/P1    | preview/commit, V, C                   |
| 팔레트 색상 선택·편집           | `Palette.tsx`                                 | P1       | F, local draft, 저장 C                 |

### 10.3 설정·문서 모달

| 상호작용                               | 주요 파일                                                                             | 우선순위 | 후보 기법                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| 통합 키 설정 저장·취소                 | `GridKeySettingModal.tsx`, `UnifiedKeySetting.tsx`                                    | P2       | local draft, P, atomic commit, rollback   |
| 키 탭 매핑·크기·이미지                 | `settings/KeyTabContent.tsx`                                                          | P1       | local preview, commit 분리                |
| 노트 설정 전체                         | `settings/NoteSetting.tsx`, `NoteTabContent.tsx`                                      | P1/P2    | local draft, preview/commit, P            |
| 카운터 설정 전체                       | `settings/CounterTabContent.tsx`                                                      | P1/P2    | local draft, preview/commit, P            |
| 탭 CSS 로드·활성화·이력·저장           | `TabCssModal.tsx`                                                                     | P2       | P, O, authoritative 재조회                |
| 탭 이름 변경                           | `TabNameModal.tsx`                                                                    | P2       | local draft, P, validation                |
| 커스텀 탭 생성·선택·삭제               | `TabList.tsx`                                                                         | P2/P1    | F, O, P, generation                       |
| 업데이트 다운로드·릴리스 열기·건너뛰기 | `UpdateModal.tsx`                                                                     | P2       | P, progress, 취소·재시도                  |
| 플러그인 데이터 삭제 선택              | `PluginDataDeleteModal.tsx`                                                           | P2       | P, 위험 액션 명확화                       |
| Alert·Confirm·Custom Dialog            | `Alert.tsx`, `Modal.tsx`, `windows/main/App.tsx`, `windows/panel/PanelDialogHost.tsx` | 기반/P3  | 즉시 닫힘, Promise settle, 중복 요청 정책 |

## 11. 플러그인 사용자 상호작용

### 11.1 플러그인 UI 팩토리

`utils/plugin/pluginComponents.ts`:

- `createButton`
- `createCheckbox`
- `createInput`
- `createDropdown`
- `createPanel`
- `createFormRow`

버튼·체크박스·입력·드롭다운 handler는 문자열 ID 또는 Promise를 반환할 수 있는 함수로 등록된다.

### 11.2 이벤트 실행 경로

- `PluginElement.tsx`: Display Element 내부 click/change/input/blur 위임
- `pluginDialogInteractions.ts`: custom dialog 내부 이벤트 위임
- `pluginDropdownManager.ts`: 플러그인 드롭다운의 전역 click·keydown·scroll·resize
- `plugins/runtime/api/defineElement.ts`: 선언형 Display Element 컨트롤 생성
- `plugins/runtime/api/defineSettings.ts`: 선언형 설정 컨트롤 생성
- `displayElementApi.ts`: 캔버스 Display Element 조작
- `PluginElementsRenderer.tsx`: 선택·렌더 경계

### 11.3 최적화 후보

| 대상                                 | 우선순위 | 후보 기법                                               |
| ------------------------------------ | -------- | ------------------------------------------------------- |
| Promise plugin button handler        | P2       | P, timeout이 아닌 명시적 pending/cancel 계약, 오류 격리 |
| plugin input `onInput`               | P0/P1    | debounce/coalesce, handler 실행 시간 M                  |
| plugin dropdown                      | P3/P1    | F, 전역 리스너 단일화, 큰 목록 R                        |
| Display Element 선택·드래그·리사이즈 | P0       | 호스트 Grid와 동일한 V, R, C                            |
| plugin remove/context action         | P2       | P, 실패 조정                                            |

플러그인 코드는 호스트가 제어할 수 없는 동기 작업을 실행할 수 있다. handler duration 계측과 오류 경계는 호스트 API 레벨에서 제공하는 것이 적절하다.

## 12. 전역 키보드·창 상호작용

| 상호작용                                  | 주요 파일                                       | 우선순위    | 후보 기법                                 |
| ----------------------------------------- | ----------------------------------------------- | ----------- | ----------------------------------------- |
| 모드 전환 단축키                          | `windows/main/App.tsx`                          | P1/P2       | F, generation, stale 응답 차단            |
| 프로퍼티 패널 토글 단축키                 | `windows/main/App.tsx`                          | P1          | F, handoff 상태 M                         |
| Grid 이동·삭제·복사·붙여넣기·그룹·z-order | `useGridKeyboard.ts`                            | P0/P1       | C, R, 반복 입력 M                         |
| Undo/Redo                                 | `useHistoryShortcuts.ts`                        | P1          | P, R, 상태 표시                           |
| 키 슬롯 실입력 캡처                       | `useKeySlotCapture.ts`                          | P1          | 전역 이벤트 격리, 캡처 중 명확한 피드백   |
| 단축키 설정 캡처                          | `ShortcutsPanelContent.tsx`                     | P1/P2       | 충돌 검사, 저장 rollback                  |
| 브라우저·DevTools 단축키 차단             | main/overlay app, `useBlockBrowserShortcuts.ts` | 기반        | 캡처 우선순위와 충돌 점검                 |
| 분리 패널 `Cmd/Ctrl+W`                    | `windows/panel/App.tsx`                         | P2          | reattach pending, 중복 방지               |
| 오버레이 컨텍스트 메뉴                    | `OverlayScene.tsx`, `windows/overlay/App.tsx`   | P2/네이티브 | F, native menu 생성 비용 M                |
| 편집 flush 중 입력 잠금                   | `historyEditorFlushLock.ts`                     | 기반        | 잠금 중 사용자 피드백, 긴 잠금 M          |
| 창 focus·visibility 재동기화              | `editorCoordinator.ts`, `useAppBootstrap.ts`    | 기반        | 사용자 입력과 경쟁하지 않게 우선순위 분리 |

## 13. 적용 순서

### 13.1 1단계: 그림자 토글 파일럿

1. 단일 선택 `그림자 사용` 기준선 계측
2. 다중 선택 기준선 계측
3. 모션 비용 분리
4. 즉시 표시 상태 분리
5. 무거운 Store·캔버스 작업의 실행 경계 분리
6. 실패·연속 클릭·Undo/Redo 정확성 검증

### 13.2 2단계: P0 연속 입력

파일럿과 별개로 가장 큰 체감 효과가 예상되는 다음 항목을 계측한다.

1. 단일·다중 드래그
2. 단일·그룹 리사이즈
3. Grid pan·zoom·미니맵
4. 색상·그라데이션 편집
5. 레이어 DnD
6. 사운드 trim과 카운터 애니메이션 편집기

P0에는 낙관적 업데이트보다 rAF coalescing, ref 기반 preview, 종료 commit, 렌더 격리가 우선이다.

### 13.3 3단계: P1 프로퍼티·캔버스 변경

1. 단일 선택 boolean·dropdown
2. 다중 선택 boolean·batch patch
3. 요소 추가·삭제·복제·z-order
4. Grid mode 전환
5. 캔버스 mount/unmount를 유발하는 설정

### 13.4 4단계: P2 비동기 액션

1. OBS·오버레이·일반 설정
2. CSS·JS·플러그인 관리
3. 프리셋과 탭 관리
4. 파일·리소스 피커
5. 업데이트와 전체 초기화

P2에는 일괄 낙관 상태보다 pending, single-flight, 취소, 실패 재동기화가 우선인 항목이 많다.

### 13.5 5단계: 공통화

파일럿과 우선순위별 실험 결과가 모이면 다음을 공통화한다.

- `onCheckedChange(next)` 토글 계약
- `useResponsiveToggle`과 같은 마지막 의도·rollback 컨트롤러
- preview/commit 공통 입력 계약
- 공통 interaction performance mark
- pending·single-flight 버튼 패턴
- Store selector와 렌더 경계 가이드
- 플러그인 UI의 동등 계약

## 14. 완료 판정

각 항목은 다음 조건을 만족할 때 최적화 완료로 표시한다.

- 기준선과 변경 후 수치를 같은 조건에서 실측
- 첫 시각 반응과 최종 작업 완료 시간을 별도로 기록
- 평균뿐 아니라 느린 구간을 함께 확인
- 빠른 연속 입력에서 마지막 사용자 의도 보존
- 실패·취소·Undo/Redo·외부 동기화 정확성 유지
- macOS와 Windows WebView에서 동작 검증
- 기존 접근성 역할, 키보드 조작, 포커스 복원 유지
- 관련 단위·통합 테스트 통과

## 15. 조사 대상 소스 부록

### 15.1 프로퍼티 패널·Grid

```text
components/main/Grid/PropertiesPanel.tsx
components/main/Grid/PropertiesPanel/GridTabContent.tsx
components/main/Grid/PropertiesPanel/PanelHeaderActions.tsx
components/main/Grid/PropertiesPanel/PanelNavContext.tsx
components/main/Grid/PropertiesPanel/PanelToggleButton.tsx
components/main/Grid/PropertiesPanel/PickerSurface.tsx
components/main/Grid/PropertiesPanel/PluginSettingsPanelView.tsx
components/main/Grid/PropertiesPanel/PropertyInputs.tsx
components/main/Grid/PropertiesPanel/ShadowControls.tsx
components/main/Grid/PropertiesPanel/usePanelScroll.ts
components/main/Grid/PropertiesPanel/batch/BatchCounterTabContent.tsx
components/main/Grid/PropertiesPanel/batch/BatchNoteTabContent.tsx
components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel.tsx
components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent.tsx
components/main/Grid/PropertiesPanel/batch/useBatchHandlers.ts
components/main/Grid/PropertiesPanel/layer/LayerPanel.tsx
components/main/Grid/PropertiesPanel/layer/LayerTabContent.tsx
components/main/Grid/PropertiesPanel/layer/useLayerActions.ts
components/main/Grid/PropertiesPanel/layer/useLayerDnD.ts
components/main/Grid/PropertiesPanel/single/CounterTabContent.tsx
components/main/Grid/PropertiesPanel/single/NoteTabContent.tsx
components/main/Grid/PropertiesPanel/single/SingleSelectionPanel.tsx
components/main/Grid/PropertiesPanel/single/StyleTabContent.tsx
components/main/Grid/core/Grid.tsx
components/main/Grid/core/GridMinimap.tsx
components/main/Grid/handles/GradientAxisHandle.tsx
components/main/Grid/handles/GroupResizeHandles.tsx
components/main/Grid/handles/ResizeHandles.tsx
components/main/Grid/core/GridKeySettingModal.tsx
components/main/Grid/layers/GraphItem.tsx
components/main/Grid/layers/KnobItem.tsx
components/shared/GraphPanel.tsx
components/shared/Key.tsx
hooks/Grid/useDraggable.ts
hooks/Grid/useGridCanvasActions.ts
hooks/Grid/useGridContextMenu.ts
hooks/Grid/useGridKeyboard.ts
hooks/Grid/useGridMarquee.ts
hooks/Grid/useGridResize.ts
hooks/Grid/useGridSelection.ts
hooks/Grid/useGridZoomPan.ts
hooks/Grid/useHistoryShortcuts.ts
hooks/Grid/useSelectionDrag.ts
hooks/useKeyManager.ts
```

### 15.2 모달·설정·공통 UI

```text
components/main/Modal/FloatingPopup.tsx
components/main/Modal/FloatingTooltip.tsx
components/main/Modal/FullSurfaceModalLayout.tsx
components/main/Modal/ListPopup.tsx
components/main/Modal/Modal.tsx
components/main/Modal/TooltipGroup.tsx
components/main/Modal/content/dialogs/Alert.tsx
components/main/Modal/content/dialogs/PluginDataDeleteModal.tsx
components/main/Modal/content/dialogs/UnifiedKeySetting.tsx
components/main/Modal/content/dialogs/UpdateModal.tsx
components/main/Modal/content/editors/CounterAnimationEditorModal.tsx
components/main/Modal/content/editors/TabCssModal.tsx
components/main/Modal/content/editors/TabNameModal.tsx
components/main/Modal/content/editors/TabNoteSettingModal.tsx
components/main/Modal/content/managers/SoundTrimModal.tsx
components/main/Modal/content/pickers/ColorPicker.tsx
components/main/Modal/content/pickers/ColorSwatch.tsx
components/main/Modal/content/pickers/CommonListPickerPage.tsx
components/main/Modal/content/pickers/CounterAnimationPicker.tsx
components/main/Modal/content/pickers/FontPicker.tsx
components/main/Modal/content/pickers/GradientFormatControls.tsx
components/main/Modal/content/pickers/ImagePicker.tsx
components/main/Modal/content/pickers/Palette.tsx
components/main/Modal/content/pickers/ShadowPicker.tsx
components/main/Modal/content/pickers/SoundPicker.tsx
components/main/Modal/content/pickers/WebFontInputModal.tsx
components/main/Modal/content/pickers/colorPickerPrimitives.tsx
components/main/Modal/content/settings/CounterTabContent.tsx
components/main/Modal/content/settings/KeyTabContent.tsx
components/main/Modal/content/settings/NoteSetting.tsx
components/main/Modal/content/settings/NoteTabContent.tsx
components/main/Modal/content/settings/TabList.tsx
components/main/Settings.tsx
components/main/SettingsPanel/CssPanelContent.tsx
components/main/SettingsPanel/PluginsPanelContent.tsx
components/main/SettingsPanel/SettingsSidePanel.tsx
components/main/SettingsPanel/ShortcutsPanelContent.tsx
components/main/TitleBar.tsx
components/main/Tool/CanvasTool.tsx
components/main/Tool/SettingTool.tsx
components/main/Tool/TabTool.tsx
components/main/Tool/ToolBar.tsx
components/main/common/AddIconButton.tsx
components/main/common/Checkbox.tsx
components/main/common/Dropdown.tsx
components/main/common/EyeToggleIcon.tsx
components/main/common/IconSwap.tsx
components/main/common/KeySlotPicker.tsx
components/main/common/SearchField.tsx
components/main/common/SettingRow.tsx
components/main/common/TabSwitch.tsx
```

### 15.3 플러그인·전역·창 기반

```text
components/shared/PluginElement.tsx
components/shared/PluginElementsRenderer.tsx
components/shared/OverlayScene.tsx
editor/runtime/editGestureController.ts
editor/runtime/editorCoordinator.ts
editor/runtime/historyEditorFlushLock.ts
hooks/app/useAppBootstrap.ts
hooks/app/useBlockBrowserShortcuts.ts
hooks/ui/usePanelAnchoredPopupPosition.ts
hooks/useLenis.ts
hooks/useKeySlotCapture.ts
hooks/pickers/useGradientColorState.tsx
hooks/usePressAction.ts
hooks/usePressGatedSwap.ts
plugins/runtime/api/defineElement.ts
plugins/runtime/api/defineSettings.ts
plugins/runtime/displayElement/displayElementApi.ts
utils/grid/cursorUtils.ts
utils/plugin/pluginComponents.ts
utils/plugin/pluginDialogInteractions.ts
utils/plugin/pluginDropdownManager.ts
windows/main/App.tsx
windows/main/index.tsx
windows/overlay/App.tsx
windows/panel/App.tsx
windows/panel/PanelDialogHost.tsx
```

---

## 요약

최우선 파일럿은 `그림자 사용` 토글이다. 이후에는 모든 버튼에 낙관적 업데이트를 일괄 적용하지 않고, P0에는 프레임 coalescing과 렌더 격리, P1에는 즉시 피드백과 로컬 투영, P2에는 pending·single-flight·실패 재동기화, P3에는 공통 pressed·focus 품질을 적용한다. 공통 컴포넌트 변경은 각 유형의 실험 결과가 확보된 뒤 진행한다.
