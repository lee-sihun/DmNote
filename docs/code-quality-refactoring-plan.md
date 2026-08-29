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
| `PropertiesPanel.tsx` | 3407줄 | 1907줄 | 선택 모델, navigation 훅, 단일 선택 commit handler, 플러그인 설정 폼 분리 |
| `BatchSelectionPanel.tsx` | 2367줄 | 1277줄 | 공통 handler/header와 그래프·노브·플러그인 전용 패널 분리 |
| `SingleSelectionPanel.tsx` | 2061줄 | 674줄 | 그래프·노브 패널과 공통 표시 모델 분리 |
| `Settings.tsx` | 1423줄 | 1172줄 | 키음 출력 UI, 비동기 적용 큐 훅, 순수 view model 분리 |
| `store.rs` | 22978줄 | 3349줄 | 테스트, writer 영속화, 자산 참조, 사운드 복구·trash·sweep 분리 |
| `editor_ops.rs` | 10154줄 | 2940줄 | 인라인 테스트 모듈 분리 |
| `migration.rs` | 6053줄 | 2238줄 | 인라인 테스트 모듈 분리 |
| `editor.rs` | 5777줄 | 2396줄 | 인라인 테스트 모듈 분리 |
| `app_state.rs` | 9314줄 | 6600줄 | 인라인 테스트 모듈 분리 |
| `models/mod.rs` | 4169줄 | 3033줄 | 인라인 테스트 모듈 분리 |

ASIO는 장치 I/O 경계와 순수 정책을 `audio/engine/asio.rs`로 분리했다. 버퍼 정규화, 드라이버 목록 정규화, 유효 출력 구성, 빌드 가용성, 오류 코드와 폴백 계약을 하드웨어 없이 검증한다.

## 잔여 대형 프론트엔드 우선순위

아래 줄 수는 이번 브랜치에서 `wc -l`로 측정한 값이다.

### 1. 에디터 런타임

- `editor/runtime/editorCoordinator.ts` — 3001줄
  - mutation queue와 retry/conflict 처리
  - canonical snapshot 동기화와 event publication
  - gesture/operation 결과 projection
  - facade에는 public coordinator API와 조립만 유지
- `editor/runtime/elementOps.ts` — 2611줄
  - geometry, style, paint/shadow, media, batch operation별 모듈
  - 기존 `elementOps` import 경로는 barrel export로 유지

검증: coordinator/element operation 단위 테스트, conflict·retry·gesture focused suite, 전체 Vitest.

### 2. Grid 상호작용

- `Grid/core/Grid.tsx` — 2303줄
  - scene/layer 조립, 포인터·키보드 interaction, overlay UI 분리
  - 선택과 resize/drag hook은 facade에서 주입
- `hooks/Grid/useGridSelection.ts` — 1552줄
  - 순수 selection reducer/model과 DOM event adapter 분리
  - marquee, modifier, group/plugin selection을 각각 테스트
- `components/shared/PluginElement.tsx` — 1647줄
  - runtime props 해석, 측정/geometry, pointer/context menu bridge 분리

검증: Grid interaction focused suite, detached panel contract, plugin element isolation, 전체 Vitest.

### 3. 공통 입력과 편집기

- `ColorPicker.tsx` — 1513줄: 색상 상태 모델, gradient editor, palette/history UI 분리
- `NumberInput.tsx` — 1440줄: 수식 parser, scrub/keyboard session, 표시 컴포넌트 분리
- `CounterAnimationEditorModal.tsx` — 1417줄: draft reducer, media preview, form section 분리
- `SoundTrimModal.tsx` — 1275줄: waveform/selection model, decode/export 작업, UI 분리

입력 컴포넌트는 Escape 취소, preview/commit 경계, child window 동작을 회귀 테스트로 고정한 뒤 이동한다.

## 잔여 대형 백엔드 우선순위

- `state/app_state.rs` — 6600줄
  - bootstrap, window/event publication, keyboard runtime, shutdown coordinator 분리
  - test-only emitter/harness도 별도 test support 모듈로 이동
- `state/store.rs` — 3349줄
  - core transaction facade만 남기고 editor/history transaction과 plugin storage transaction 분리
  - writer와 asset 모듈이 store lock을 우회하지 못하도록 현재 commit 경계를 유지
- `commands/preset/load.rs` — 3104줄
  - 파일 decode/validation, migration, store transaction, event projection 분리
- `commands/keys/sound.rs` — 2189줄
  - scan/library, WAV processing, delete transaction command 분리

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
