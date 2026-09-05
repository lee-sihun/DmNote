# 코드 품질 리팩터링 결과와 후속 계획

> 현재 상태: 2026-09-05 추가 검토 결과를 확인한 사용자가 main 재병합을 승인했다. 아래 병합 취소·승인 대기 문구는 당시의 기록이다. 최초 완료 기록은 2026-08-31 기준이며, 검토 범위와 한계는 문서 끝의 「2026-09-05 병합 취소 후 추가 검토」를 따른다.

## 목표와 판정 원칙

리팩터링 기준 커밋은 `af1bc19c`이며 작업 브랜치는 `refactor/code-quality-modularization`이다. 최종 검증 기준선은 2.0.2 태그를 포함한 `origin/main`의 `4b4d6c22`다. 이번 작업의 최우선 조건은 **의도한 동작 변경이 없는 책임 분리**와 **작업 중 추가된 선행 변경의 완전한 수용**이다.

- UI, 상태·비동기 runtime, 순수 변환 모델을 변경 이유와 검증 경계에 맞춰 분리한다.
- 공개 import, Tauri command/event, 저장 schema, editor wire 형식을 유지한다.
- characterization test로 기존 호출 순서, 오류 전파, preview/commit, cleanup 계약을 먼저 고정한다.
- 테스트와 리팩터링을 단계별 한국어 conventional commit으로 남긴다.
- 줄 수만 줄이는 분리나 내부 상태를 넓은 props/API로 노출하는 분리는 하지 않는다.
- 기존 결함은 리팩터링에 섞어 고치지 않고 별도 후속 작업으로 기록한다.
- 완전 동일성은 자동 검증 범위에서 엄격히 확인하되, 실제 Windows ASIO 장치와 Tauri WebView 같은 플랫폼 경계는 수동 smoke test가 별도로 필요하다고 명시한다.

## 브랜치 결과 요약

본 리팩터링 이력은 코드·테스트 242개와 이 결과 문서 1개를 포함해 총 243개 단계별 커밋으로 구성했다. 중간 수정 커밋 11개는 원인을 도입한 커밋에 흡수했고, rewrite 전 트리는 `backup/refactor-code-quality-pre-fixup-20260830`에 보존했다. rewrite 전후 코드 tree hash는 모두 `73d4dfccf034bc9e7290ebf978b956e4082c110a`로 동일하다. 최종 `main` 통합 전 상태는 `backup/refactor-code-quality-pre-main-sync-20260831`에도 별도로 보존했다.

리팩터링 자체는 공개 API를 바꾸지 않는다. 최신 `main`이 추가한 탭 rename·reorder와 패널 native drag command를 포함해 현재 Tauri command는 `origin/main`과 동일한 150개이며, `src-tauri/permissions`, 생성 schema, `docs/content`에도 `origin/main` 대비 차이가 없다.

## 최신 main 통합 결과

기준 커밋 이후 `origin/main`에 추가된 33개 커밋을 마지막 검증 전에 병합했다. 물리 좌표 기반 패널 drag·overlay 복원, 탭 이름 변경·순서·bar count, pointer 입력 시 초기 focus 정책, gooey·motion 정책, 2.0.2 release 문서와 설정을 모두 유지했다.

- 충돌 13개 파일은 기존 façade를 유지하면서 최신 구현을 추출 모듈에 이식했다.
- 최신 `main`에서 추가된 Rust 함수와 테스트 이름을 전체 대조했고 누락은 0개였다.
- 새 좌표 알고리즘이 한 파일에 다시 집중되지 않도록 `window_geometry.rs` 505줄과 `window_geometry/overlay_placement.rs` 902줄로 분리했다.
- 새 패널 drag 구현도 `panel_drag.rs` 1006줄, Windows native 어댑터 1075줄, 테스트 407줄로 분리했다.
- 저장된 `tabOrder`·`barCount`·native overlay 좌표를 migration, history, preset, bootstrap에 함께 반영해 원자적 복원 계약을 유지했다.
- pointer 기반 popup/dropdown 진입은 focus 복원을 생략하고 keyboard 진입은 기존 focus 계약을 유지한다.

아래 줄 수는 기준 커밋과 현재 파일을 `wc -l`로 직접 측정한 값이다. 현재 값은 추출된 하위 모듈을 제외한 façade 또는 상위 조립 파일의 크기다.

### 프론트엔드

| 파일                              | 기준 | 현재 | 완료한 책임 경계                                                   |
| --------------------------------- | ---: | ---: | ------------------------------------------------------------------ |
| `PropertiesPanel.tsx`             | 3407 | 1199 | 선택 route, commit/runtime, plugin 설정, rename, layer action 분리 |
| `BatchSelectionPanel.tsx`         | 2367 |  668 | 타입별 섹션, 공통 graph/knob, key-like commit runtime 분리         |
| `SingleSelectionPanel.tsx`        | 2061 |  646 | 타입별 패널과 표시 모델 분리                                       |
| `Settings.tsx`                    | 1423 |  793 | 오디오 출력, 비동기 적용 큐, resize anchor controller 분리         |
| `Grid.tsx`                        | 2303 | 1269 | 네이티브 장면, 선택 overlay, context/ghost 모델 분리               |
| `useGridSelection.ts`             | 1552 |  494 | drag, movement, clipboard, paste, guide 모델 분리                  |
| `PluginElement.tsx`               | 1647 |  686 | DOM adapter, layout, snapshot·persistence runtime 분리             |
| `editorCoordinator.ts`            | 3001 | 1784 | queue, retry, semantic projection, violation 처리 분리             |
| `elementOps.ts`                   | 2611 |  571 | document/property/group/style/geometry 모듈과 façade 분리          |
| `ColorPicker.tsx`                 | 1513 |  611 | 입력, palette/history, surface runtime 분리                        |
| `NumberInput.tsx`                 | 1440 |  226 | draft/parser, scrub·keyboard session, chrome 분리                  |
| `CounterAnimationEditorModal.tsx` | 1417 |  371 | draft/model, curve canvas, preview session 분리                    |
| `SoundTrimModal.tsx`              | 1275 |  632 | decode, waveform, trim/export 모델 분리                            |

추가로 `scopeUserCss.ts`는 212줄 façade, `smartGuides.ts`는 22줄 façade, `Dropdown.tsx`는 127줄, `ListPopup.tsx`는 168줄, `useLayerActions.ts`는 13줄 façade가 됐다. CSS selector/registry, 팝업 dismissal, 사운드 선택기 cache/runtime, editor structural/violation, plugin snapshot/persistence, window geometry persistence를 각각 독립 경계로 분리했다.

### 백엔드

| 파일                      |  기준 | 현재 | 완료한 책임 경계                                                      |
| ------------------------- | ----: | ---: | --------------------------------------------------------------------- |
| `state/store.rs`          | 22978 |  829 | persistence, writer, recovery, asset, editor, plugin transaction 분리 |
| `state/editor_ops.rs`     | 10154 |   49 | 연산군·검증·structural operation과 테스트 분리                        |
| `state/migration.rs`      |  6053 |  275 | 복구·migration 도메인과 테스트 분리                                   |
| `state/editor.rs`         |  5777 |  176 | editor 상태·요청·테스트 분리                                          |
| `state/app_state.rs`      |  9314 | 1259 | 창 geometry, keyboard, shutdown, controller 경계 분리                 |
| `models/mod.rs`           |  4169 |  860 | editor와 도메인 모델 분리                                             |
| `commands/preset/load.rs` |  3104 |  975 | font/image/sound 복원과 테스트 분리                                   |
| `commands/keys/sound.rs`  |  2189 |  806 | library scan, repair, WAV 교체, 테스트 분리                           |
| `audio/engine.rs`         |  1788 |  911 | ASIO, decode, output test, command thread 분리                        |
| `state/history.rs`        |  2101 |  690 | snapshot/admission/transaction 경계 분리                              |
| `services/obs_bridge.rs`  |  1975 |  837 | 세션·메시지·forwarding 경계 분리                                      |
| `commands/keys/keys.rs`   |  2177 | 1007 | mapping, custom tab, import/export 경계 분리                           |

store 분리에서도 다음 불변식은 그대로 유지했다.

- orphan 자산은 직접 삭제하지 않고 `trash/<세션>/`에서 30일 격리
- store 복구가 발생한 세션은 asset sweep 생략
- 파일 자산 참조 수집과 손상·크래시 복구의 교차 검증 유지
- `keys[mode][i]`와 `keyPositions[mode][i]`의 인덱스 결합 유지
- writer와 추출 모듈이 기존 lock·commit 경계를 우회하지 않음

## Grid·프로퍼티 패널 재사용성 결과

키·통계·그래프·노브를 Grid와 overlay, single/batch panel 사이에서 다시 대조했고, 실제 DOM이나 정책이 같은 부분만 공용화했다.

- `KeyElementFace`: 키·통계의 placeholder, border, image/error, label, inside counter 표면
- `CounterPreviewBody` / `CounterPreviewLayer`: 키·통계 외부 카운터의 공통 body와 layer
- `GraphPanel`: Grid/overlay 그래프 표면
- `BatchGraphSettingsSection`: graph-only와 mixed 배치 설정
- `KnobFace`: 링, 이미지, indicator 표면
- `PanelRenameControl`: 단일·배치 이름 변경 header와 focus/select 순서
- `NativeGridElements`: 네이티브 요소 scene 조립과 adapter
- `nativeElementReferenceRegistry`: mount/unmount 시 ref 등록·삭제 계약
- `useGridElementInteraction`, stable handler slot, movement/clipboard/paste/smart-guide 모델: 포인터와 선택 정책

Graph 데이터 adapter, Knob 회전 상태, Key 활성 상태, Stat 정수 정규화처럼 의미가 다른 부분은 공용 컴포넌트의 조건문으로 합치지 않았다. 현재 `Grid.tsx`와 `PropertiesPanel.tsx`의 남은 대부분은 훅·route·props를 연결하는 상위 orchestration이다. 직접 테스트가 부족한 상태에서 더 분리하면 계약 면적과 회귀 위험이 커져 즉시 작업할 P0–P2 후보로 보지 않는다.

## ASIO 보강 결과

`audio/engine/asio.rs`에서 하드웨어 독립 정책과 장치 I/O 경계를 분리했다. 버퍼 프레임 정규화, 드라이버 목록 정렬·중복 제거, 출력 구성, build availability, 오류 코드와 fallback을 자동 검증한다.

- Rust ASIO focused suite: 18개 통과
- 프론트엔드 ASIO 설정 계약: 7개 통과
- `.github/workflows/ci-windows-asio.yml`: pull request와 수동 실행에서 fmt, feature check, Clippy `-D warnings`, focused test 실행
- Windows release workflow: production build 전에 ASIO focused test 실행

실제 ASIO 드라이버 열기, 다른 앱의 장치 점유, 재시작 후 장치 복원은 Windows 실제 장치 smoke test로 남는다. macOS의 Windows cross target은 로컬 MSVC CRT header가 없어 프로젝트 코드 전에 중단되므로 이를 대체하지 않는다.

## 검증 결과

단계별 focused suite와 독립 서브에이전트 감사를 반복했고, 최종 코드 트리에서 다음 결과를 확인했다.

- TypeScript type check 통과
- ESLint 오류·경고 0
- Prettier check 통과
- 전체 Vitest: 372개 파일, 3596개 테스트 통과, 18개 skip
- Vite production build 통과; 기존 대형 chunk 경고만 유지
- Rust 전체: 1044개 통과, 6개 ignored
- Rust fmt, all-target check, Clippy `-D warnings` 통과
- ASIO feature check·Clippy와 focused 18개 테스트 통과
- 최신 `main` 추가 Rust 함수·테스트 이름 대조에서 누락 0개
- 최종 병합 tree `git diff --check` 통과
- Rust module 175개와 literal `include_str!` / `include_bytes!` 경로 확인

동작 동일성 판정에는 AST/토큰 정규화 비교, 공개 반환 객체와 hook/ref 선언 순서 비교, close/await/RAF/focus 순서 테스트, 오류 전파·rollback·preview/commit characterization을 함께 사용했다. 마지막 독립 감사와 최신 `main` 통합 후 그래프·파일 크기 재감사에서는 즉시 안전하고 고가치인 추가 P0–P2 회귀·분리 후보를 발견하지 못했다. 복잡도가 높은 native window·keyboard runtime은 실제 플랫폼 harness 없이 더 분리하면 호출 순서 회귀 위험이 커 별도 고위험 경계로 유지한다.

## 의도적으로 보존한 기존 결함

아래 항목은 이번 리팩터링에서 발견했지만 동작 변경을 섞지 않기 위해 고치지 않았다. 별도 bug-fix 브랜치에서 먼저 실패 테스트와 기대 동작을 합의해야 한다.

| 영역                         | 기존 동작                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `PluginElement` subscription | 비동기 key/rawKey 구독이 unmount 뒤 완료되면 cleanup 누락 가능                       |
| `PluginElement` state        | 같은 tick의 shallow `setState`가 서로 다른 leaf 하나를 잃을 수 있음                  |
| `NativeGridElements`         | type+index 기반 action이 reorder/delete 뒤 다른 요소를 가리키거나 실패할 수 있음     |
| main dialog / color picker   | 기존 timer·ref 재진입 경계가 완전히 정산되지 않음                                    |
| `SoundTrimModal`             | 열린 상태에서 직접 unmount하면 playback/pointer cleanup 계약이 없음                  |
| counter animation preview    | Escape/window blur 및 복수 preview press의 첫 release 동작이 기존대로 유지됨         |
| `useLayerDnD`                | active drag 중 unmount 시 document listener, scheduler, body cursor 정산 계약이 없음 |

## 후속 작업 분류

### 선행 harness가 필요한 고위험 경계

- `WebGLTracksOGL` / `noteBuffer`: 실제 GPU resource 수명과 성능 회귀 harness
- `useNoteSystem`: fake clock 기반 timing·pool·subscription continuity 검증
- `editorCoordinator`: queue/rebase의 결정적 trace와 failure injection
- editor transition/migration recovery: property/fuzz와 오류 우선순위 검증
- OBS/Tauri window runtime: 실제 창·WebSocket·종료 timing 통합 테스트
- ASIO/audio와 Windows keyboard: 실제 Windows driver/device smoke test
- 위 표의 기존 결함: 기대 동작 결정 후 별도 수정

### 낮은 우선순위

- `listPopupMenuRows.tsx`, `registryRewrite.ts` 등은 더 나눌 수 있지만 내부 pointer/registry 상태를 새 API로 노출하는 비용이 더 큼
- `Grid.tsx`, `PropertiesPanel.tsx`의 추가 분리는 stable ID와 직접 orchestration test를 먼저 갖춘 뒤 재평가
- Vitest의 기존 React `act(...)`, mock DOM prop, CSS parser stderr는 실패와 구분되지만 회귀 로그의 신호 대 잡음비를 낮추므로 별도 테스트 위생 작업으로 정리
- cohesive wire schema와 단순 route table은 파일 크기만으로 분할하지 않음

## 재현 가능한 최종 게이트

```bash
npx tsc --noEmit
npm run lint
npm run format:check
npm test -- --reporter=dot
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets -- -D warnings
cargo test --all-targets --quiet
cargo check --all-targets --features asio-backend
cargo clippy --all-targets --features asio-backend -- -D warnings
cargo test --lib --features asio-backend audio::engine
```

## 완료 판정

- 공개 API·저장 형식·command/event 집합에 의도한 변경 없음
- 2.0.2 기준 최신 `origin/main` 선행 변경과 command 150개를 누락 없이 통합
- 단계별 커밋과 focused/전체 검증 통과
- rewrite 전후 tree 동일성 확인 및 복구 branch 보존
- Grid 핵심 표면과 패널 반복 UI 공용화 완료
- 대형 프론트엔드·백엔드 파일의 고가치 책임 경계 분리 완료
- 마지막 독립 감사에서 즉시 진행할 추가 P0–P2 후보 없음
- 실제 장치·GPU·native window가 필요한 항목과 기존 결함은 검증 조건을 붙여 후속 범위로 보존

## 2026-09-05 병합 재검토

### 검토 기준과 최신 main 통합

- 검토한 PR #154 원본: `5c59f104668d211a456974c20e8eda3531618a56`
- 최신 main: `926454969409dab92de1144d6b7f7309871feb57`
- PR이 마지막으로 통합한 main `4b4d6c22` 이후 14개 커밋을 추가 통합했다. 텍스트 충돌은 없었다.
- macOS 접근성 권한 자동 요청(`380a8f04`), macOS 설치 안내·기여자 표·릴리즈 노트 수정, Dependabot PR #156·#157·#158의 lockfile 변경을 보존했다.
- 원래 분기점 `af1bc19c` 이후 main 변경 파일 114개 중 94개는 통합 결과와 바이트 단위로 동일했다. 나머지 20개는 리팩터링으로 분리된 모듈과 대조했다.

### 발견하고 수정한 병합 누락

`f3cdd7e0`은 탭 컬렉션 변경 시 `tabOrder`를 정규화하고 `barCount`를 유효 범위로 제한하는 계약을 도입했다. 이전 통합 커밋 `b85bfa77`에서는 필드와 함수 이름을 가져왔지만 아래 세 구현의 일부 동작을 누락했다.

1. `store/legacy_transactions.rs`의 `commit_legacy_editor_transaction_inner`: `CustomTabs`·`PresetFull` 트랜잭션 updater 실행 후 탭 순서와 표시 개수를 정규화하는 처리가 빠졌다. updater가 탭 컬렉션만 변경하면 불완전한 순서가 히스토리에 남아 undo/redo가 `tab order is incomplete or contains invalid entries`로 실패할 수 있었다.
2. `store/history_restore.rs`의 `commit_custom_tabs_history_locked`와 `commit_preset_full_history_locked`: `normalize_bar_count` 대신 스냅샷 값을 직접 대입했다. 범위를 벗어난 과거 값이 복원되는 것을 막던 main의 방어 처리가 사라졌다.
3. 기존 테스트가 탭 순서를 직접 보정하도록 변경됐고, 프리셋 undo/redo 테스트의 순서·표시 개수 변경 및 assertion도 빠졌다. 이 때문에 원본 PR의 전체 테스트가 통과해도 위 누락을 발견하지 못했다.

세 구현은 기존 모듈 경계를 유지하면서 최신 main의 처리와 동일하게 복원했다. main의 테스트 6개도 원래 계약으로 되돌렸다. 그중 탭 테스트 5개는 수정 전 실제 실패를 확인했으며, 프리셋 테스트는 사라진 순서·표시 개수 검증을 복원했다.

추가한 회귀 테스트 2개는 탭·프리셋의 각 트랜잭션 진입점에서 중복·미등록·누락된 탭 순서, 표시 개수 0과 255, undo/redo 및 저장 파일 반영을 검사한다. 수정 전에는 불완전한 순서가 그대로 저장되고 표시 개수 0이 그대로 복원되는 실패를 확인했다.

### 추가 대조 범위

- Rust 함수 본문과 struct·enum·type·const·static 선언 3,920개를 구문 트리로 수집해 이동 전후 토큰을 대조했다. 주석·가시성을 제외한 3,847개가 동일했고, 나머지는 함수 추출, 모듈 경로, 테스트 fixture 경로, 포맷 차이와 ASIO 정책 주입점 등을 확인했다. 이름이 바뀐 ASIO 함수·상수와 OBS envelope 변환은 새 구현으로 추적했다. 이 비교는 전체 런타임 동작의 수학적 동일성 증명은 아니다.
- main에서 추가된 프론트엔드 callback은 구문 트리 비교와 변경 내역 검토를 함께 사용했다. 탭 메타데이터 generation guard, counter resync 순서, pointer focus 예외, pending/active popup drag의 닫힘 구분, overlay 메뉴의 탭 순서를 확인했다.
- Windows panel drag와 overlay 배치의 main 대비 차이는 모듈 경로·가시성·Clippy 보정이었다. 좌표 단위, native position 신뢰 판정, terminal outcome 로직의 추가 누락은 발견하지 못했다.
- 자산 참조 수집, 30일 trash 격리, 복구 세션 sweep 생략, 인덱스 결합 배열 복구, editor/plugin 트랜잭션의 저장·rollback 경계를 대조했다.
- Tauri command 150개의 이름과 등록 순서가 main과 동일하다. permissions, 생성 schema, 공개 타입과 API 계약, `docs/content`의 계약 변경은 없다. OBS allowlist와 이벤트 forwarding도 유지된다.

### 통합 결과의 로컬 검증

- 최신 lockfile로 `npm ci --no-audit --no-fund` 실행
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run build` 통과
- `npm run format` 실행 후 프론트엔드 변경 없음 확인
- Vitest: 372개 파일 통과, 18개 파일 skip; 테스트 3,596개 통과, 18개 skip
- Rust: `cargo test --all-targets --locked --quiet`에서 1,046개 통과, 6개 ignored
- `cargo check --all-targets --locked`, `cargo clippy --all-targets --locked -- -D warnings` 통과
- `asio-backend` feature의 all-target check·Clippy 통과, 오디오 정책 테스트 18개 통과
- `cargo fmt --all` 실행 및 `cargo fmt --all -- --check`, `git diff --check` 통과

Vitest의 기존 React `act(...)`·mock DOM prop·CSS parser stderr와 Vite의 700 kB 초과 chunk 경고는 남아 있다. ESLint는 종료 코드 0이었지만 `SoundTrimModal.tsx`의 ResizeObserver effect에 `redrawWaveformStatic` 의존성 경고 1개가 있었다. 이 로그를 경고 0으로 해석하면 안 된다. Windows ASIO CI는 보정 커밋 `f333fb1f`에서 [run 33930837019](https://github.com/DmNote-App/DmNote/actions/runs/33930837019)의 성공을 확인했다. 실제 ASIO 장치, Windows 혼합 DPI 창 조작, Tauri WebView timing과 GPU 수명에 대한 실기 검증 한계는 유지한다.

## 2026-09-05 병합 취소 후 추가 검토

### main 복구와 검토 기준

사용자 요청에 따라 병합 커밋 `f6e351d1`을 `git revert -m 1` 방식으로 되돌린 `d2b9f9ab07d87a661e2a313239bee5c81b5d59a6`을 main에 반영했다. 기존 커밋 기록은 유지했다. main의 tree `9d13c039ba6fe60dc117b760375d385a1d103a6c`가 병합 전 `92645496`의 tree와 같음을 확인했다.

별도 브랜치 `review/pr154-recheck-20260905`에서 취소 커밋만 다시 되돌린 `da2c8f42`를 만들었다. 이 후보의 tree는 첫 검토 보정까지 포함한 `f333fb1f`와 같다. 따라서 탭 정규화 수정도 검토 후보에만 있으며, main에는 PR 변경 전체가 빠져 있다. 이후 추가 변경은 아래 계약 테스트와 이 검토 기록이다. 재병합은 사용자의 명시적 승인 전까지 보류한다.

첫 검토의 중심은 분기 후 main 변경 보존과 후보의 자동 테스트였다. 그것만으로 대규모 리팩터링의 모든 실행 경로를 확인했다고 판단할 수 없으므로, 이번에는 원본 main과 후보를 별도 worktree에 두고 테스트 기대값과 mock 변경까지 대조했다.

### 같은 기존 테스트를 양쪽 구현에 적용

- `92645496`의 프론트엔드 테스트 335개 파일을 추출했다. 원본 main에서는 3,150개 통과, 18개 skip이었다.
- 같은 테스트 파일을 후보에 복사해 실행했다. 처음에는 3,141개 통과, 6개 실패, 18개 skip이었으며, 이동된 `stableHandlerSlots` import 때문에 테스트 3개를 수집하지 못했다.
- 차이는 4개 파일의 경로 의존성이었다. `elementShadowContract`의 Knob 표면 파일 경로, `statItems`의 Rust enum 파일 경로, `stableHandlerSlots` import, `PropertiesPanel.detachedContracts`의 `useBatchHandlers` mock import가 이동했다. PR의 해당 테스트 diff를 확인했고, 기대값·assertion·입력을 바꾸지 않고 경로만 보정했다. 관련 50개 테스트가 모두 통과해 기존 3,150개 테스트의 계약을 후보에서도 확인했다.
- PR이 추가한 공개 컴포넌트 테스트도 원본 main에 적용했다. 이 과정에서 새로 추출한 `soundTrimModel`과 `pluginDomInteractions`를 mock하는 일부 테스트는 원본의 인라인 구현에 적용되지 않음을 확인했다. 이를 제품 회귀나 검증 성공으로 계산하지 않고, 아래 브라우저 API·실제 DOM 테스트로 보완했다.

### 추가한 비교 계약 6개

아래 테스트는 원본 main과 후보에 같은 파일을 적용해 모두 통과했다. 새 내부 헬퍼를 mock하지 않고 공개 진입점과 브라우저·전송 API 경계를 검사한다.

1. `editorCoordinator.test.ts`: 외부 편집 이벤트를 0·1·4 microtask 뒤에 전달하는 3개 경우. 의미 기반 커밋의 revision conflict, 새 mutation ID로 rebase, I/O 결과 미상의 동일 envelope 재전송, 뒤에서 대기하는 플러그인 커밋을 연달아 실행한다. 외부 geometry와 플러그인 key 값의 동시 보존, `onEnrolled` 1회, flush 후 추가 저장 없음, in-flight 해제를 검사한다.
2. `SoundTrimModal.browserApi.test.tsx`: 실제 컴포넌트에서 Web Audio 디코딩 context 해제, 재생·일시정지·재개·닫힘과 볼륨 상한을 검사한다. 별도 테스트에서는 RAF 대기 중인 트림 입력을 pointerup으로 확정한 후 실제 WAV 인코더를 거쳐 저장 API에 전달한다. 원본 바이트, 트림 비율, WAV sample rate·data 길이·PCM sample과 저장 후 입력 초기화를 검사한다.
3. `PluginElement.runtime.test.tsx`: 실제 일반 DOM과 shadow DOM에서 같은 플러그인 클릭을 전달한다. scoped 전환 후 중복 실행이 없고 unmount 후 보관한 DOM 노드에서 클릭해도 호출되지 않는지 검사한다.

### React Compiler와 소스 대조

일반 `vitest.config.ts`에는 React Compiler가 없었다. 제품 `vite.config.ts`와 같은 `babel-plugin-react-compiler` 설정과 signals 제외 조건을 임시 Vitest 설정에 적용했다. 테스트 파일 자체는 변환에서 제외하고, 동일한 공개 UI 테스트 94개를 원본과 후보에서 각각 실행해 모두 통과했다. NumberInput, 분리 패널, PluginElement, 요소 DOM 표면, 오버레이 App, 사운드 트림을 포함한다. 이는 jsdom 검증이며 실제 WebView 렌더링 측정을 대신하지 않는다.

TypeScript 구문 트리로 변경된 원본 파일의 함수·callback 3,266개를 수집했다. 출력된 함수 본문 2,614개가 후보의 함수 본문과 같았고, 652개는 차이가 있었다. 본문이 같아도 매개변수가 다른 50개를 별도로 추출했다. 이는 이동 후보를 찾는 인덱스이며, 같은 이름이나 본문만으로 closure·import binding이 같다고 판정하지 않았다. 아래 주요 연결부는 호출 인자, ref 소유자, effect 순서와 기존 계약 테스트를 함께 확인했다.

| 영역 | 확인한 연결부와 근거 |
| --- | --- |
| Grid·선택·패널 | `NativeGridElements`의 stable ID/인덱스 전달, 참조 노드 등록, Shift 범위 선택 입력, mixed drag 세션 시작·종료, batch 선택 집계와 정규 문서의 분리. 기존 패널·드래그·선택 테스트 및 컴포넌트 prop 대조 |
| editor 저장 | `SerialTaskQueue`의 선행 실패 격리와 wait, semantic commit의 상태 갱신·재시도 횟수·mutation ID·canonical 복구, property projection. 원본 coordinator 테스트와 추가 복합 오류 테스트 |
| 플러그인 | 설정 form 값 변환·visibility callback 인자, modal handler 정리, overlay onMount·key/rawKey/locale/OBS resync 구독, 측정 ref와 앵커/줌 처리. 기존 API 테스트와 실제 DOM 전환 테스트 |
| 사운드·팝업·입력 | 오디오 context/source/RAF 정리, 원본 보존·WAV 저장, 입력 미리보기/commit, 닫힘·재개입 계약. 기존 main 테스트, 브라우저 API 테스트, Compiler 적용 UI 테스트 |
| Rust editor·store | 함수 본문 외 signature·attribute 대조, 75개 property patch arm의 처리 보존, 탭·프리셋 history 정규화, 자산 quarantine·복구와 rollback. 기존 실패 재현 및 Rust 계약 테스트의 assertion 변경 대조 |
| OBS·네이티브 창 | WebSocket seq/ack/snapshot/RPC 처리 순서, allowlist·media 토큰/경로 검증, Windows 절대 crate 경로와 `unsafe extern "system"` signature, macOS/Windows/fallback 모듈의 cfg 조건 보존 |

Rust 선언의 signature/attribute 대조에서 나타난 production 차이는 trailing comma, `RpcSender` 타입 별칭, `::windows` 경로, 플랫폼 cfg의 상위 모듈 이동이었다. `overlay_hit.rs`의 `#[cfg]`와 `#[path]`까지 추적했다. 테스트 변경은 fixture 경로·포맷 차이가 대부분이었고, OBS 오류 우선순위와 사운드 복구 오류 문자열은 assertion을 강화한 변경이었다. 첫 검토에서 복원한 탭 테스트 외에 추가로 약화되거나 빠진 기존 Rust assertion은 발견하지 못했다.

### 판정과 남은 한계

이번 추가 검토 범위에서는 첫 검토에서 수정한 탭 정규화 누락 외에 새로운 병합 차단 회귀를 재현하지 못했다. 제품 코드는 추가로 변경하지 않았다. 위의 독립된 비교 검증과 새 계약 테스트를 근거로 삼으며, 전체 함수의 모든 입력과 모든 비동기 스케줄이 동일하다는 증명으로 해석하지 않는다.

추가 테스트 반영 후 `npx tsc --noEmit` 통과, ESLint 오류 0·경고 1개, 전체 Vitest 3,602개 통과·18개 skip을 확인했다. `npm run format` 적용 후 변경 범위가 테스트에 한정됨을 확인하고 `format:check`·`git diff --check`를 통과했다. Rust와 제품 빌드 코드는 `f333fb1f` 이후 변경하지 않았으므로 앞서 통과한 Rust 1,046개 테스트, check/Clippy/fmt, ASIO 및 Windows CI, Vite build 결과를 같은 코드에 대한 근거로 유지한다. 이를 이번 검토에서 다시 실행했다고 계산하지 않는다.

- `SoundTrimModal.tsx`의 ResizeObserver effect에 ESLint 의존성 경고 1개가 남아 있다. `redrawWaveformStatic`은 현재 값 ref만 읽는 함수여서 오래된 값 캡처에 따른 회귀는 확인되지 않았다. 경고를 없애려고 의존성을 늘려 observer 재등록 빈도를 바꾸지는 않았다.
- 실제 Windows ASIO 장치 열기·점유·재시작 복원, 혼합 DPI 드래그, Tauri WebView·GPU 자원 수명은 실기 검증이 남아 있다. 기존 Windows CI 성공은 fmt/컴파일/Clippy/하드웨어 독립 오디오 테스트의 근거다.
- 문서의 「의도적으로 보존한 기존 결함」은 여전히 별도 범위다. 이번 비교에서 통과했다는 이유로 해당 결함이 해결됐다고 판단하지 않는다.

추가 검토 로그와 원본/후보 비교 산출물은 로컬 `/tmp/dmnote-pr154-recheck/`, 첫 검토의 Rust·main 보존 비교 및 Windows CI 로그는 `/tmp/dmnote-pr154-review/`에 보관했다. 지속 보존되는 근거는 커밋한 테스트와 이 문서이며, 임시 파일은 별도 아카이브 없이는 장기 보존되지 않는다.

### 재병합 승인

2026-09-05 사용자가 재검토 후 main 병합을 명시적으로 승인했다. 원격을 다시 조회해 main이 `d2b9f9ab`, 검증한 후보가 `17198717`이고 main에 추가 변경이 없음을 확인했다. 탭 정규화 보정과 추가 계약 테스트를 포함한 후보를 통합하며, 위 승인 대기 조건은 해소됐다. 이 상태 기록 외에 검증 이후 제품 코드와 테스트 변경은 없다.

## 2026-09-05 런타임 안전성·폴더 구조·strict 검사 후속 작업

작업 브랜치: `refactor/runtime-safety-and-structure`. 앞선 리팩터링·병합 기록과 후속 계획은 유지하며, 이번 변경은 다음과 같다. 코드사이닝은 운영 인증 심사 완료까지 보류한 사용자 결정에 따라 변경하지 않았다.

- OBS 미디어 percent decoder의 UTF-8 문자열 슬라이싱을 바이트 해석으로 변경했다. 잘못된 Unicode·불완전한 escape 입력과 인증된 media 요청의 400 응답을 테스트한다.
- 웹폰트 모달 테스트는 가상 타이머와 명시적 Font Loading API 모킹을 사용한다. 디바운스 후 로드와 닫기 시 취소·스타일 정리를 검증한다.
- `editor/runtime`의 직속 파일 63개를 `coordinator`, `projection`, `operations`, `intent`, `geometry`, `gesture`, `lifecycle`로 묶었다. 편집 조정기에서 계약 타입, 공통 rebase 계산·의미 연산 결과 검증, pending gesture 보존 정책을 분리했다.
- `PropertiesPanel`의 직속 파일은 50개에서 3개로 줄였다. `controls`, `navigation`, `selection`, `plugin`을 추가하고 batch 전용 모듈은 기존 `batch`에 배치했다. 테스트와 관련 스크립트 경로도 함께 이동했다.
- Rust `state`의 자산 유틸리티는 `assets`, 창·플랫폼 연동은 `window`로 옮겼다. 직속 파일은 21개에서 13개로 줄었고, 패널 드래그 상태 전이는 `window/panel_drag/machine.rs`로 분리했다. 저장·복구 트랜잭션의 소유권과 command/event·permissions는 유지했다.
- `tsconfig.strict.json`에서 공유 타입, 편집 모델, 커밋 엔진, 의미 연산 투영, 순수 배치 계획과 import 의존성을 검사한다. `npm run type-check`에 연결했으므로 기존 CI 품질 검사에도 포함된다. 전체 UI·테스트 fixture의 strict 전환은 아직 완료하지 않았으며, 해당 영역 정리 시 검사 범위를 확장한다.

검증: 프론트 전체 테스트 3,604개 통과·18개 제외, Rust 테스트 1,048개 통과·6개 제외, CI 정책 테스트 15개 통과. TypeScript 일반·strict 검사, Vite build, Rust check·Clippy(`--all-targets --locked -- -D warnings`) 통과. ESLint는 기존 `SoundTrimModal`의 훅 의존성 경고 1건을 유지한다. 빌드의 대형 청크 경고도 남아 있다. Windows 실제 빌드·WebView·ASIO 장치 검증은 이번 macOS 로컬 검증에 포함하지 않았다.
