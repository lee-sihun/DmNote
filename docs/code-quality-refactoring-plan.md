# 코드 품질 리팩터링 계획

## 목표와 원칙

대형 파일을 단순히 줄 수만 나누지 않고, 변경 이유와 검증 경계가 같은 책임끼리 모듈화한다.

- UI 컴포넌트, 비동기 상태 훅, 순수 변환 모델을 분리한다.
- 기존 공개 import 경로와 wire/API 계약은 가능한 한 유지한다.
- 파일 이동 커밋과 동작 변경 커밋을 섞지 않는다.
- 각 단계에서 관련 테스트를 먼저 실행하고, 단계 종료 시 전체 게이트를 실행한다.
- 성능 수치는 실제 benchmark 실행 결과만 기록한다.

## 이번 브랜치에서 완료한 범위

기준 브랜치: `main`의 `af1bc19c`

| 영역 | 이전 | 현재 | 분리 결과 |
| --- | ---: | ---: | --- |
| `PropertiesPanel.tsx` | 3407줄 | 1549줄 | 선택 모델, navigation, commit handler, 이름 변경 세션, 플러그인 설정 제어, 패널 가시성 생명주기 분리 |
| `BatchSelectionPanel.tsx` | 2367줄 | 1277줄 | 공통 handler/header와 그래프·노브·플러그인 전용 패널 분리 |
| `SingleSelectionPanel.tsx` | 2061줄 | 674줄 | 그래프·노브 패널과 공통 표시 모델 분리 |
| `Settings.tsx` | 1423줄 | 1172줄 | 키음 출력 UI, 비동기 적용 큐 훅, 순수 view model 분리 |
| `Grid.tsx` | 2303줄 | 1269줄 | 네이티브 장면, 선택 overlay, 컨텍스트 메뉴·복제 ghost 모델 분리 |
| `useGridSelection.ts` | 1552줄 | 1036줄 | 드래그 생명주기, 이동·클립보드·붙여넣기 순수 모델 분리 |
| `PluginElement.tsx` | 1647줄 | 1421줄 | DOM 상호작용 어댑터와 레이아웃 모델 분리 |
| `editorCoordinator.ts` | 3001줄 | 2138줄 | 의미 연산 projection, 직렬 작업 큐, 커밋 재시도 정책 분리 |
| `elementOps.ts` | 2611줄 | 571줄 | document model, 공통 property, group, style, geometry 연산을 도메인 모듈로 분리하고 기존 facade export 유지 |
| `ColorPicker.tsx` | 1513줄 | 1036줄 | 입력 필드와 팔레트·history 제어 UI 분리 |
| `NumberInput.tsx` | 1440줄 | 1286줄 | draft·수식 parser 모델과 입력 chrome 분리 |
| `CounterAnimationEditorModal.tsx` | 1417줄 | 1343줄 | draft 병합·정규화 모델 분리 |
| `SoundTrimModal.tsx` | 1275줄 | 1011줄 | decode·waveform·trim 순수 모델 분리 |
| `store.rs` | 22978줄 | 2769줄 | 테스트, writer, 자산 참조, 사운드 복구, editor helper, plugin storage transaction 분리 |
| `editor_ops.rs` | 10154줄 | 2940줄 | 인라인 테스트 모듈 분리 |
| `migration.rs` | 6053줄 | 2238줄 | 인라인 테스트 모듈 분리 |
| `editor.rs` | 5777줄 | 2396줄 | 인라인 테스트 모듈 분리 |
| `app_state.rs` | 9314줄 | 4782줄 | 테스트, 창 geometry, 키보드 daemon 정책·제어, 종료 생명주기 분리 |
| `models/mod.rs` | 4169줄 | 3033줄 | 인라인 테스트 모듈 분리 |
| `preset/load.rs` | 3104줄 | 1180줄 | 테스트와 폰트·이미지·사운드 자산 복원 분리 |
| `keys/sound.rs` | 2189줄 | 806줄 | 테스트, 라이브러리 스캔·재조정, WAV 원자 교체 분리 |
| `audio/engine.rs` | 1712줄 | 911줄 | ASIO 경계, 출력 테스트, clip decode, 명령 스레드 분리 |

ASIO는 장치 I/O 경계와 순수 정책을 `audio/engine/asio.rs`로 분리했다. 버퍼 정규화, 드라이버 목록 정규화, 유효 출력 구성, 빌드 가용성, 오류 코드와 폴백 계약을 하드웨어 없이 검증한다. Windows release workflow도 `asio-backend` feature의 focused suite를 production build 전에 실행한다.

이번 분리는 IPC command/event 이름, store schema, editor wire 형식, 기존 `elementOps` 공개 export를 바꾸지 않았다. 이동한 Rust 창 좌표 코드는 가시성 키워드와 포맷 차이를 제외한 토큰 비교로 원본과 동일함을 확인했다.

## Grid 네이티브 요소 재사용성 감사

키·통계·그래프·노브의 편집 Grid 렌더러를 오버레이 렌더러와 대조했다.

- 키와 통계는 공용 `components/shared/Key.tsx`를 사용한다.
- 그래프는 공용 `components/shared/GraphPanel.tsx`을 사용한다.
- 노브의 링·이미지·인디케이터 DOM은 `components/shared/KnobFace.tsx`로 공용화했다.
- 네 종류의 scene 조립과 이벤트 생성은 `Grid/core/NativeGridElements.tsx`가 담당한다.
- `useGridElementInteraction`, `useStableHandlerSlots`, range·movement·clipboard·paste 모델이 포인터와 선택 정책을 공용화한다.
- 통계 표시명은 `utils/grid/statTypeLabel.ts`, mixed 값 집계는 `utils/core/mixedValue.ts`가 단일 소스다.

따라서 네 종류의 표시 표면을 다시 하나의 거대 조건부 컴포넌트로 합치지 않는다. 차이가 큰 graph 데이터 표현과 knob 회전 상태는 각각의 얇은 adapter에 남기고, 실제로 동일한 DOM·정책만 공유한다.

## 추가 조사 결과와 잔여 프론트엔드 우선순위

아래 줄 수는 이번 브랜치에서 `wc -l`로 측정한 값이다.

### 1. 상위 조립 컴포넌트

- `PropertiesPanel.tsx` — 1549줄: 선택 route별 조립과 preview/commit adapter가 남아 있다.
- `PluginElement.tsx` — 1421줄: 플러그인 content lifecycle과 runtime props projection이 다음 경계다.
- `Grid.tsx` — 1269줄: viewport·도구·장면 훅을 조립하는 상위 controller다.
- `BatchSelectionPanel.tsx` — 1277줄: mixed 4-type adapter와 탭 조립이 남아 있다.

이 파일들은 분리된 하위 모델을 호출하는 조립부 비중이 커졌다. 다음 분리는 props contract를 더 넓히는 방식이 아니라 route/controller별 characterization test를 먼저 추가한 뒤 수행한다.

### 2. 에디터 런타임 후속 경계

- `editor/runtime/editorCoordinator.ts` — 2138줄
  - canonical snapshot 동기화와 event publication을 다음 후보로 유지
  - 직렬 queue와 retry/conflict 정책은 이미 독립 모듈
- `editor/runtime/elementStyleOps.ts` — 952줄
  - runtime·image 속성 연산은 분리 완료
  - paint/shadow 속성군은 transition contract를 유지한 채 추가 분리 검토

검증: coordinator conflict·retry·gesture focused suite, element operation export 계약, 전체 Vitest.

### 3. 공통 입력과 편집기

- `ColorPicker.tsx` — 1036줄: gradient stop 편집기와 picker surface 조립
- `NumberInput.tsx` — 1286줄: scrub·keyboard 세션 controller
- `CounterAnimationEditorModal.tsx` — 1343줄: media preview와 form section
- `SoundTrimModal.tsx` — 1011줄: decode/export 작업과 waveform UI

입력 컴포넌트는 Escape 취소, preview/commit 경계, child window 동작을 회귀 테스트로 고정한 뒤 이동한다.

## 잔여 대형 백엔드 우선순위

- `state/app_state.rs` — 4782줄
  - 다음 경계는 frontend flush/history handshake와 panel/overlay window controller
  - keyboard daemon과 shutdown lifecycle은 분리 완료
- `state/store.rs` — 2769줄
  - 다음 경계는 editor/history transaction inherent impl
  - writer·asset·plugin storage 모듈은 모두 기존 `commit_locked`를 통해서만 저장
  - writer와 asset 모듈이 store lock을 우회하지 못하도록 현재 commit 경계를 유지
- `models/mod.rs` — 3033줄: editor 외 모델을 도메인 파일로 옮기는 후속 후보
- `state/editor_ops.rs` — 2940줄: 연산군별 validator/apply 경계가 후속 후보
- `commands/keys/keys.rs` — 2177줄: key mapping command와 import/export 변환 분리 후보
- `state/history.rs` — 2101줄: snapshot serializer와 admission/stack 정책 분리 후보

`preset/load.rs` 1180줄, `keys/sound.rs` 806줄, `audio/engine.rs` 911줄은 이번 단계의 목표 경계까지 분리했다.

store 자산 분리는 다음 불변식을 계속 지킨다.

- orphan 정리는 직접 삭제 대신 `trash/<세션>/` 30일 격리
- store 복구 세션은 sweep 생략
- 파일 자산 추가 시 참조 수집과 손상/크래시 복구 테스트 동시 추가
- `keys[mode][i]`와 `keyPositions[mode][i]`의 인덱스 결합 유지

## 단계별 검증 게이트

### 프론트엔드 단계

```bash
npx tsc --noEmit
npm run lint
npm run format
npm test -- --reporter=dot
npm run build
```

### Rust 단계

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
```

Tauri command를 추가하거나 삭제한 단계에서는 production build 후 `permissions/dmnote-allow-all.json` 갱신 여부도 확인한다.

## ASIO 검증 행렬

자동 테스트는 하드웨어와 무관한 정책을 모든 개발 플랫폼에서 실행한다. 실제 Windows/ASIO 경계는 다음 순서로 별도 확인한다.

1. Windows release workflow에서 `cargo test --features asio-backend audio::engine --lib` 자동 실행
2. `npm run tauri:build`로 ASIO feature production build 확인
3. 장치 목록 정렬·중복 제거와 저장된 분리 장치 표시 확인
4. 기본값, 0, 비표준 buffer frame 처리 확인
5. 장치 부재와 장치 open 실패의 서로 다른 오류 코드·기동 폴백 확인
6. 실제 드라이버에서 선택, 재시작 복원, 다른 ASIO 앱 점유 중 폴백을 수동 smoke test

macOS의 Windows cross-check는 MSVC C 런타임 헤더가 없는 환경에서 `ring` C 빌드 전에 중단되므로 Windows 네이티브 검증을 대체하지 않는다.

## 완료 조건

- 단계별 commit이 한 책임만 설명한다.
- 기존 공개 API와 저장 데이터 형식이 유지된다.
- focused suite와 전체 게이트가 모두 통과한다.
- 새 경고가 없고 Rust는 Clippy `-D warnings`를 통과한다.
- 남은 대형 파일은 이 문서의 다음 책임 경계로 이어지며, 줄 수만 줄이기 위한 임의 분할은 하지 않는다.
