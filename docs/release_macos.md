# macOS 릴리즈 절차

`.github/workflows/release-macos.yml`이 유니버설 DMG 빌드 → Developer ID 서명 → 공증 → draft 릴리즈 첨부까지 수행한다. 같은 태그로 Windows workflow도 실행되어 Windows 자산을 동일 draft 릴리즈에 첨부한다.

## 1. 시크릿 (최초 1회)

| 시크릿 | 값 | 발급 |
|---|---|---|
| `MACOS_CERT_P12_BASE64` | Developer ID Application 인증서 `.p12`의 base64 | 키체인 접근 → 내 인증서 → 우클릭 → 내보내기 (**개인 키 포함**, 암호 설정) |
| `MACOS_CERT_PASSWORD` | `.p12` 내보내기 암호 | — |
| `MACOS_SIGNING_IDENTITY` | `Developer ID Application: 이름 (TEAMID)` | 선택 — 설정 시 키체인의 identity와 일치하는지 검사 |
| `APPLE_API_KEY_ID` | App Store Connect API Key ID (10자) | App Store Connect → 사용자 및 액세스 → 통합 → **팀 키** (Developer 이상). 개인 키는 `--issuer`가 없어 사용 불가 |
| `APPLE_API_ISSUER_ID` | Issuer ID (UUID) | 위 페이지 상단 |
| `APPLE_API_KEY_P8_BASE64` | `AuthKey_XXXXXXXXXX.p8`의 base64 | 팀 키 생성 시 1회만 다운로드 가능 |

```bash
base64 -i DeveloperID.p12 | gh secret set MACOS_CERT_P12_BASE64
gh secret set MACOS_CERT_PASSWORD
gh secret set MACOS_SIGNING_IDENTITY --body "Developer ID Application: 이름 (TEAMID)"
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER_ID
base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set APPLE_API_KEY_P8_BASE64
```

`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`(Tauri 내장 흐름)는 **사용하지 않는다** — Tauri의 임시 키체인은 번들 단계에서 생성되어, 그 전에 헬퍼를 서명하는 `scripts/sign-macos-helper.sh` 훅이 identity를 찾지 못한다.

## 2. 드라이런 (워크플로 변경 후 권장)

Actions → **Release macOS** → Run workflow → ref: `main`, `dry_run: true`
빌드·서명·공증·검증만 수행하고 DMG를 workflow artifact로 올린다. 릴리즈는 만들지 않는다.

## 3. 릴리즈

```bash
npm version patch        # package.json 버전 올리고 tauri.conf.json / Cargo.toml / Cargo.lock / README 동기화 후
                         # "X.Y.Z" 커밋 + 로컬 X.Y.Z 태그 생성 (.npmrc의 tag-version-prefix= 로 v 접두사 없음)
git push origin main     # 태그는 push하지 않음
```

`package.json` 버전 변경과 커밋 제목 `X.Y.Z`가 일치하는 main push를 감지하면 macOS와 Windows workflow가 실행된다. 원격 `X.Y.Z` 태그와 draft 릴리즈는 Actions가 자동 생성하고 각 자산을 첨부한다. 릴리즈 본문은 `scripts/build-release-notes.js`가 생성한다 (체인지로그 링크 + 자산 안내 + `CHANGELOG.md`에서 추출한 기여자 섹션). 변경 내역 자체는 `CHANGELOG.md`에 유지한다. 이후:

> 자산 이름 `DM.NOTE_<tag>_{aarch64|x64|universal}.dmg`는 **앱 내 자동 업데이트가 의존하는 계약**이다 (`src-tauri/src/commands/app/update_macos/mod.rs`의 `asset_candidates`). 아키텍처 전용 자산이 있으면 그것을 우선 받으므로, 서명·공증되지 않은 DMG를 그 이름으로 수동 업로드하지 말 것.

1. `CHANGELOG.md`와 `CHANGELOG_en.md`에 `## [X.Y.Z](...)` 섹션이 있는지 확인 (본문 링크가 `#XYZ` 앵커로 걸린다)
2. macOS DMG와 Windows 자산(`DM.NOTE.exe`, `DM.NOTE.v.X.Y.Z.zip`)이 모두 있는지 확인
3. **Publish** → `update-website.yml`이 DmSite 갱신을 트리거

`docs/releases/*.md`는 2.0.1까지의 published 릴리즈 본문이 링크하고 있으므로 **삭제하지 않는다**. 신규 버전 노트는 더 추가하지 않고 `CHANGELOG.md`에만 쓴다.

릴리즈 본문은 draft를 처음 만든 workflow가 **한 번만** 기록한다. publish 후에 기여자 크레딧이나 영문 노트를 체인지로그에 추가했다면 본문에 반영되지 않으므로 다음으로 다시 쓴다.

```bash
node scripts/refresh-release-notes.js 2.0.2          # 미리보기
node scripts/refresh-release-notes.js 2.0.2 --apply  # 반영
```

본문 문구 자체를 바꾸려면 템플릿이 있는 `scripts/lib/release-notes.js`를 수정한다 (두 진입점이 공유한다).

현재 버전을 다시 빌드하려면 Run workflow → ref: `main` + `dry_run` 해제. draft면 DMG만 덮어쓰고 노트·다른 자산은 유지되며, 이미 publish된 릴리즈는 자동 덮어쓰기를 거부한다(수동 `gh release upload --clobber`).

`npm version`이 중간에 실패하면(예: `cargo update` 오프라인) 커밋·태그 없이 버전 파일만 바뀐 상태로 남는다 — `git checkout -- . && git status`로 되돌린 뒤 재시도.

## 4. 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| preflight `버전 불일치` | `npm run sync-version` 후 커밋하고 다시 태깅 |
| `임시 키체인에 Developer ID Application identity 없음` | `.p12`를 개인 키 없이 내보냄 → 키체인 접근 "내 인증서"에서 인증서+키를 함께 선택해 다시 내보내기 |
| 헬퍼 훅 `키체인에서 identity를 찾을 수 없음` | 키체인 스텝 실패 또는 `APPLE_CERTIFICATE` 흐름을 섞어 씀 |
| DMG 공증 `Invalid`/타임아웃 | 워크플로가 `notarytool log`를 스텝 로그에 출력함 — issues 항목 확인. 앱 공증(Tauri 내부)이 실패하면 빌드 스텝 로그의 issues 확인. 헬퍼 미서명이면 `scripts/sign-macos-helper.sh` 훅 동작 확인 |
| 공증 `In Progress`로 장시간 대기 | 신규 계정 첫 제출은 수 시간 걸릴 수 있음. 재제출하지 말 것 (병렬 보류만 늘어남) |
| `stapler validate` 실패 | `APPLE_API_*` 값이 잘못되면 Tauri가 공증을 조용히 건너뜀 — 시크릿 값·팀 키 여부 확인 (누락은 preflight가 먼저 잡음) |
