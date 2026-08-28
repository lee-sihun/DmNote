# Windows 릴리스 절차

`.github/workflows/release-windows.yml`은 Windows x64 EXE를 한 번 빌드하고, 같은 EXE를 자동 업데이트 자산과 포터블 ZIP에 함께 배치한다.

현재 워크플로는 두 모드로 실행된다.

- 버전 태그 push: 운영 인증서 활성화 전까지 SignPath 단계를 건너뛰고 미서명 EXE/ZIP을 동일 draft 릴리즈에 업로드
- `workflow_dispatch`: SignPath 자체 서명 테스트 인증서를 적용하고 Actions artifact로만 업로드

## 1. 배포 자산 계약

| 자산                      | 용도                                           |
| ------------------------- | ---------------------------------------------- |
| `DM.NOTE.exe`             | 앱 내 Windows 자동 업데이트가 다운로드하는 EXE |
| `DM.NOTE.v.<version>.zip` | 신규 설치용 포터블 패키지                      |

ZIP 내부의 `dm-note.exe`는 `DM.NOTE.exe`와 파일명만 다르고 바이트는 동일하다. 워크플로가 두 파일의 SHA-256 일치를 검사한다. 수동 테스트 모드에서는 Authenticode 서명 이후 ZIP을 생성하므로 서명 요청은 한 번만 발생하며, 현재 태그 릴리즈 모드에서는 같은 미서명 EXE를 재사용한다.

`distribution/windows/assets/`의 전체 내용은 ZIP의 `assets/`로 재귀 복사된다. 현재 구성은 다음과 같다.

- `assets/neonsign.css`
- `assets/rainbow.css`
- `assets/plugin/key-interval.js`
- `assets/plugin/kps.js`
- `assets/plugin/v-archive.js`
- `THIRD_PARTY_NOTICES.txt`

CSS·플러그인 5개는 기존 1.6.1 Windows ZIP의 내용을 기준으로 저장되어 있다. 이후 배포 자산을 추가하거나 제거할 때는 `distribution/windows/assets/`만 수정하면 ZIP 구성이 자동으로 따라간다. `THIRD_PARTY_NOTICES.txt`는 현재 바이너리 의존성과 맞아야 하므로 저장소 최신본을 별도로 포함한다.

## 2. 현재 태그 릴리즈 (운영 인증서 활성화 전)

```bash
npm version patch
git push origin main X.Y.Z
```

`X.Y.Z` 태그 push는 macOS와 Windows workflow를 함께 시작한다. Windows workflow는 버전 일치를 검사하고 EXE를 빌드하지만 SignPath 제출·서명·서명 검증 단계는 실행하지 않는다. 이후 다음 자산을 macOS workflow와 동일한 draft 릴리즈에 생성하거나 덮어쓴다.

- `DM.NOTE.exe`
- `DM.NOTE.v.X.Y.Z.zip`

이미 publish된 릴리즈는 자동으로 덮어쓰지 않는다. 운영 인증서 활성화 전 Windows 자산은 미서명이므로 publish 전에 릴리즈 노트에 이 사실을 명시한다. 테스트 인증서로 서명된 파일을 대신 배포하지 않는다.

## 3. SignPath Artifact Configuration

SignPath 프로젝트에서 Artifact Configuration을 추가하고 slug를 기록한다. GitHub Actions의 `upload-artifact`가 전송 파일을 ZIP으로 감싸므로 최상위 요소는 `<zip-file>`이어야 한다.

저장소의 `.signpath/artifact-configurations/windows-exe.xml` 내용을 SignPath 설정에 등록한다. 이 구성은 `DM.NOTE.exe` 하나만 서명하며 Product Name과 버전을 제한한다.

Open Source Code Signing 구독은 Authenticode 설명에 자동 워터마크를 적용하므로 `<authenticode-sign>`에 `description`이나 `description-url` 속성을 지정하지 않는다.

## 4. GitHub 설정

SignPath에서 다음을 완료한다.

1. Organization에 predefined Trusted Build System `GitHub.com` 추가
2. DM NOTE 프로젝트에 `GitHub.com` 연결
3. SignPath GitHub App에 `DmNote-App/DmNote` 저장소 접근 허용
4. Signing Request submit 권한이 있는 API Token 생성

GitHub 저장소의 **Settings -> Secrets and variables -> Actions**에 다음 값을 등록한다.

| 종류     | 이름                                   | 값                                        |
| -------- | -------------------------------------- | ----------------------------------------- |
| Secret   | `SIGNPATH_API_TOKEN`                   | SignPath API Token                        |
| Variable | `SIGNPATH_ORGANIZATION_ID`             | SignPath Organization UUID                |
| Variable | `SIGNPATH_PROJECT_SLUG`                | DM NOTE 프로젝트 slug                     |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | 위에서 등록한 Artifact Configuration slug |

Signing policy slug는 감사 가능한 워크플로 코드에 `test-signing`으로 고정되어 있다.

## 5. 테스트 서명 실행

1. 워크플로와 Artifact Configuration을 기본 브랜치에 반영한다.
2. Actions -> **Release Windows** -> **Run workflow**를 기본 브랜치에서 실행한다.
3. SignPath Signing Request가 `Completed`인지 확인한다.
4. Actions summary의 Signing Request URL과 GitHub Actions run URL을 Phillip이 보낸 기존 메일 스레드로 회신해 설정 검토를 요청한다.

워크플로 산출물 `dmnote-windows-test-signed-<version>`은 로컬 검증에만 사용하고 배포하지 않는다. 테스트 인증서는 공개 신뢰 체인에 포함되지 않는다.

운영 인증서용 별도 신청 폼은 없다. 안내 메일대로 테스트 파이프라인을 완료한 뒤 같은 메일 스레드에서 검토를 요청하면 SignPath Foundation이 운영 인증서를 주문하고 Organization으로 import한다. 회신에는 다음 정보를 포함한다.

- SignPath Project URL
- 완료된 테스트 Signing Request URL
- GitHub Actions run URL
- Artifact Configuration slug

회신 예시:

```text
Hello Phillip,

The GitHub Actions integration and artifact configuration are now set up,
and the test-signing request completed successfully.

SignPath project: <URL>
Signing request: <URL>
GitHub Actions run: <URL>
Artifact configuration: <slug>

Could you please review the setup and proceed with the production certificate?

Best regards,
Yeonu
```

SignPath Foundation은 운영 인증서 발급의 공식 처리 기한을 공개하지 않는다. 2026년 공개 프로젝트 사례는 대략 12~24일 범위였지만 보장되는 일정은 아니므로, 테스트 자료를 보낸 뒤 2주 동안 회신이 없으면 같은 스레드에서 진행 상황을 문의한다.

## 6. 운영 인증서 활성화 후 전환

SignPath가 운영 인증서를 import하고 `release-signing`이 valid가 된 뒤 별도 변경으로 다음을 수행한다.

1. 태그 릴리즈에서도 SignPath 설정을 검사하도록 변경
2. `SIGNING_POLICY_SLUG`를 `release-signing`으로 변경
3. 태그 릴리즈의 서명 생략 분기를 제거하고 운영 서명·검증을 필수화
4. macOS workflow와 Windows workflow가 모두 완료된 뒤 draft 자산을 확인하고 publish

운영 전환 전에는 테스트 인증서 자산을 릴리스에 업로드하지 않는다.
