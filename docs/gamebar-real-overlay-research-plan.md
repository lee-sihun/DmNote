# Game Bar / Real Overlay 대체 경로 조사 계획

> 작성일: 2026-03-14
> 목적: Xbox Game Bar UWP 셸 없이 전체화면 게임 위 오버레이를 올릴 수 있는 Windows 내부 경로 후보 조사
> 상태: 가설 정리 및 조사 순서 정의

---

## 1. 배경

현재 DmNote는 다음 구조로 Xbox Game Bar 오버레이 실험 지원이 가능하다.

- 본체: Tauri 앱
- Game Bar 셸: `GameBarOverlay` UWP 앱
- 렌더링: 기존 OBS 웹 UI 재사용

이 구조는 기능적으로는 동작하지만 다음 제약이 있다.

- UWP / MSIX 배포 필요
- Game Bar 자체 의존
- Store 또는 sideload 설치 UX 부담

따라서 장기적으로는 `HudSight Real Overlay`와 비슷한 `비공개 Windows compositor 경로`가 있는지 조사할 가치가 있다.

---

## 2. 현재 가설

### 2.1 가능성이 높은 경로

우선순위 기준으로는 아래 순서가 가장 현실적이다.

1. `Window Band` 계열
   - 후보: `CreateWindowInBand`, `CreateWindowInBandEx`, `SetWindowBand`, `GetWindowBand`
   - 목적: 일반 `TOPMOST`보다 높은 Z-band 확보

2. `DirectComposition` 계열
   - 목적: DWM 합성 레이어에 직접 시각 요소를 올리는지 확인

3. `DWM private swapchain / undocumented interface` 계열
   - 후보: `IDXGISwapChainDWMLegacy` 류 내부 인터페이스
   - 목적: DWM의 실제 합성 경로에 직접 그리는지 확인

4. `Game Bar private contract` 계열
   - 가능성은 상대적으로 낮음
   - 이유: UWP host / activation / package 계약까지 통째로 흉내 내는 것은 유지보수성이 너무 낮음

### 2.2 현재 추정

`HudSight Real Overlay`가 Xbox Game Bar의 비공개 API를 직접 재사용한다기보다,
`Game Bar도 결국 의존할 더 하부의 DWM / composition / window band 경로`를 건드릴 가능성이 더 높다.

---

## 3. 조사 목표

이번 조사의 목표는 다음 셋 중 하나를 명확히 판정하는 것이다.

1. `일반 Win32 앱만으로 재현 가능한 경로가 있다`
2. `관리자 권한 + 비공개 API 수준까지는 가능하지만 제품 탑재는 비현실적이다`
3. `현실적인 제품 경로는 여전히 Xbox Game Bar가 최선이다`

---

## 4. 조사 우선순위

### 4.1 1차

- Game Bar 실행 시 어떤 프로세스 / HWND / window band / composition 경로를 타는지 관찰
- `CreateWindowInBand` 계열 흔적 확인
- DWM 관련 undocumented export 사용 여부 확인

### 4.2 2차

- `dwm.exe` 또는 관련 시스템 프로세스 주입 없이는 재현이 어려운지 판정
- Game Bar와 HudSight류 제품이 공통으로 사용할 법한 저수준 그래픽 경로 후보 축소

### 4.3 3차

- 최소 프로토타입 가능 여부 검토
- 프로토타입이 필요하면 `시스템 전체 오버레이`와 `특정 게임 fullscreen overlay`를 분리해서 평가

---

## 5. Codex 자동 조사 가능 항목

아래는 저장소 안 작업 또는 로컬 머신에서 자동화 스크립트로 확인 가능한 범위다.

### 5.1 정적 조사

- Windows 시스템 DLL export 목록 확인
  - `user32.dll`의 `CreateWindowInBand*`, `SetWindowBand`, `GetWindowBand`
  - `dwmapi.dll`, `dxgi.dll` 관련 export
- Game Bar 관련 설치 파일 / 패키지 구조 확인
- 공개 OSS 저장소 정적 분석
  - `Dwm-Overlay`
  - `dwm_overlay`
  - `goverlay`
  - `hudhook`

### 5.2 자동 수집 스크립트

- 실행 중인 Game Bar 관련 프로세스 목록 수집
- 관련 윈도우 클래스 / 핸들 / 스타일 수집
- 특정 프로세스 로드 모듈 목록 수집
- `Win32 API export 존재 여부` 체크 스크립트 작성
- `GameBarOverlay` 실험 셸과 비교용 메타데이터 정리

### 5.3 로컬에서 자동으로 재현 가능한 비교 실험

- DmNote Game Bar 셸 실행 상태와 일반 topmost 창의 HWND 속성 비교
- Game Bar 실행 전후 프로세스 / 모듈 차이 비교
- 로컬 머신 기준 fullscreen borderless 상태에서 일반 overlay 한계 확인

### 5.4 자동화 한계

다음은 자동화만으로 결론 내리기 어렵다.

- undocumented API 호출 시점 추적
- DWM 내부 COM / swapchain 경로 판정
- 상용 앱의 실시간 렌더 경로 추적
- anti-cheat 민감 환경 재현

---

## 6. 사용자가 수동으로 해야 하는 조사

아래는 권한, GUI 도구, 디버거, 상용 앱 실행이 필요해서 수동 개입이 필요한 영역이다.

### 6.1 관리자 권한이 필요한 작업

- `WinDbg` 또는 `x64dbg`로 관련 프로세스 attach
- `API Monitor`로 undocumented 함수 호출 추적
- `dwm.exe` 또는 시스템 프로세스 관찰
- 필요 시 ETW / GPUView 세션 시작

### 6.2 GUI 도구 관찰

- `Spy++`로 Game Bar 실행 중 생성되는 HWND 조사
- `Process Explorer`로 Game Bar / DWM 모듈 로드 상태 확인
- `WinObj` 또는 유사 도구로 커널 오브젝트 / named object 힌트 확인

### 6.3 상용 앱 비교 관찰

- HudSight 설치 후 모드별 동작 비교
  - Hooks
  - Simple Overlay
  - Xbox Game Bar
  - Real Overlay
- 모드 전환 시 관리자 권한 요구 여부, 프로세스 변화, 화면 노출 방식 비교

### 6.4 수동으로만 가능한 핵심 질문

- `Real Overlay`가 정말 게임 무주입인지
- 게임 대신 `dwm.exe` 또는 다른 시스템 프로세스 쪽에 붙는지
- `Window Band`만으로 되는지, `DWM private rendering path`까지 들어가는지

---

## 7. 추천 조사 절차

### 1단계: 저비용 확인

- Game Bar 실행 상태에서 관련 HWND / 프로세스 / 모듈 확인
- undocumented export 존재 여부 스크립트로 정리
- Game Bar가 일반 topmost와 다른 band를 쓰는지부터 확인

### 2단계: 호출 추적

- `API Monitor`로 `CreateWindowInBand*`, `SetWindowBand`, `DCompositionCreateDevice*` 관찰
- Game Bar 오픈 직후 호출 패턴 기록

### 3단계: DWM 경로 확인

- `WinDbg` 또는 `x64dbg`로 `dwm.exe` / 관련 프로세스 호출 스택 관찰
- private DXGI / DComp 경로 흔적 확인

### 4단계: HudSight 비교

- `Real Overlay` 사용 전후 관리자 권한 / 프로세스 / 로드 모듈 / 화면 캡처 반응 비교
- Game Bar와 공통점, 차이점 정리

### 5단계: 제품 판단

- 재현 가능하더라도 다음 조건을 못 넘으면 제품 탑재 보류
  - Windows 빌드 종속성 과도
  - 관리자 권한 상시 필요
  - 안티치트 / 보안 제품 충돌 가능성 큼
  - 배포 / 업데이트 경로가 Game Bar보다 더 나쁨

---

## 8. 성공 기준

다음 중 하나를 얻으면 조사 성과로 본다.

- `전체화면 overlay`를 가능하게 하는 핵심 Windows 경로 후보를 1~2개로 좁힘
- Game Bar와 무관한 독립 경로의 존재를 정황상 입증
- 현실적인 제품 경로가 아니라는 근거를 확보하여 조사 종료 판단

---

## 9. 중단 기준

아래 조건이면 추가 리버싱을 멈추는 것이 합리적이다.

- `dwm.exe` 주입 또는 시스템 프로세스 후킹이 사실상 필수
- Windows 빌드별 오프셋 갱신이 반복적으로 필요
- 관리자 권한 + 보안 제품 예외 없이는 실사용이 어려움
- 기존 Game Bar 방식 대비 명확한 제품 이점이 없음

---

## 10. 현재 권장 전략

현 시점에서는 다음 전략이 가장 현실적이다.

1. 제품 기능은 `Xbox Game Bar 셸` 유지
2. 내부 연구는 `Window Band + DirectComposition + DWM` 순서로 진행
3. `HudSight Real Overlay`는 참고 사례로만 취급
4. hook / injection 계열은 별도 실험 브랜치에서만 검토

즉, 당장 제품 경로를 갈아엎기보다는 `현재 Game Bar 구현을 유지하면서 대체 경로를 조사`하는 것이 맞다.

---

## 11. 참고 자료

- Xbox Game Bar 개요
  - https://learn.microsoft.com/en-us/gaming/game-bar/overview
- DirectComposition 개요
  - https://learn.microsoft.com/en-us/windows/win32/directcomp/directcomposition-portal
- undocumented user32 export 목록 참고
  - https://gist.github.com/wbenny/123a41973af776df9c7d5610586b9e9d
- HudSight Real Overlay 설명
  - https://hudsight.com/support/real-overlay-crosshair-overlay/
- HudSight 지원 문서
  - https://hudsight.com/support/
- DWM overlay 계열 공개 사례
  - https://github.com/Yukin02/Dwm-Overlay
  - https://github.com/wongfei/dwm_overlay

