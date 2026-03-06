# Rust 백엔드 리팩토링 계획

## 진행 상태

| Phase | 작업 | 상태 |
|-------|------|------|
| **1-A** | 커맨드 선언 통일 + async 정리 + permissions 자동 생성 | ✅ 완료 |
| **1-B** | CommandError/CmdResult 도입 | ✅ 완료 |
| **2** | 루트 파일 모듈 재편 (keyboard/, audio/, state/, models/) | ✅ 완료 |
| **3** | commands/ 하위 분류 (7개 도메인 폴더) + build.rs 재귀 스캔 | ✅ 완료 |
| **4** | 대형 파일 분리 | ✅ 부분 완료 |
| **5** | 에러 핸들링 전면 적용 | ✅ 완료 |

---

## 현재 폴더 구조

```
src-tauri/src/
├── commands/
│   ├── app/               # 앱 생명주기 (bootstrap, system, update)
│   ├── editor/            # 에디터 콘텐츠 (css, js, note_tab)
│   ├── keys/              # 키 입력/설정 (keys, key_sound, sound)
│   ├── layout/            # UI 레이아웃 (overlay, settings, font, graph/stat_items)
│   ├── media/             # 미디어 리소스 (image, counter_animation)
│   ├── preset/            # 프리셋 (save, load, mod=공유 타입)
│   └── plugin/            # 플러그인 (bridge, storage)
├── services/              # 비즈니스 로직 (css_watcher, settings)
├── state/                 # 상태 관리 (app_state, store, migration)
├── keyboard/              # 키보드 입력 (daemon/{mod,windows,macos}, manager, labels)
├── audio/                 # 사운드 (engine)
├── models/                # 데이터 모델 (mod.rs에 통합)
├── errors.rs              # CommandError / CmdResult 정의
├── cursor.rs              # 커서 설정 (macOS)
├── defaults.rs            # 기본값 상수
├── ipc.rs                 # IPC 이벤트 정의
├── lib.rs
└── main.rs
```

---

## Phase 1-A: 커맨드 선언 통일 ✅

- [x] build.rs에 자동 permissions 생성 로직 추가
- [x] 모든 커맨드에서 `#[tauri::command(permission = "dmnote-allow-all")]` → `#[tauri::command]`로 통일
- [x] 불필요한 `async` 제거 (plugin_storage.rs, bridge.rs)

## Phase 1-B: CommandError 뼈대 도입 ✅

- [x] `errors.rs` 생성 — `CommandError` enum (thiserror) + `CmdResult<T>` 타입 별칭
- [x] variant: `Message(String)`, `Anyhow(#[from])`, `Io(#[from])`, `Json(#[from])`, `Tauri(#[from])`
- [x] `Serialize` 구현 — 문자열 직렬화 (프론트 호환 유지)

---

## Phase 2: 루트 파일 모듈 재편 ✅

- [x] `keyboard/` 모듈 생성 (daemon, manager, labels)
- [x] `audio/` 모듈 생성 (engine)
- [x] `state/` 모듈 생성 (app_state, store)
- [x] `models/` 디렉토리화 (re-export로 기존 경로 호환 유지)
- [x] 모든 import 경로 업데이트

---

## Phase 3: commands/ 하위 분류 ✅

- [x] 19개 커맨드 파일을 7개 도메인별 하위 폴더로 분류
- [x] build.rs: 재귀 디렉토리 스캔으로 변경
- [x] main.rs: `generate_handler![]` 경로 전체 업데이트

---

## Phase 4: 대형 파일 분리

### 완료
| 파일 | 줄 수 | 분리 결과 |
|------|-------|-----------|
| `preset.rs` | 1,541 | `save.rs` + `load.rs` + `mod.rs`(공유 타입/헬퍼) |
| `store.rs` | 1,079 | `store.rs`(core) + `migration.rs`(load/repair/migrate/normalize) |
| `daemon.rs` | 1,013 | `daemon/mod.rs`(공유) + `windows.rs` + `macos.rs` |

### 보류 (기능 변경 시점에 자연스럽게 분리)
| 파일 | 줄 수 | 비고 |
|------|-------|------|
| `app_state.rs` | 1,879 | 메서드간 상태 공유가 깊어 분리 시 regression 위험 |
| `models/mod.rs` | 1,814 | 타입 정의 파일, 로직 복잡도 낮음 |
| `audio/engine.rs` | 946 | 1000줄 미만, 우선순위 낮음 |

---

## Phase 5: 에러 핸들링 전면 적용 ✅

- [x] 20개 커맨드 파일의 `Result<T, String>` → `CmdResult<T>` 전환
- [x] `.map_err(|e| e.to_string())` 패턴 제거, `?` 연산자로 대체
- [x] 도메인 코드 문자열(`"invalid-preset"` 등)은 `CommandError::msg()` 사용

---

## build.rs 자동 생성 방식

### 현재 구현
- 재귀 디렉토리 스캔: `commands/` 하위 모든 `.rs` 파일에서 `#[tauri::command]` 감지
- `#[cfg(...)]` 등 `#` 시작 라인은 자동 스킵
- 빈 줄, 주석도 스킵
- 내용 변경 없으면 파일 쓰기 스킵 (불필요한 재빌드 방지)

### 정책
- 생성된 JSON은 git 커밋에 포함 (CI/로컬 환경 차이 방지)
