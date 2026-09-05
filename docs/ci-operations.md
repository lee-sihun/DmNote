# CI 운영 안내

CI는 `.node-version`의 Node 22.23.2와 `rust-toolchain.toml`의 Rust 1.93.0을 사용한다. 로컬 커밋 hook과 일반 작업 브랜치 push에는 검사를 강제하지 않는다.

## PR 검사

[CI workflow](../.github/workflows/ci.yml)는 다음 6개 job으로 구성한다.

| Job              | 실행 조건             | 검사                                                     |
| ---------------- | --------------------- | -------------------------------------------------------- |
| 변경 분류        | 모든 PR               | 전체 base/head diff, Draft 여부, 문서 allowlist          |
| 빠른 검사        | 분류 성공             | 포맷·lint·타입·문서/공유 계약·CI 정책·actionlint·rustfmt |
| 프론트 전체 검사 | Ready 코드 PR         | 전체 Vitest와 Vite 빌드                                  |
| Windows 검증     | Ready 코드 PR         | ASIO Clippy·전체 Rust 테스트·debug 앱 빌드               |
| macOS 검증       | Ready 코드 PR         | Clippy·전체 Rust 테스트·debug `.app`와 helper 검증       |
| CI Gate          | 선행 job 종료 후 항상 | 필요한 job의 성공 여부, 의도된 skip 여부                 |

빠른 검사 이후 프론트·Windows·macOS를 병렬 실행한다. Ready PR의 새 커밋은 전체 검사를 다시 실행하고 같은 PR의 이전 실행을 취소한다. Draft 전환도 진행 중인 이전 실행을 취소하며, Ready 전환 시 같은 SHA여도 전체 검사를 시작한다. 제목·본문 편집도 `edited` 이벤트로 검사되므로 초기에는 일부 추가 실행이 발생할 수 있다.

모든 변경이 `README.md`, `AGENTS.md`, `docs/**/*.md`, `docs/content/**/*.mdx` 안에만 있으면 무거운 job을 생략한다. 문서·계약 검사는 생략하지 않는다. rename은 이전/이후 경로를 모두 확인하고, 미분류 경로·불완전한 diff는 전체 검사로 처리한다. 파일 형식 변경도 전체 검사한다.

`CI Gate`는 필수 job의 실패·취소·누락·예상하지 못한 skip을 성공으로 처리하지 않는다. Draft의 성공은 빠른 검사의 성공이며, Draft 상태에서는 병합할 수 없다. 수동·주간 전체 검증은 `Full Validation Gate`, main의 빠른 검사는 `Main Quality`로 표시해 PR 필수 체크와 구분한다.

## 주간·수동 검증

[Weekly Validation](../.github/workflows/ci-weekly.yml)은 매주 월요일 04:23 KST(일요일 19:23 UTC)에 전체 검증과 의존성 보고를 실행한다. GitHub schedule은 지연될 수 있으며 기본 브랜치에 workflow가 있어야 동작한다.

- 전체 프론트 테스트의 coverage와 JUnit 결과를 7일 보관한다. PR의 JUnit 보고서도 같은 기간 보관한다.
- Windows는 ASIO 활성/미사용 구성의 테스트·Clippy·배포 profile 빌드와 doctest를 수행한다.
- macOS는 Universal `.app`를 생성하고 helper·최소 OS·리소스를 검증한다. 인증서와 공증 secret은 사용하지 않는다.
- npm audit와 cargo-audit 0.22.2의 보고서를 14일 보관한다. 초기 취약점은 비차단 기준선으로 수집하지만 잘못된 보고서나 조회 실패는 실패로 처리한다.
- 앱 바이너리는 기본 업로드하지 않는다. 실제 장치·ASIO 재생·WebView 프레임·서명·공증 검증을 이 결과로 대체하지 않는다.

Actions의 `CI` → `Run workflow`에서 브랜치를 선택하면 경로에 무관한 전체 검증을 실행한다. `extended=true`가 기본이며 위 추가 구성도 포함한다. `false`면 일반 Ready PR과 같은 구성을 검사한다. `Weekly Validation` 수동 실행은 의존성 점검까지 포함한다. 새로운 workflow의 수동 실행은 기본 브랜치 반영 후 사용할 수 있다.

성능 벤치마크와 실제 WebView 자동화, 테스트 분산은 [도입 계획서](./ci-adoption-plan.md)의 후속 항목이다. 시간 기반 성능 수치를 PR gate에 사용하지 않는다. ASIO 미사용 분기에 영향을 주는 변경은 병합 전 extended 수동 검증으로 확인한다.

## 릴리즈 검증

기존 Windows/macOS 릴리즈의 버전 커밋 감지와 수동 실행을 유지한다. 순서는 **읽기 전용 버전·SHA 결정 → 해당 플랫폼의 전체 검증 → 태그 생성 → 기존 최적화 빌드·서명·패키징**이다. 검증 실패 시 태그·서명 단계로 진행하지 않는다.

[Release Validation](../.github/workflows/ci-release.yml)은 검사 도구를 호출 workflow의 SHA에서 가져오고, 배포 소스를 `release-source`에 `release_sha`로 checkout한다. CI 파일이 없던 과거 버전의 수동 재배포도 현재 검사 도구로 검증한다. 제품의 테스트·의존성·빌드 스크립트는 배포 SHA의 것을 실행한다. 최종 서명 job의 Node·Rust 버전은 preflight가 현재 버전 파일에서 읽어 전달한다.

PR과 릴리즈 검증은 같은 Windows/macOS composite action을 사용한다. 릴리즈의 기존 오디오 전용 테스트는 같은 SHA·Windows·ASIO 구성의 전체 테스트로 대체했다. 검사 workflow에 서명 secret을 상속하지 않는다.

## 병합 후 저장소 설정

워크플로 파일만으로 병합 제한이 활성화되지는 않는다. 이번 PR은 검토 가능한 [main ruleset JSON](../.github/rulesets/main.json)을 제공하며 저장소 설정을 자동으로 변경하지 않는다.

1. 이 PR에서 `CI Gate`의 전체 성공을 확인하고 병합한다.
2. Settings → Rules → Rulesets에서 JSON을 가져온다. API로 적용하려면 아래 명령을 사용한다. 같은 이름의 ruleset이 이미 있으면 중복 생성하지 않고 기존 것을 편집한다.
3. `CI Gate`의 제공자가 GitHub Actions인지, 최신 base 검사 요구·PR 경유·force push/삭제 제한이 적용됐는지 확인한다.

```bash
gh api --method POST repos/DmNote-App/DmNote/rulesets --input .github/rulesets/main.json
```

승인 리뷰 수는 0으로 시작한다. 기본 bypass는 없으며 긴급 운영 예외는 관리자가 ruleset에서 명시적으로 결정한다. 이 설정은 기존의 직접 `npm version` push 흐름에도 영향을 주므로 버전 변경도 PR로 병합하고, 릴리즈 감지에 사용하는 최종 커밋 제목은 버전 문자열을 유지한다.

Merge queue는 아직 설정하지 않는다. 활성화할 때는 `merge_group` 트리거와 해당 이벤트의 `CI Gate` 이름을 함께 추가해야 한다.

## 실패 확인과 버전 갱신

- `CI Gate` summary에서 실패한 job을 확인한다. Windows ASIO SDK는 저장소의 `src-tauri/vendor/asio-sdk`를 사용하며 LLVM과 함께 준비한다.
- 같은 구성의 `cargo check` 단계는 중복 실행하지 않는다. 로컬 개발 완료 시 `AGENTS.md`의 검증 명령은 그대로 따른다.
- `npm run test:ci`는 실제 Git rename fixture와 Draft/Ready·실패/취소/skip 판정을 검사한다. `npm run lint:workflows`는 checksum으로 확인한 actionlint 1.7.12를 사용한다. ShellCheck는 별도 검사이며 이 명령에서는 실행하지 않는다.
- workflow action은 SHA로 고정하고 Dependabot이 Actions·npm·Cargo 갱신 PR을 만든다. Node/Rust/tool 설치 버전과 actionlint checksum은 별도 갱신 PR에서 함께 검증한다.
- AI 리뷰는 Draft·fork·Dependabot에서 실행하지 않으며 `CI Gate`의 필수 조건에 포함하지 않는다.
- 기존 lint 경고와 opt-in benchmark skip은 유지한다. 새 경고나 skip을 자동으로 숨기지 않으며 전체 결과는 각 runner 로그에서 확인한다.
