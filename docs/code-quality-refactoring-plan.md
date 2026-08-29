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
| `editorCoordinator.ts` | 3001줄 | 2156줄 | 의미 연산의 document projection과 영향 필드 계산을 `semanticOpsProjection.ts`로 분리 |
| `elementOps.ts` | 2611줄 | 571줄 | document model, 공통 property, group, style, geometry 연산을 도메인 모듈로 분리하고 기존 facade export 유지 |
| `store.rs` | 22978줄 | 3349줄 | 테스트, writer 영속화, 자산 참조, 사운드 복구·trash·sweep 분리 |
| `editor_ops.rs` | 10154줄 | 2940줄 | 인라인 테스트 모듈 분리 |
| `migration.rs` | 6053줄 | 2238줄 | 인라인 테스트 모듈 분리 |
| `editor.rs` | 5777줄 | 2396줄 | 인라인 테스트 모듈 분리 |
| `app_state.rs` | 9314줄 | 5650줄 | 인라인 테스트와 창 좌표·모니터 배치·패널 bounds 영속화 모듈 분리 |
| `models/mod.rs` | 4169줄 | 3033줄 | 인라인 테스트 모듈 분리 |

ASIO는 장치 I/O 경계와 순수 정책을 `audio/engine/asio.rs`로 분리했다. 버퍼 정규화, 드라이버 목록 정규화, 유효 출력 구성, 빌드 가용성, 오류 코드와 폴백 계약을 하드웨어 없이 검증한다.

이번 분리는 IPC command/event 이름, store schema, editor wire 형식, 기존 `elementOps` 공개 export를 바꾸지 않았다. 이동한 Rust 창 좌표 코드는 가시성 키워드와 포맷 차이를 제외한 토큰 비교로 원본과 동일함을 확인했다.

## 추가 조사 결과와 잔여 프론트엔드 우선순위

아래 줄 수는 이번 브랜치에서 `wc -l`로 측정한 값이다.

### 1. Grid 상호작용

- `Grid/core/Grid.tsx` — 2303줄
  - scene/layer 조립, 포인터·키보드 interaction, overlay UI가 한 렌더 경계에 결합
  - 선택과 resize/drag hook은 facade에서 주입
- `hooks/Grid/useGridSelection.ts` — 1552줄
  - 순수 selection reducer/model과 DOM event adapter 분리 후보
  - marquee, modifier, group/plugin selection을 각각 테스트
- `components/shared/PluginElement.tsx` — 1647줄
  - runtime props 해석, 측정/geometry, pointer/context menu bridge 분리 후보

이 영역은 호출 fan-out과 interaction 분기가 가장 높다. 현재 회귀 테스트가 DOM pointer capture, 좌표계, 플러그인 격리를 모두 독립적으로 고정하지 못하므로 이번 단계에서는 직접 이동하지 않았다. 먼저 characterization test를 보강한 뒤 scene 조립 → overlay UI → event adapter 순서로 분리한다.

검증: Grid interaction focused suite, detached panel contract, plugin element isolation, 전체 Vitest.

### 2. 에디터 런타임 후속 경계

- `editor/runtime/editorCoordinator.ts` — 2156줄
  - mutation queue와 retry/conflict 처리
  - canonical snapshot 동기화와 event publication
  - facade에는 public coordinator API와 조립만 유지
- `editor/runtime/elementStyleOps.ts` — 1231줄
  - 현재는 style/paint/shadow/media 속성 연산이라는 한 도메인으로 모였음
  - 추가 분리는 속성군별 transition 테스트를 먼저 고정한 뒤 검토

검증: coordinator conflict·retry·gesture focused suite, element operation export 계약, 전체 Vitest.

### 3. 공통 입력과 편집기

- `ColorPicker.tsx` — 1513줄: 색상 상태 모델, gradient editor, palette/history UI 분리
- `NumberInput.tsx` — 1440줄: 수식 parser, scrub/keyboard session, 표시 컴포넌트 분리
- `CounterAnimationEditorModal.tsx` — 1417줄: draft reducer, media preview, form section 분리
- `SoundTrimModal.tsx` — 1275줄: waveform/selection model, decode/export 작업, UI 분리

입력 컴포넌트는 Escape 취소, preview/commit 경계, child window 동작을 회귀 테스트로 고정한 뒤 이동한다.

## 잔여 대형 백엔드 우선순위

- `state/app_state.rs` — 5650줄
  - 다음 경계는 frontend flush/lifecycle handshake, keyboard runtime, shutdown coordinator
  - 창 좌표와 패널 bounds 제어는 `state/app_state/window_geometry.rs` 989줄로 분리 완료
  - test-only emitter/harness도 별도 test support 모듈로 이동
- `state/store.rs` — 3349줄
  - core transaction facade만 남기고 editor/history transaction과 plugin storage transaction 분리
  - writer와 asset 모듈이 store lock을 우회하지 못하도록 현재 commit 경계를 유지
- `commands/preset/load.rs` — 3104줄
  - 파일 decode/validation, migration, store transaction, event projection 분리
- `commands/keys/sound.rs` — 2189줄
  - scan/library, WAV processing, delete transaction command 분리
- `audio/engine.rs` — 1712줄
  - 실시간 `audio_thread`의 장치 전환·오류 복구 분기가 결합되어 있음
  - timing 동작을 바꾸지 않도록 상태 전이 characterization test 이후 제어 정책만 분리

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

1. Windows에서 `cargo test --features asio-backend audio::engine` 실행
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
