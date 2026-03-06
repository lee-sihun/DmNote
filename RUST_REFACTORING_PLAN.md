# Rust 백엔드 리팩토링 계획

## 현재 상태 분석

### 코드베이스 규모
- **총 35개 파일**, 약 14,629줄
- `commands/` 20개 파일, `services/` 3개 파일
- 나머지 12개 파일이 `src/` 루트에 혼재

### 현재 폴더 구조
```
src-tauri/src/
├── commands/           # 20개 파일 (Tauri 커맨드)
├── services/           # 3개 파일 (css_watcher, settings)
├── app_state.rs        # 1,879줄 - 앱 상태 관리
├── cursor.rs           # 452줄 - 커서 설정 (macOS)
├── defaults.rs         # 24줄 - 기본값 상수
├── ipc.rs              # 133줄 - IPC 이벤트 정의
├── key_sound.rs        # 946줄 - 키 사운드 엔진
├── keyboard.rs         # 69줄 - 키보드 유틸리티
├── keyboard_daemon.rs  # 1,013줄 - 키보드 후킹 데몬
├── keyboard_labels.rs  # 501줄 - 키 레이블 매핑 (Windows)
├── lib.rs              # 91줄
├── main.rs             # 814줄 - 진입점
├── models.rs           # 1,814줄 - 데이터 모델
└── store.rs            # 1,079줄 - 영속 스토리지
```

### 의존성 맵 (파일 이동 시 영향 범위)

| 파일 | 직접 참조하는 곳 | 내부 import | 이동 위험도 |
|------|-----------------|-------------|-------------|
| `app_state.rs` | commands 11개+, services 2개 | key_sound, keyboard, models, services, store | **높음** |
| `models.rs` | 6개 파일 직접, 간접 20개+ | 없음 (순수 데이터) | **높음** |
| `store.rs` | services 2개, app_state | models, defaults | **중-높** |
| `keyboard_daemon.rs` | main.rs만 | ipc, models, keyboard_labels | **중간** |
| `key_sound.rs` | app_state, commands/key_sound | 없음 (외부 crate만) | **중간** |
| `keyboard.rs` | app_state만 | models | **중간** |
| `keyboard_labels.rs` | keyboard_daemon만 | 없음 | **낮음** |
| `cursor.rs` | commands/system만 | 없음 | **낮음** |
| `ipc.rs` | keyboard_daemon, main | 없음 | **낮음** |
| `defaults.rs` | store, keyboard | models | **낮음** |

### 발견된 문제점

| # | 문제 | 심각도 | 상세 |
|---|------|--------|------|
| 1 | 커맨드 선언 방식 불일치 | 높음 | 69개는 `permission = "dmnote-allow-all"`, 7개는 bare `#[tauri::command]` |
| 2 | 불필요한 async | 중간 | plugin_storage.rs, bridge.rs에서 await 없이 async 사용 |
| 3 | 루트에 파일 과다 | 중간 | src/ 루트에 12개 파일이 모듈 분류 없이 혼재 |
| 4 | models.rs 비대 | 중간 | 1,814줄, 모든 모델이 한 파일에 집중 |
| 5 | app_state.rs 비대 | 중간 | 1,879줄, 상태 관리 + 초기화 + 매니저 로직 혼재 |
| 6 | 에러 핸들링 | 낮음 | 모든 커맨드가 `Result<T, String>` 사용 |
| 7 | commands/ 파일 과다 | 낮음 | 20개 파일이 플랫하게 나열 |
| 8 | ~~permissions 수동 관리~~ | ~~높음~~ | ~~해결 완료: build.rs 자동 생성~~ |

---

## Phase 1: 커맨드 선언 방식 통일 + 에러 타입 뼈대

### 목표
커맨드 선언을 통일하고, 이후 Phase에서 사용할 에러 타입의 뼈대를 먼저 도입.

### 1-A: 커맨드 선언 통일
- [x] build.rs에 자동 permissions 생성 로직 추가
- [ ] 모든 커맨드에서 `#[tauri::command(permission = "dmnote-allow-all")]` → `#[tauri::command]`로 통일
- [ ] 불필요한 `async` 제거 (plugin_storage.rs, bridge.rs)

### 1-B: CommandError 뼈대 도입
구조 분리 **전에** 에러 타입을 먼저 도입하여, 이후 파일 이동 시 `Result<T, String>` churn을 줄임.

```rust
// src/errors.rs (신규)
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("{0}")]
    App(String),
    #[error("파일 오류: {0}")]
    FileIO(#[from] std::io::Error),
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

// 커맨드 결과 타입 alias
pub type CmdResult<T> = Result<T, CommandError>;
```

- [ ] `errors.rs` 생성 + `CommandError` 정의
- [ ] 신규/수정 커맨드부터 점진적으로 `CmdResult<T>` 적용 (기존 코드 일괄 변환은 Phase 5)

### 통일 규칙 (CLAUDE.md 반영)
```rust
// 표준 커맨드 선언 패턴
#[tauri::command]
pub fn command_name(
    state: State<'_, AppState>,  // 필요 시
    app: AppHandle,               // 필요 시
    param: ParamType,             // 비즈니스 파라미터
) -> Result<ResponseType, String> {
    // ...
}
```

### 검증
- `cargo check` 통과
- `cargo clippy` 경고 없음
- 생성된 `permissions/dmnote-allow-all.json`이 기존과 동일한지 diff 확인

---

## Phase 2: 루트 파일 모듈 재편

### 목표
`src/` 루트의 12개 파일을 책임 단위로 하위 모듈로 분류.

### 제안 구조
```
src-tauri/src/
├── commands/           # Tauri 커맨드 (기존 유지)
├── services/           # 비즈니스 로직 서비스
├── state/              # [신규] 상태 관리
│   ├── mod.rs
│   ├── app_state.rs    # AppState 구조체 + 초기화
│   └── store.rs        # AppStore 영속 스토리지
├── keyboard/           # [신규] 키보드 입력 처리
│   ├── mod.rs
│   ├── daemon.rs       # 키보드 후킹 데몬 (keyboard_daemon.rs)
│   ├── manager.rs      # 키보드 매니저 (keyboard.rs)
│   └── labels.rs       # 키 레이블 매핑 (keyboard_labels.rs, Windows)
├── audio/              # [신규] 사운드 엔진
│   ├── mod.rs
│   └── engine.rs       # 키 사운드 엔진 (key_sound.rs)
├── models/             # [신규] 데이터 모델 분리
│   ├── mod.rs          # 공통 re-export
│   ├── keys.rs         # 키/카운터/포지션 모델
│   ├── settings.rs     # 설정 모델
│   ├── overlay.rs      # 오버레이 모델
│   ├── sound.rs        # 사운드 모델
│   └── css.rs          # CSS 모델
├── errors.rs           # CommandError (Phase 1-B)
├── ipc.rs              # IPC 이벤트 정의 (유지)
├── defaults.rs         # 기본값 상수 (유지)
├── cursor.rs           # 커서 설정 (macOS, 유지 — 플랫폼 특화 단독 모듈)
├── lib.rs
└── main.rs
```

> **변경 근거 (Codex 피드백 반영)**:
> - 기존 `input/`은 keyboard + cursor + key_sound를 혼합해 응집도가 낮았음
> - 책임 기준으로 `keyboard/` (입력 후킹/매핑)과 `audio/` (사운드 재생)로 분리
> - `cursor.rs`는 macOS 전용 단독 모듈이라 별도 폴더화 불필요

### 마이그레이션 순서 (영향도 낮은 것부터)
1. `keyboard/` 모듈 생성 — 참조: main.rs, app_state.rs (2곳)
2. `audio/` 모듈 생성 — 참조: app_state.rs, commands/key_sound.rs (2곳)
3. `state/` 모듈 생성 — **영향 범위 넓음**: commands 11개+, services 2개
4. `models/` 디렉토리화 — **가장 영향 넓음**: re-export로 기존 경로 호환 유지
5. `use` 경로 전체 업데이트

### 검증
- `cargo check` 통과
- `cargo clippy` 경고 없음
- `npm run tauri:dev`로 런타임 동작 확인

---

## Phase 3: commands/ 하위 분류

### 목표
20개 커맨드 파일을 도메인별 하위 폴더로 정리.

### 제안 구조
```
commands/
├── mod.rs
├── app/                # 앱 생명주기
│   ├── mod.rs
│   ├── bootstrap.rs    # app_bootstrap (app.rs에서 이동)
│   ├── system.rs       # window_*, app_open_external, app_restart, app_quit
│   └── update.rs       # app_auto_update
├── editor/             # 에디터 콘텐츠 (CSS/JS/노트)
│   ├── mod.rs
│   ├── css.rs
│   ├── js.rs
│   └── note_tab.rs
├── keys/               # 키 입력/설정
│   ├── mod.rs
│   ├── keys.rs
│   ├── key_sound.rs
│   └── sound.rs
├── layout/             # UI 레이아웃/위치
│   ├── mod.rs
│   ├── overlay.rs
│   ├── settings.rs
│   ├── graph_items.rs
│   ├── stat_items.rs
│   └── font.rs
├── media/              # 미디어 리소스
│   ├── mod.rs
│   ├── image.rs
│   └── counter_animation.rs
├── preset/             # 프리셋 저장/로드
│   ├── mod.rs
│   └── preset.rs       # (추후 save.rs / load.rs 분리 가능)
└── plugin/             # 플러그인 시스템
    ├── mod.rs
    ├── bridge.rs
    └── storage.rs
```

### build.rs 영향
commands/ 하위 폴더 구조로 변경 시 build.rs의 `generate_permissions()`가 하위 디렉토리도 재귀 스캔하도록 수정 필요:
- [ ] `fs::read_dir` → `walkdir` 또는 재귀 스캔으로 변경
- [ ] `cargo:rerun-if-changed` 경로도 하위 디렉토리 포함

### 참고
- main.rs의 `generate_handler![]` 매크로 경로도 함께 업데이트 필요
- 프론트엔드의 `invoke()` 호출명은 함수명 기준이므로 영향 없음

### 검증
- `cargo check` 통과
- 생성된 `permissions/dmnote-allow-all.json` diff 확인 (변경 없어야 함)
- 프론트엔드 `invoke()` 호출 정상 동작 확인

---

## Phase 4: 대형 파일 분리

### 대상 파일 (변경 축 기준 분리)

| 파일 | 줄 수 | 분리 축 | 분리 방안 |
|------|-------|---------|-----------|
| `app_state.rs` | 1,879 | 초기화 / 런타임 / 매니저 | `state/init.rs` + `state/runtime.rs` |
| `models.rs` | 1,814 | 도메인 / DTO / 스토리지 | Phase 2에서 이미 처리 |
| `preset.rs` | 1,541 | save / load / 공통 | `preset/save.rs` + `preset/load.rs` + `preset/common.rs` |
| `store.rs` | 1,079 | 코어 / 플러그인 | `state/store.rs` + `state/plugin_store.rs` |
| `keyboard_daemon.rs` | 1,013 | Windows / macOS | `keyboard/daemon_win.rs` + `keyboard/daemon_mac.rs` |
| `key_sound.rs` | 946 | 엔진 코어 / 사운드팩 | `audio/engine.rs` + `audio/soundpack.rs` |

### 주의사항
- `app_state.rs` 분리 시 state 간 순환 참조 주의 — 매니저 trait으로 경계 설계 후 분리
- `models.rs` 분리 시 runtime state / persistence schema / Tauri DTO를 명확히 구분

### 검증
- `cargo check` + `cargo clippy` 통과
- `npm run tauri:dev`로 전체 기능 런타임 확인

---

## Phase 5: 에러 핸들링 전면 적용

### 목표
Phase 1-B에서 도입한 `CommandError`를 모든 기존 커맨드에 적용.

### 작업
- [ ] 모든 커맨드의 `Result<T, String>` → `CmdResult<T>` 변환
- [ ] `.map_err(|e| e.to_string())` 패턴 제거, `?` 연산자로 대체
- [ ] 내부 서비스/스토어 계층에서는 `anyhow::Result` 사용 가능
- [ ] 커맨드 경계에서만 `CommandError` 노출 (anyhow를 커맨드 시그니처까지 끌고 나오지 않음)

### 검증
- `cargo check` + `cargo clippy` 통과
- 프론트엔드 에러 핸들링 동작 확인 (에러 메시지 형식 변경 여부)

---

## 실행 순서 요약

| 순서 | Phase | 작업 | 위험도 | 의존성 |
|------|-------|------|--------|--------|
| 1 | **1-A** | 커맨드 선언 통일 + async 정리 | 낮음 | 없음 |
| 2 | **1-B** | CommandError 뼈대 도입 | 낮음 | 없음 |
| 3 | **2** | 루트 파일 모듈 재편 | 중간 | Phase 1 |
| 4 | **3** | commands/ 하위 분류 | 중간 | Phase 2 |
| 5 | **4** | 대형 파일 분리 | 높음 | Phase 2-3 |
| 6 | **5** | 에러 핸들링 전면 적용 | 낮음 | Phase 1-B, 4 |

### 각 Phase 사이 검증 체크포인트
- `cargo check` — 컴파일 확인
- `cargo clippy` — 린트 경고 없음
- `cargo fmt` — 포맷팅
- `permissions/dmnote-allow-all.json` diff — 커맨드 누락/중복 없음
- `npm run tauri:dev` — 런타임 동작 확인 (Phase 2 이후)

---

## build.rs 자동 생성 방식 참고

### 현재 구현
- 문자열 기반 스캔: `#[tauri::command` 시작 라인 감지 → 이후 `pub fn` / `pub async fn` 라인에서 함수명 추출
- `#[cfg(...)]` 등 `#` 시작 라인은 자동 스킵 처리됨
- 빈 줄, 주석도 스킵

### 알려진 제한사항
- `pub(crate) fn` 형태는 감지 불가 (현재 코드베이스에는 없음)
- 멀티라인 함수 시그니처에서 `pub fn`이 다른 줄에 있으면 미감지 (현재 없음)
- commands/ 하위 디렉토리 구조 전환 시 재귀 스캔으로 수정 필요 (Phase 3)

### 정책
- 생성된 JSON은 git 커밋에 포함 (CI/로컬 환경 차이 방지)
- 빌드 시 내용이 동일하면 파일 쓰기 스킵 (불필요한 재빌드 방지)

---

## CLAUDE.md 반영 사항

Phase 완료 후 CLAUDE.md에 아래 내용 추가/수정 필요:

### Rust 커맨드 선언 규칙
```markdown
### Tauri 커맨드
- `#[tauri::command]` 사용 (permission 속성 생략 — build.rs가 자동 생성)
- 동기 `fn` 기본, `async fn`은 실제 await가 필요한 경우만 사용
- 에러 타입: `CmdResult<T>` (= `Result<T, CommandError>`)
```

### 폴더 구조 업데이트
Phase 2-3 완료 후 `프로젝트 구조` 섹션의 `src-tauri/src/` 부분 갱신
