## 🎹 DM NOTE

DJMAX 실시간 키 입력 표시 프로그램입니다.  
스트리밍이나 플레이 영상 제작 시, 키 입력을 시각적으로 보여줄 수 있습니다.

## 🚀 실행 방법
[DM NOTE v 1.0.4 다운로드](https://github.com/lee-sihun/djmax-keyviewer/releases/download/1.0.4/DM.NOTE.v.1.0.4.zip) 

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
- **키보드 후킹**: node-global-key-listener
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
- 노트 효과 색상, 투명도 조정

## 🔜 업데이트 예정

- 키 입력 카운트 표시 
- 동시 입력 간격 밀리초(ms) 표시
- 키 입력 속도 그래프 시각화
- 입력 통계 분석 기능

## 🖼️ 스크린샷

![키뷰어 데모 1](https://i.postimg.cc/L41mTJLR/key.gif)

![키뷰어 데모 2](https://i.postimg.cc/RFGZxyCm/2.gif)

![키뷰어 데모 3](https://i.postimg.cc/wv9jPgpF/3.gif)

## 📝참고사항

- 그래픽 문제 발생 시 설정에서 렌더링 옵션을 변경해주세요.
- 키보드 후킹 라이브러리로 인해 바이러스 오진이 있을 수 있습니다. [(관련 이슈)](https://github.com/LaunchMenu/node-global-key-listener?tab=readme-ov-file#disadvantages-2)
  - 1.0.5 버전부터 해당 라이브러리의 포크 된 버전을 사용합니다. [바로가기](https://github.com/lee-sihun/node-global-key-listener) 
- OBS 윈도우 캡쳐로 크로마키 없이 배경을 투명하게 불러올 수 있습니다.
- 게임 화면 위에 표시할 경우, **항상 위에 표시**로 배치한 뒤 **오버레이 창 고정**을 활성화해주세요.
- 기본 제공 프리셋은 resources > resources > presets 폴더에 있습니다.
- 노트 효과 기능 활성화 후 키 상단에 충분한 공간을 확보해주세요. 
