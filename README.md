<div align="center">
  <img src="build/icon.ico" alt="dmnote Logo" width="120" height="120">

  <h1>DM Note</h1>
  
  <p>
    <strong>리듬게임을 위한 실시간 키 입력 표시 프로그램</strong>
  </p>
  <p>
    <strong>사용자 정의 키 매핑과 스타일링, 손쉽게 전환 가능한 프리셋, 모던하고 직관적인 인터페이스</strong>
  </p>
  
  [![GitHub release](https://img.shields.io/github/release/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases)
  [![GitHub downloads](https://img.shields.io/github/downloads/lee-sihun/DmNote/total.svg?logo=github)]()
  [![GitHub license](https://img.shields.io/github/license/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/blob/main/LICENSE)
</div>

## 🌟 개요 
**DM Note**는 리듬게임에서 사용하기 위해 만들어진 실시간 키 입력 표시 프로그램입니다. Electron과 React로 구축 되었으며 
키보드 후킹을 위해 [node-global-key-listener-extended](https://github.com/lee-sihun/node-global-key-listener) 패키지를 사용합니다. 
다양한 사용자 정의 기능을 지원하고 간편한 설정으로 스트리밍이나 플레이 영상 제작 시 키 입력을 시각적으로 보여줄 수 있습니다.

Windows 환경이라면 이외의 다른 게임에서도 사용이 가능합니다.

## 🚀 실행 방법
[DM NOTE v 1.1.0 다운로드](https://github.com/lee-sihun/djmax-keyviewer/releases/download/1.1.0/DM.NOTE.v.1.1.0.zip) 

```bash
git clone https://github.com/lee-sihun/djmax-keyviewer.git
cd djmax-keyviewer
npm i
npm run start
```

## 🛠 기술 스택

- **프레임워크**: Electron
- **UI 라이브러리**: React
- **상태 관리**: Zustand
- **스타일링**: Tailwind CSS
- **번들러**: Webpack
- **키보드 후킹**: [node-global-key-listener-extended](https://github.com/lee-sihun/node-global-key-listener) 
- **세팅 저장**: electron-store
- **빌드**: electron-builder

## ✨ 주요 기능

- 실시간 키보드 입력 감지 및 표시
- 커스텀 키 매핑 설정
- 4/5/6/8키 모드 지원
- 키 위치 자유 배치
- 사용자 맞춤 테마 지원 (활성/비활성)
- 프리셋 저장/불러오기
- GPU 가속 설정
- ANGLE 그래픽 백엔드 설정
  - Direct3D 11/9
  - OpenGL
- 오버레이 기능
  - 항상 위에 표시
  - 창 위치 고정
  - 위치 저장
- 키 사이즈 커스터마이징 
- 노트 효과 표시 (Raining Effect)
- 노트 효과 색상, 투명도, 라운딩, 속도 조정
- 커스텀 CSS 기능 

## 🔜 업데이트 예정

- 키 입력 카운트 표시 
- 동시 입력 간격 밀리초(ms) 표시
- 키 입력 속도 그래프 시각화
- 입력 통계 분석 기능

## 🖼️ 스크린샷

<!--img src="./images/1748967984.gif" alt="Note Effect" width="700"-->

<img src="./images/2025-08-29_12-07-12.webp" alt="Note Effect" width="700">

<!--img src="https://i.postimg.cc/L41mTJLR/key.gif" alt="키뷰어 데모 1" width="700">

<img src="https://i.postimg.cc/RFGZxyCm/2.gif" alt="키뷰어 데모 1" width="700">

<img src="https://i.postimg.cc/wv9jPgpF/3.gif" alt="키뷰어 데모 2" width="700"-->

<img src="./images/1.webp" alt="키뷰어 데모 1" width="700">

<img src="./images/2025-09-03_22-52-19.webp" alt="키뷰어 데모 2" width="700">

<img src="./images/2025-08-29_13-38-24.webp" alt="키뷰어 데모 3" width="700">

<!-- 
![Note Effect](./images/1748967984.gif)

![키뷰어 데모 1](https://i.postimg.cc/L41mTJLR/key.gif)

![키뷰어 데모 2](https://i.postimg.cc/RFGZxyCm/2.gif)

![키뷰어 데모 3](https://i.postimg.cc/wv9jPgpF/3.gif)
-->

## 📝참고사항

- 그래픽 문제 발생 시 설정에서 렌더링 옵션을 변경해주세요.
- OBS 윈도우 캡쳐로 크로마키 없이 배경을 투명하게 불러올 수 있습니다.
- 게임 화면 위에 표시할 경우, **항상 위에 표시**로 배치한 뒤 **오버레이 창 고정**을 활성화해주세요.
- 기본 제공 프리셋은 resources > resources > presets 폴더에 있습니다.
- 커스텀 CSS 예제 파일은 resources > resources 폴더에 있습니다.
- 키 설정 기능에 클래스명 할당 시 선택자 없이 이름만 입력하면 됩니다.(blue -> o, .blue -> x)






