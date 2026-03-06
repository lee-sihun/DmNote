# Rust 백엔드 리팩토링 계획

## 진행 상태

| Phase | 작업 | 상태 |
|-------|------|------|
| **1-A** | 커맨드 선언 통일 + async 정리 + permissions 자동 생성 | ✅ 완료 |
| **1-B** | CommandError 뼈대 도입 | ⏳ 미착수 |
| **2** | 루트 파일 모듈 재편 (keyboard/, audio/, state/, models/) | ✅ 완료 |
| **3** | commands/ 하위 분류 (7개 도메인 폴더) + build.rs 재귀 스캔 | ✅ 완료 |
| **4** | 대형 파일 분리 (preset.rs → save/load) | ✅ 부분 완료 |
| **5** | 에러 핸들링 전면 적용 | ⏳ 미착수 |

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
├── state/                 # 상태 관리 (app_state, store)
├── keyboard/              # 키보드 입력 (daemon, manager, labels)
├── audio/                 # 사운드 (engine)
├── models/                # 데이터 모델 (mod.rs에 통합)
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

## Phase 1-B: CommandError 뼈대 도입 ⏳

- [ ] `errors.rs` 생성 + `CommandError` 정의
- [ ] 신규/수정 커맨드부터 점진적으로 `CmdResult<T>` 적용

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

## Phase 4: 대형 파일 분리 (부분 완료)

### 완료
| 파일 | 줄 수 | 분리 결과 |
|------|-------|-----------|
| `preset.rs` | 1,541 | `save.rs` + `load.rs` + `mod.rs`(공유 타입/헬퍼) |

### 미착수 (추후 진행)
| 파일 | 줄 수 | 분리 방안 | 비고 |
|------|-------|-----------|------|
| `app_state.rs` | 1,879 | init / runtime 분리 | 메서드간 상태 공유가 깊어 신중한 설계 필요 |
| `models/mod.rs` | 1,814 | 도메인별 submodule | 타입 간 참조가 복잡, re-export 필요 |
| `store.rs` | 1,079 | core / migration 분리 | 마이그레이션 함수를 별도 파일로 추출 가능 |
| `keyboard/daemon.rs` | 1,013 | win / mac 분리 | 이미 `#[cfg]`로 분기됨 |
| `audio/engine.rs` | 946 | engine / soundpack | 1000줄 미만, 우선순위 낮음 |

---

## Phase 5: 에러 핸들링 전면 적용 ⏳

- [ ] 모든 커맨드의 `Result<T, String>` → `CmdResult<T>` 변환
- [ ] `.map_err(|e| e.to_string())` 패턴 제거, `?` 연산자로 대체

---

## build.rs 자동 생성 방식

### 현재 구현
- 재귀 디렉토리 스캔: `commands/` 하위 모든 `.rs` 파일에서 `#[tauri::command]` 감지
- `#[cfg(...)]` 등 `#` 시작 라인은 자동 스킵
- 빈 줄, 주석도 스킵
- 내용 변경 없으면 파일 쓰기 스킵 (불필요한 재빌드 방지)

### 정책
- 생성된 JSON은 git 커밋에 포함 (CI/로컬 환경 차이 방지)
