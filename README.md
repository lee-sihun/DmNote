**한국어** | [English](docs/readme_en.md) | [中文](docs/readme_zh-cn.md)

<div align="center">
  <img src="src-tauri/icons/icon.ico" alt="dmnote Logo" width="120" height="120">

  <h1>DM Note</h1>

  <p>
    <strong>Make it yours</strong>
  </p>
  <p>
    <strong>나만의 스타일로 완성하는 키뷰어</strong>
  </p>

  [![GitHub release](https://img.shields.io/github/release/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases)
  [![GitHub downloads](https://img.shields.io/github/downloads/lee-sihun/DmNote/total.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases/download/1.6.1/DM.NOTE.v.1.6.1.zip)
  [![GitHub license](https://img.shields.io/github/license/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)
</div>

https://github.com/user-attachments/assets/d2d638b4-5867-4a3e-8710-0fa843eaf236

## 🌟 개요

**DM Note**는 DJMAX RESPECT V에서 사용하기 위해 만들어진 키뷰어 프로그램입니다. 다른 게임에서도 자유롭게 사용할 수 있으며 간편한 설정으로 스트리밍이나 플레이 영상 제작 시 키 입력을 시각적으로 보여줄 수 있습니다. 현재는 공식적으로 Windows 10/11, macOS 환경만 지원하고 있습니다. 만약 리눅스 환경이라면 [커뮤니티 포크 버전](https://github.com/northernorca/DmNote)을 사용해보는걸 추천합니다.

[DM NOTE v1.6.1 다운로드](https://github.com/lee-sihun/DmNote/releases/download/1.6.1/DM.NOTE.v.1.6.1.zip)

## 🖼️ 스크린샷

<img src="docs/assets/image.png" alt="Screenshot" width="700">
<img src="docs/assets/IMG_1005.gif" alt="Note Effect" width="700">

## ✨ 주요 기능

### ⌨️ 키보드 입력 및 매핑

- 실시간 키보드 입력 감지 및 시각화
- 커스텀 키 매핑 설정

### 🎨 키 스타일 커스터마이징

- 그리드 기반 키 편집
- 이미지 할당 지원

### 🌧️ 노트 효과 (Raining Effect) 커스터마이징

- 노트 효과 스타일 커스터마이징
- 트랙 속도, 높이 및 리버스 모드 지원

### 🔢 키 카운터

- 키별 입력 횟수 표시
- 카운터 위치, 색상 및 스타일 커스터마이징

### 📊 입력 통계

- KPS, AVG, MAX, TOTAL 통계 표시
- KPS 그래프 시각화
- 통계 요소 및 그래프 스타일 커스터마이징

### 🎵 키음 기능

- 키 입력 시 사운드 효과 재생
- 사운드 파일 사용자 지정 지원

### 🖼️ 오버레이 및 창 관리

- 창 위치 고정 & 항상 위에 표시
- 리사이즈 기준점 선택

### 🖥️ OBS 모드

- OBS 브라우저 소스와 호환되는 모드

### 🧩 사용자 정의 CSS 및 플러그인 지원

- 사용자 정의 CSS로 완전히 커스터마이징 가능한 프로그램 인터페이스와 오버레이 스타일
- 커스텀 플러그인 기능 지원

### 💾 프리셋 및 설정 관리

- 사용자 설정 자동 저장
- 프리셋 저장/불러오기

### ⚙️ 기타 설정

- 다국어 인터페이스 지원 (한글, 영어, 중국어 간체/번체, 러시아어)
- 주요 기능 단축키 설정 지원
- 설정 초기화 및 자동 업데이트

## 📝 참고사항

- **이 프로그램은 스트리밍이나 플레이 영상 제작 등에 자유롭게 사용 가능합니다.**
- [macOS 설치 및 권한 설정 가이드](https://github.com/DmNote-App/DmNote/blob/master/docs/mac_guide.md)
- 프로그램 기본 설정은 `%appdata%/com.dmnote.desktop` 폴더에 저장됩니다.
- 오버레이를 실시간으로 직접 확인할 필요가 없고 스트리밍이나 플레이 영상 제작 등에 사용한다면 기본적으로 **OBS 모드** 사용을 권장합니다. 이는 일반 오버레이 모드보다 게임 프레임에 대한 악영향을 줄일 수 있습니다.
- 만약 게임용 컴퓨터와 스트리밍/녹화용 컴퓨터가 분리되어 있는 환경이라면 게임용 컴퓨터에서 DM Note를 실행하고 스트리밍/녹화용 컴퓨터에서 OBS 브라우저 소스로 연결하여 사용하는 것을 추천합니다. 이 경우 키뷰어로 인해 발생하는 게임 프레임 저하 문제를 거의 완전히 해결할 수 있습니다.
- **항상 위에 표시** 기능을 활성화해도 일부 게임의 전체화면에서는 오버레이가 게임에 가려집니다. 이 경우 테두리 없는 창 모드를 사용해주세요.
- 공식 플러그인과 CSS 예제 파일은 `assets.zip` 파일에 포함되어 있습니다.
- **신뢰할 수 없는 플러그인은 절대 불러오지 마세요.** 비공식적인 플러그인을 사용할 때는 ChatGPT 등의 도구를 사용하여 해당 플러그인이 안전한지 반드시 확인 후 사용하세요.
- 클래스명 할당 시 선택자는 제외하고 이름만 입력하세요. (`blue` ✅, `.blue` ❌)

## 🚀 개발

### 기술 스택

- **프론트엔드**: React 19 + Typescript + Vite 7
- **백엔드**: Tauri
- **스타일링**: Tailwind CSS 3
- **입력 감지**: Raw Input API (Windows), 전역 입력 이벤트 (macOS)
- **패키지 매니저**: npm

### 기본 설치 및 실행

터미널에서 다음 명령어를 순서대로 입력하세요.

```bash
git clone https://github.com/lee-sihun/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

### Windows ASIO 빌드

Windows에서는 `npm run tauri:dev` / `npm run tauri:build`에 키음 ASIO 출력이 기본 포함됩니다 (npm 스크립트가 `asio-backend` 피처를 활성화).

ASIO 포함 빌드에는 일반 종속성에 더해 다음이 필요합니다.

- **LLVM/Clang**: ASIO 헤더 바인딩 생성(bindgen)에 사용됩니다. LLVM을 설치하고(`winget install LLVM.LLVM` 또는 `scoop install llvm`), 환경 변수 `LIBCLANG_PATH`를 LLVM의 `bin` 폴더 경로로 설정하세요.
- **ASIO SDK**: Steinberg ASIO SDK가 저장소에 포함되어 있어(`src-tauri/vendor/asio-sdk`) 자동으로 사용됩니다. 별도 설정이나 네트워크 연결이 필요 없으며, 다른 SDK를 쓰려면 `CPAL_ASIO_DIR` 환경 변수로 재정의할 수 있습니다.

ASIO 없이 빌드하려면(LLVM 불필요 — 기여 시 편리) `npm run tauri:dev:no-asio` / `npm run tauri:build:no-asio`를 사용하세요. `src-tauri`에서 직접 실행하는 `cargo check` / `cargo build`도 기본적으로 ASIO를 포함하지 않으며, ASIO 코드 경로까지 검사하려면 `--features asio-backend`를 붙이세요.

> 이 저장소는 Steinberg ASIO SDK를 듀얼 라이선스 중 GPLv3 옵션으로 사용합니다. 자세한 내용은 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)를 참고하세요. _ASIO is a trademark of Steinberg Media Technologies GmbH, registered in Europe and other countries._

## 🤝 기여하기

여러분의 참여를 환영합니다! 자세한 내용은 [기여 가이드](CONTRIBUTING.md)를 확인해주세요.

### ✨ 기여자

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/lee-sihun"><img src="https://avatars.githubusercontent.com/u/111095268?v=4?s=100" width="100px;" alt="이시훈"/><br /><sub><b>이시훈</b></sub></a><br /><a href="#maintenance-lee-sihun" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/eun-yeon"><img src="https://avatars.githubusercontent.com/u/173552527?v=4?s=100" width="100px;" alt="연우"/><br /><sub><b>연우</b></sub></a><br /><a href="#design-eun-yeon" title="Design">🎨</a> <a href="#ideas-eun-yeon" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/mohong2"><img src="https://avatars.githubusercontent.com/u/150683765?v=4?s=100" width="100px;" alt="mo_hong"/><br /><sub><b>mo_hong</b></sub></a><br /><a href="#translation-mohong2" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/LSVoiid"><img src="https://avatars.githubusercontent.com/u/187824877?v=4?s=100" width="100px;" alt="LSVoiid"/><br /><sub><b>LSVoiid</b></sub></a><br /><a href="#translation-LSVoiid" title="Translation">🌍</a> <a href="https://github.com/DmNote-App/DmNote/commits?author=LSVoiid" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/kahyou22"><img src="https://avatars.githubusercontent.com/u/136758821?v=4?s=100" width="100px;" alt="문주"/><br /><sub><b>문주</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=kahyou22" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dustingusius"><img src="https://avatars.githubusercontent.com/u/128625716?v=4?s=100" width="100px;" alt="dustingusius"/><br /><sub><b>dustingusius</b></sub></a><br /><a href="#translation-dustingusius" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dotoritos-kim"><img src="https://avatars.githubusercontent.com/u/14037015?v=4?s=100" width="100px;" alt="Dotoritos"/><br /><sub><b>Dotoritos</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=dotoritos-kim" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/KGH1113"><img src="https://avatars.githubusercontent.com/u/123816263?v=4?s=100" width="100px;" alt="KGH1113"/><br /><sub><b>KGH1113</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=KGH1113" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## 📄 라이선스

[GPL-3.0 License Copyright (C) 2024 lee-sihun](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)

## ❤️ Special Thanks!

- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)

<!--
## 🔜 업데이트 예정

- 키 입력 카운트, 입력 속도 시각화
- 동시 입력 간격 밀리초(ms) 표시
- 입력 통계 분석 기능
 -->
