# 코드 품질 리팩터링 결과와 후속 계획

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
