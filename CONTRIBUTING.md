**한국어** | [English](docs/contributing_en.md)

# 기여 가이드

DM Note에 관심을 가져주셔서 감사합니다! 이 문서는 프로젝트에 기여하기 위한 기본적인 가이드라인을 안내합니다.

## 🎯 기여 범위

다양한 형태의 기여를 환영합니다.

### 🔧 코드 기여

| 유형           | 설명                                       |
| -------------- | ------------------------------------------ |
| 🐛 버그 수정   | 재현 가능한 버그의 원인 분석 및 수정       |
| ✨ 기능 추가   | 새로운 기능 구현 (이슈에서 먼저 논의 권장) |
| ♻️ 리팩토링    | 기존 코드의 구조 개선, 가독성 향상         |
| ⚡ 성능 최적화 | 렌더링, 메모리, 입력 지연 등 성능 개선     |

### 📄 비코드 기여

| 유형              | 설명                                                           |
| ----------------- | -------------------------------------------------------------- |
| 📝 문서 개선      | README, 가이드, API 문서 등의 오류 수정 및 보완                |
| 🌍 번역           | 새로운 언어 추가 또는 기존 번역 개선 (`src/renderer/locales/`) |
| 🧩 플러그인 / CSS | 커뮤니티 플러그인이나 CSS 테마 제작 및 공유                    |

> **참고**: 기능 추가나 큰 변경은 작업 전에 이슈를 열어 논의해주세요.

## 🚀 시작하기

### 사전 요구사항

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 사전 요구사항](https://v2.tauri.app/start/prerequisites/)

### 개발 환경 설정

```bash
git clone https://github.com/DmNote-App/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

> Windows에서 `tauri:dev`는 ASIO 출력을 포함하므로 LLVM(`LIBCLANG_PATH`)이 필요합니다. LLVM 없이 실행하려면 `npm run tauri:dev:no-asio`를 사용하세요. 자세한 내용은 [README의 Windows ASIO 빌드](README.md#windows-asio-빌드) 섹션을 참고하세요.

## 📂 프로젝트 구조

```
src/renderer/          # React 프론트엔드
├── components/        # UI 컴포넌트
│   ├── main/         # 메인 윈도우 전용
│   ├── overlay/      # 오버레이 윈도우 전용
│   └── shared/       # 공유 컴포넌트
├── hooks/            # 커스텀 훅
├── stores/           # Zustand 스토어
├── utils/            # 유틸리티 함수
└── types/            # 공유 타입 정의

src-tauri/src/         # Rust 백엔드
├── commands/         # Tauri 커맨드 (도메인별 하위 폴더)
├── services/         # 비즈니스 로직
├── state/            # 상태 관리
├── keyboard/         # 키보드 입력
└── audio/            # 사운드 엔진
```

### 편집 런타임과 네이티브 상태

`src/renderer/editor/runtime/`은 책임별로 나눕니다. `coordinator`는 커밋 조정·충돌 재조정, `projection`은 의미 연산의 문서 투영, `operations`는 요소 편집, `intent`는 편집 대상 결정, `geometry`는 배치 계산, `gesture`는 프리뷰·세션, `lifecycle`은 flush·쓰기 차단을 담당합니다. 테스트는 구현 옆에 둡니다. 커밋 엔진에 UI 스토어 의존성이 유입되지 않도록 소유 모듈을 직접 import하고 공통 barrel은 만들지 않습니다.

`PropertiesPanel/`은 재사용 입력을 `controls`, 패널 탐색·외형을 `navigation`, 선택 어댑터를 `selection`, 플러그인 설정을 `plugin`으로 묶습니다. 기존 `single`·`batch`·`layer` 그룹은 유지합니다. 파일을 옮길 때 테스트도 구현과 함께 이동합니다.

`src-tauri/src/state/assets/`는 로컬 자산 경로·가져오기를, `state/window/`는 플랫폼 창 연동·패널 드래그를 담당합니다. 패널 게스처 상태 전이는 `panel_drag/machine.rs`에 둡니다. 문서 커밋·저장·복구는 기존 상태 모듈이 계속 소유합니다.

`npm run type-check`는 `tsconfig.strict.json`도 실행합니다. 공유 계약, 편집 모델, 커밋 엔진, 의미 연산 투영, 순수 배치 계획과 이들이 import하는 의존성을 strict로 검사합니다. UI 통합과 테스트 fixture는 기존 설정을 사용하며, 해당 영역을 정리할 때 strict 범위도 확장합니다. 오류를 non-null assertion이나 `any`로 덮지 않습니다.

## 📌 코딩 규칙

### 파일 네이밍

| 대상           | 규칙                     | 예시                 |
| -------------- | ------------------------ | -------------------- |
| React 컴포넌트 | PascalCase               | `GridBackground.tsx` |
| 훅             | camelCase + `use` 접두사 | `useKeyManager.ts`   |
| Zustand 스토어 | camelCase + `use` 접두사 | `useFontStore.ts`    |
| 유틸리티       | camelCase                | `cubicBezier.ts`     |
| Rust 파일      | snake_case               | `app_state.rs`       |

### TypeScript / React

- 새로 추가하는 파일은 반드시 TypeScript (`.ts` / `.tsx`)
- 컴포넌트는 화살표 함수 + Props 인라인 구조분해 패턴 사용
- 컴포넌트는 `export default`, 훅/유틸리티는 named export 사용

### Rust

- `#[tauri::command]` 사용 (permission 속성 생략 — `build.rs`가 자동 생성)
- 동기 `fn` 기본, `async fn`은 실제 await가 필요한 경우만 사용

### 주석

- 기술 용어를 제외하면 **한글**로 작성
- 키워드/명사형 스타일 사용 (예: `// 카운터 초기화`)
- 코드로 의도가 명확하면 주석 생략

### API 문서

- 플러그인 API(`dmn.*`) 또는 Tauri 커맨드 변경 시 `docs/content/` 하위 MDX 문서 업데이트
- `en/`, `ko/` 두 언어 모두 반영

## ✅ PR 전 체크리스트

### 프론트엔드 변경 시

```bash
npm run type-check  # 전체 타입 체크 + 핵심 영역 strict 검사
npm run lint        # 린트
npm run format      # 포맷팅
```

### 백엔드 변경 시

```bash
cd src-tauri
cargo check         # 컴파일 체크
cargo clippy        # 린트
cargo fmt           # 포맷팅
```

### API / 백엔드 변경 시

- 플러그인 API(`dmn.*`) 또는 Tauri 커맨드를 변경할 경우, 기존 플러그인이나 외부 연동이 정상 동작하는지 **하위 호환성**을 반드시 검토해주세요
- 설정 파일 스키마 변경 시 마이그레이션 로직이 필요한지 확인해주세요
- 변경 사항이 있으면 `docs/content/` 하위 MDX 문서를 `en/`, `ko/` 양쪽 모두 업데이트해주세요

### 공통

- 변경 후 기존 기능이 정상적으로 동작하는지 직접 확인해주세요
- 테스트가 있는 영역이라면 모든 테스트가 통과하는지 확인해주세요

## 📨 기여 절차

1. 이슈를 먼저 열어 변경 사항을 논의합니다
2. 포크 후 브랜치를 생성합니다
3. 위 체크리스트를 통과하는지 확인합니다
4. PR을 제출합니다

기여해 주셔서 감사합니다! 🙏

> AI 도구를 활용한 바이브 코딩 기여도 환영합니다. 다만 제출 전에 코드의 동작과 품질을 충분히 검토해주세요.
