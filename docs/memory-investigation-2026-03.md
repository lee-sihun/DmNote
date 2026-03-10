# DmNote 호스트 프로세스 메모리 200MB 문제 조사 보고서

## 날짜: 2026-03-10

## 증상
- VMMap 기준 dm-note.exe Heap: 200,032K (~200 MB)
- 릴리즈 빌드(10MB exe)에서 발생
- 실행 직후부터 200MB 고정, 기능 사용 여부와 무관
- 동일 Tauri 기반 과거 버전에서는 이 정도 메모리를 사용하지 않았음

## 조사 과정

### 1단계: dhat-rs 힙 프로파일러 시도 (실패)
- `dhat::Profiler`가 내부 mutex를 사용 → WebView2/COM 초기화와 교착 (deadlock)
- 앱이 아예 실행되지 않음 (창 안 뜸)
- **결론**: dhat-rs는 Tauri/WebView2 Windows 환경에서 사용 불가

### 2단계: Working Set 스냅샷 측정
`GetProcessMemoryInfo` API로 각 초기화 단계별 Working Set 측정:

```
process start:           9.5 MB
before generate_context: 9.6 MB
after generate_context:  167.3 MB  ← +157.7 MB
setup closure entered:   180.0 MB
before AppStore::init:   217.4 MB  ← +37.4 MB (register_dev_capability)
setup complete:          220.9 MB
```

**핵심 발견**: `generate_context!()` (+158 MB)와 `register_dev_capability()` (+37 MB)가 범인

### 3단계: Private Bytes + 모듈 분석
Working Set vs Private Bytes vs 로드 모듈 수를 동시 측정:

| 구간 | Private Bytes 변화 | 모듈 변화 |
|------|-------------------|-----------|
| `generate_context!()` | +158 MB | 변화 없음 (29개) |
| `.run(context)` → setup | +1.5 MB | 29→46 (+17 DLL) |
| `register_dev_capability()` | +37.6 MB | 변화 없음 |
| AppStore+AppState+Runtime | +3.4 MB | 46→53 |

**핵심**: 힙 할당이며, DLL 로딩이 아님

### 4단계: Rust 카운팅 할당자로 확정
`#[global_allocator]`에 atomic 카운터 추가하여 Rust 힙 할당량 직접 측정:

| 구간 | RustHeap 변화 | 할당 횟수 |
|------|-------------|----------|
| `generate_context!()` | **+140.9 MB** | **4,255,624회** |
| `register_dev_capability()` | **+34.4 MB** | **912,538회** |
| 나머지 전부 | +0.6 MB | ~12K회 |

## 근본 원인

### Tauri v2 ACL 시스템의 URL 패턴 중복 컴파일

`generate_context!()` 매크로가 컴파일 타임에 `Resolved` 구조체를 생성하고, 이를 토큰 스트림으로 변환하여 **런타임에 재구성**하는 코드를 생성한다.

재구성 시 각 `ResolvedCommand`마다:
```rust
ExecutionContext::Remote { url: "http://localhost:3400/**".parse().unwrap() }
```
이 코드가 실행되며, `RemoteUrlPattern::from_str()` → `urlpattern::UrlPattern::parse()` → **6개 `regex::Regex` 컴파일** (protocol, host, port, pathname, search, hash)

### 프로젝트 설정이 문제를 3배 증폭

1. **`main.json`** (컴파일 타임): remote URL 5개 + dmnote-allow-all (102 cmd) + core:default (88 cmd)
   → ~190 cmd × 5 URL × 6 regex = **5,700 regex**
2. **`dmnote-dev.json`** (컴파일 타임): remote URL 5개 + 동일 permissions
   → ~191 cmd × 5 URL × 6 regex = **5,730 regex**
3. **`register_dev_capability()`** (런타임): remote URL 5개 + 동일 permissions
   → ~191 cmd × 5 URL × 6 regex = **5,730 regex**

**합계: ~17,160 regex 컴파일**, 같은 5개 URL이 수백 번씩 캐싱 없이 반복 컴파일

### 메모리 계산
- regex::Regex 하나당 ~10-12 KB (NFA/DFA 테이블, IR 등)
- 17,160 × ~10 KB ≈ **168 MB** → 실측 175 MB와 일치

## 수정 방법

### main.json
- `remote` 섹션 제거 — 프로덕션에서 IPC는 `local: true`로 충분
- `tauri://localhost`는 로컬 프로토콜이므로 remote 불필요

### dmnote-dev.json
- `tauri.conf.json`의 capabilities에서 제거
- dev 빌드에서만 `register_dev_capability()`를 통해 런타임 등록

### register_dev_capability()
- `cfg!(debug_assertions)` 가드로 dev 빌드에서만 실행
- 릴리즈에서는 remote URL이 전혀 컴파일/파싱되지 않음

### 예상 효과
- generate_context: ~140 MB → ~1 MB (remote URL 0개 → regex 0개)
- register_dev_capability: ~34 MB → 0 MB (릴리즈에서 스킵)
- **총 메모리: ~200 MB → ~25 MB** (WebView2 + DLL + 앱 데이터만)

## 관련 파일
- `src-tauri/capabilities/main.json`
- `src-tauri/capabilities/dmnote-dev.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs` (register_dev_capability)
- Tauri 소스: `tauri-utils/src/acl/mod.rs` (RemoteUrlPattern, ExecutionContext ToTokens)
- Tauri 소스: `tauri-utils/src/acl/resolved.rs` (Resolved ToTokens)
- Tauri 소스: `tauri-codegen/src/context.rs` (context_codegen, runtime_authority!)
