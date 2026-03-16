# Game Bar / Real Overlay 조사 결과

> 작성일: 2026-03-14
> 범위: 자동화 가능한 정적 조사 + 로컬 런타임 관찰
> 상태: 1차 수집 완료

---

## 1. 조사 요약

현재 자동 조사 결과만 놓고 보면, Xbox Game Bar는 단순한 UWP 위젯 호스트가 아니라 아래 요소를 함께 가진다.

- `GameBar.exe` UWP 앱
- `GameBarFTServer.exe` COM 서버
- `GameBarElevatedFT.exe` FullTrust 실행 별칭
- `gameBarServices`, `runFullTrust` 같은 제한 기능
- `dxgi`, `dcomp`, `Win2D` 계열 구성 요소

즉, Game Bar 방식은 단순히 `UWP 창 하나 띄우기` 수준이 아니라 `패키지 권한 + COM 서버 + FullTrust 보조 프로세스 + composition 계층`이 결합된 구조로 보인다.

---

## 2. 자동 조사 결과

### 2.1 패키지 정보

- 패키지: `Microsoft.XboxGamingOverlay_7.325.10021.0_x64__8wekyb3d8bbwe`
- 설치 경로: `C:\Program Files\WindowsApps\Microsoft.XboxGamingOverlay_7.325.10021.0_x64__8wekyb3d8bbwe`

### 2.2 AppxManifest에서 확인된 핵심 단서

- `windows.protocol`
  - `ms-gamingoverlay`
  - `ms-gamebar`
- `windows.comServer`
  - `GameBarFTServer.exe`
- `windows.appExecutionAlias`
  - `GameBarElevatedFT_Alias.exe`
- `windows.appExtensionHost`
  - `microsoft.gameBarUIExtension`
- 제한 기능
  - `gameBarServices`
  - `runFullTrust`
  - `extendedExecutionUnconstrained`
  - `packageManagement`
  - `packageQuery`

### 2.3 로드 모듈

자동 수집 기준으로는 아래가 확인됐다.

- `GameBar.exe`
  - `dxgi.dll`
  - `dcomp.dll`
  - `user32.dll`
  - `combase.dll`
- `GameBarFTServer.exe`
  - `dxgi.dll`
  - `user32.dll`
  - `combase.dll`
- `Widgets.exe`
  - `dcomp.dll`
  - `user32.dll`
  - `combase.dll`

이건 최소한 `Game Bar가 composition / DXGI 계층을 실제로 사용`한다는 정황으로 볼 수 있다.

### 2.4 Windows export 존재 여부

로컬 `user32.dll`에는 아래 undocumented export가 존재한다.

- `CreateWindowInBand`
- `CreateWindowInBandEx`
- `GetWindowBand`
- `SetWindowBand`

로컬 `dwmapi.dll`에는 아래 export가 존재한다.

- `DwmpDxGetWindowSharedSurface`
- `DwmpDxUpdateWindowSharedSurface`
- `DwmpDxgiIsThreadDesktopComposited`

즉 `window band`와 `DWM shared surface` 경로 자체는 OS에 실제로 존재한다.

### 2.5 Game Bar 바이너리 import 흔적

정적 import 기준으로는 아래가 확인됐다.

- `GameBar.exe`
  - `GetProcAddress`
  - `LoadLibraryExW`
  - `LoadPackagedLibrary`
  - `RoGetActivationFactory`
  - `CreateDXGIFactory2`
- `GameBarFTServer.exe`
  - `GetProcAddress`
  - `LoadLibraryA`
  - `LoadLibraryExW`
  - `RoGetActivationFactory`
  - `CreateDXGIFactory1`
  - `CreateDXGIFactory2`

반면 아래는 `정적 import`나 단순 문자열 검색으로는 직접 확인되지 않았다.

- `CreateWindowInBand`
- `SetWindowBand`
- `GetWindowBand`
- `DCompositionCreateDevice`
- `IDXGISwapChainDWMLegacy`

이건 두 가지 가능성을 남긴다.

1. 실제로는 다른 모듈 또는 WinRT/COM 래퍼를 통해 우회 사용
2. `GetProcAddress` 또는 내부 계약을 통해 동적으로 호출

즉 `직접 import가 없으니 안 쓴다`고 결론 내릴 수는 없다.

### 2.6 바이너리 문자열 흔적

`strings64` 기준으로는 다음 정황이 추가로 확인됐다.

- `GameBar.exe`
  - `Windows.GameBarUIExtension`
  - `AppExtension-microsoft.gameBarUIExtension`
  - `microsoft.gameBarUIExtension`
  - 여러 `IXboxGameBarWidgetHost*` 구현체 이름
- `GameBarFTServer.exe`
  - `IsProcessFse`
  - `SwapChain`
  - `DwmProcessID`
  - `DXGI`

이건 적어도 다음 정도를 강하게 시사한다.

- `GameBar.exe`는 실제로 widget host / app extension 계약을 내부에서 직접 다룬다
- `GameBarFTServer.exe`는 fullscreen 판정과 swapchain / DXGI 관련 처리를 담당할 가능성이 높다

### 2.7 FT 서버 진단 로그

패키지 `LocalState\\DiagOutputDir`에서 Game Bar가 자체 진단 로그를 남기는 것도 확인됐다.

- 최근 파일 예시
  - `XboxGamingOverlayTraces_FT_Server_20260314010120.txt`
  - `GameBar_20260314094822_Sh.etl`

특히 FT 서버 텍스트 로그에서 다음 패턴이 반복적으로 보였다.

- `CaptureCurrentTarget`
- `GetFocusedHwnd`
- `RegisterFullscreenCheckTimer`
- `IsProcessFse`
- `IsWindowFullscreenOnMonitor`
- `UpdateAllTargetData`
- `UpdateIsFullscreenTargetData`
- `OnWinEvent`
- `InputFocusInfo`

실제 로그에는 이런 정보가 들어 있다.

- 현재 포커스 HWND
- 대상 프로세스 이미지 이름
- 대상 창 클래스 이름
- 모니터 크기와 창 크기 비교
- `IsFullscreen`
- `IsFse`

즉 Game Bar FT 서버는 최소한 아래 로직을 자체적으로 수행한다.

1. 현재 포커스 윈도우 추적
2. 전체화면 여부 판정
3. FSE 여부 판정
4. 대상 프로세스 / HWND / 창 클래스 갱신

이건 `Game Bar가 단순히 위젯만 띄우는 게 아니라, 활성 게임 창 판정과 fullscreen 추적을 따로 갖고 있다`는 강한 증거다.

### 2.8 Procmon 캡처 기반 추가 정황

`Procmon`을 headless로 캡처한 뒤 Game Bar 관련 프로세스만 요약해봤다.

#### 프로세스 비중

- `GameBar.exe`
- `GameBarFTServer.exe`
- `XboxPcAppFT.exe`
- `Widgets.exe`
- `WidgetService.exe`

최근 캡처 기준으로는 `GameBar.exe`와 `GameBarFTServer.exe`가 대부분의 I/O를 차지했다.

#### GameBar.exe가 직접 하는 일

- `C:\ProgramData\NVIDIA Corporation\Drs\*` 접근
  - `nvdrsdb0.bin`
  - `nvdrssel.bin`
  - file mapping까지 수행
- `Google Play Games` 클라이언트 바이너리 접근
- AppModel / Appx / StateRepository / CloudStore 레지스트리 대량 조회

이 정황은 `GameBar.exe`가 단순 UI가 아니라
`그래픽 환경 / 앱 패키지 상태 / 런처 존재 여부`를 스캔하는 역할도 가진다는 쪽과 맞는다.

#### GameBarFTServer.exe가 직접 하는 일

- `D:\Program Files\steam\steamapps` 순회
- `appmanifest_*.acf` 파일 열기 / 읽기
- `HKLM\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration` 접근
- `HKCU\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration` 생성
- FT 서버 진단 로그 파일에 지속적 `WriteFile`

이 정황은 `GameBarFTServer.exe`가 적어도 다음 역할을 가진다는 쪽으로 읽힌다.

1. 설치된 게임 탐지
2. fullscreen 대상 판정
3. GamingConfiguration 정책 조회
4. 진단 로그 / 상태 기록

즉 `GameBar.exe = UI/composition + 환경 스캔`, `GameBarFTServer.exe = 게임/대상 추적 + 설정/로그 + Steam 스캔` 정도로 역할이 갈릴 가능성이 높다.

### 2.9 ListDLLs / 문자열 기반 추가 단서

`Listdlls64`와 `strings64` 기준으로는 아래 정황도 확인됐다.

#### GameBar.exe

- `dcomp.dll` 로드
- `dxgi.dll` 로드
- `Windows.Gaming.Input.dll` 로드
- `Windows.GameBarUIExtension` 문자열
- 여러 `IXboxGameBarWidgetHost*` 구현 흔적

#### GameBarFTServer.exe

- `dxgi.dll` 로드
- `Windows.Storage.ApplicationData.dll` 로드
- `Windows.Storage.Search.dll` 로드
- `SwapChain`
- `DwmProcessID`
- `IsProcessFse`

이 조합은 다음 추정을 강화한다.

- UI / 합성 관련 코드는 `GameBar.exe`
- 대상 창 추적 / 게임 탐지 / fullscreen 판정은 `GameBarFTServer.exe`

### 2.10 프로세스 계보 / 커맨드라인

`Win32_Process` 조회 기준으로 Game Bar 관련 프로세스는 대부분 `svchost.exe` 자식으로 떠 있었다.

- 부모 PID: `1128`
- 서비스 그룹:
  - `BrokerInfrastructure`
  - `DcomLaunch`
  - `PlugPlay`
  - `Power`
  - `SystemEventsBroker`

대표 커맨드라인:

- `GameBarFTServer.exe`
  - `-Embedding`
- `WidgetService.exe`
  - `-RegisterProcessAsComServer -Embedding`
- `Widgets.exe`
  - `-ServerName:Microsoft.Windows.DashboardServer`
- `GameBarPresenceWriter.exe`
  - `-ServerName:Windows.Gaming.GameBar.Internal.PresenceWriterServer`

이건 Game Bar 계열이 단순 앱 실행이 아니라
`COM server / brokered activation / background infrastructure` 패턴을 강하게 쓴다는 뜻으로 볼 수 있다.

### 2.11 HWND / band 관찰

자동 HWND 열거에서는 다음 정도만 확인됐다.

- 백그라운드 Game Bar 관련 top-level window 존재
- 관찰된 창들의 `band` 값은 `1`
- 현재 자동 수집만으로는 Game Bar 실제 표시 UI의 별도 top-level overlay HWND를 잡지 못함

이 부분은 수동 GUI 관찰이 필요하다.

가능한 이유:

- Game Bar 실제 UI가 별도 시점에만 생성
- child window / XAML island / composition visual 형태
- top-level HWND가 아닌 다른 경로 사용

### 2.12 ETW provider 흔적

자동 조회 기준으로는 아래 ETW provider가 존재한다.

- `Microsoft-Windows-Dwm-Api`
- `Microsoft-Windows-Dwm-Compositor`
- `Microsoft-Windows-Dwm-Core`
- `Microsoft-Windows-Dwm-Dwm`
- `Microsoft-Windows-Dwm-Redir`
- `Microsoft-Windows-Dwm-Udwm`
- `Microsoft-Windows-DirectComposition`

반면 `*GameBar*`, `*Xbox*` 이름으로 바로 노출되는 provider는 찾지 못했다.

이 의미는 다음과 같다.

- 다음 단계 수동 추적은 `Game Bar 전용 provider`보다 `DWM / DirectComposition` 쪽에서 시작하는 편이 낫다
- Game Bar 내부 흐름도 결국 ETW 상에서는 하부 composition 계층에서 더 잘 보일 가능성이 높다

### 2.13 WinMD / IDL 메타데이터 덤프

패키지 내부 `winmd`를 `winmdidl.exe`로 직접 덤프해서 public / private / FT 표면을 확인했다.

- 덤프 대상
  - `XboxGameBarFT.winmd`
  - `Microsoft.Gaming.XboxGameBar.winmd`
  - `Microsoft.Gaming.XboxGameBar.Private.winmd`
- 산출물
  - `docs/artifacts/winmdidl/XboxGameBarFT.idl`
  - `docs/artifacts/winmdidl/Microsoft.Gaming.XboxGameBar.idl`
  - `docs/artifacts/winmdidl/Microsoft.Gaming.XboxGameBar.Private.idl`

여기서 드러난 핵심은 `XboxGameBarFT`가 생각보다 노골적으로
`FullTrust helper surface`를 제공한다는 점이다.

#### XboxGameBarFT에서 확인된 핵심 타입

- `IGbftFactory`
- `IAppTargetManagerFT`
- `IInputFocusTrackerFT`
- `IWindowManagerFT`
- `IThirdPartyLauncherDataProvider`
- `IGameConfigStoreFT`
- `IPresentMonFpsMonitor`
- `IGfxPerfFpsMonitor`

즉 FT 서버 쪽은 최소한 다음 축을 명시적으로 가진다.

1. 대상 게임 추적
2. 입력 포커스 추적
3. FPS 모니터링
4. 런처별 게임 데이터 공급
5. 윈도우 스타일 / 영역 / 클릭스루 조작

#### AppTargetInfo 구조

`AppTargetInfo`에는 아래 필드가 있다.

- `AumId`
- `DisplayName`
- `Hwnd`
- `InputHwnd`
- `ImageName`
- `ImageNameFullPath`
- `IsFse`
- `IsFullscreen`
- `IsInputDelegationSupported`
- `IsPackaged`
- `ProcessId`
- `InputProcessId`

이건 FT 서버 로그에서 이미 관찰한
`focused hwnd / image / fullscreen / fse / process id`와 거의 그대로 대응한다.

#### AppTargetManagerFT

`IAppTargetManagerFT`에는 아래 메서드가 있다.

- `StartTargetTrackerAsync`
- `StopTargetTrackerAsync`
- `RefreshCurrentTargetAsync`
- `Target`
- `TargetChanged`

즉 Game Bar의 대상 추적은 추측이 아니라,
메타데이터 상으로도 `독립된 FullTrust 타깃 트래커`가 존재한다고 볼 수 있다.

#### WindowManagerFT

`IWindowManagerFT`에는 아래 메서드가 있다.

- `EnableClickThrough`
- `DisableClickThrough`
- `GetWindowLong`
- `SetWindowLong`
- `SetWindowRegion`
- `ClearWindowRegion`
- `ShowWindow`

이건 매우 중요하다.

- Game Bar 내부 FT 계층은 실제로 `Win32 window style / region / click-through` 조작을 감싼다
- overlay UX에 필요한 핵심 윈도우 제어가 `privileged helper layer`로 이미 존재한다
- 반대로 `CreateWindowInBand` 같은 undocumented export가 메타데이터에 안 보인다는 점은,
  그런 호출이 아예 없다는 뜻보다는 `더 하부 구현 디테일로 숨겨져 있다`는 뜻에 가깝다

#### GbftFactory

`IGbftFactory`가 생성할 수 있는 객체도 의미가 크다.

- `CreateAppTargetManagerFT`
- `CreateWindowManagerFT`
- `CreateThirdPartyLauncherDataProvider`
- `CreatePresentMonFpsMonitor`
- `CreateGfxPerfFpsMonitor`
- `CreateGameConfigStoreFT`
- `CreateInputFocusTrackerFT`
- `CreateWinUserFT`
- `CreateMonitorUtils`
- `CreateRegistryWatcherFT`
- `CreateHamDependencyFT`

이 조합은 `GameBarFTServer.exe`가 단순 서비스 프로세스가 아니라,
`게임 감지 + 입력/포커스 + FPS + 윈도우 조작 + 런처 연동`을 한데 묶은 내부 플랫폼 레이어라는 해석과 잘 맞는다.

#### ThirdPartyLauncherDataProvider / GameConfigStoreFT

추가로 아래 메서드도 드러난다.

- `GetSteamLauncherInfoAsync`
- `GetEpicProductMapAsync`
- `GetEAGamesAsync`
- `AddEntryForHwnd`
- `EntryExistsForHwnd`
- `GetGcsIdForHwnd`
- `RemoveEntryForHwnd`

이건 Procmon에서 보였던 `steamapps` 순회와 `GamingConfiguration` 레지스트리 접근이
메타데이터 수준에서도 정합적이라는 뜻이다.

#### Public / Private SDK에서 보인 추가 단서

`Microsoft.Gaming.XboxGameBar.Private.idl` 기준:

- `GetAppTargetHost`
- `GetWindowBounds`
- `GetWindowState`
- `SetWindowState`
- `SetWindowBounds`
- `WaitForCompositionTargetRendered`
- `SetClickThroughEnabled`
- `SetRequestedOpacity`
- `EnableInputDelegation`
- `DisableInputDelegation`

`Microsoft.Gaming.XboxGameBar.idl` 기준:

- `SuppressedForFullScreenExclusive`
- `WindowBoundsChanged`
- `WindowStateChanged`
- `GameBarDisplayModeChanged`
- `RequestedOpacity`

즉 public SDK 바깥 private host 계약에는
`composition ready`, `window bounds`, `input delegation`, `opacity`, `click-through` 같은
실제 호스팅 세부 기능이 더 많이 숨어 있다.

### 2.14 깨끗한 Procmon 재실행 후 시작 순서

초기에는 `Procmon` 인스턴스가 누적되어 산출물이 비정상적으로 커졌는데,
캡처 스크립트에서 기존 인스턴스 정리와 종료 보장을 넣은 뒤 다시 측정했다.

가장 최근 clean capture 기준 초기 순서는 대략 이렇다.

1. `XboxPcAppFT.exe`
2. `GameBarFTServer.exe`
3. `GameBar.exe`

최근 패스에서는 최초 관찰 시점 차이가 약 `295ms` 안쪽이었다.

- `XboxPcAppFT.exe`
  - `gameplatformservices.dll` 탐색 시도
- `GameBarFTServer.exe`
  - FT 진단 로그 `WriteFile`
  - `GbftComFactory` 관련 `PackagedCom` 조회
- `GameBar.exe`
  - `ActivatableClassId` / `Server` 해석
  - 최종적으로 `GameBar.exe` 경로와 AUMID 해석

즉 실행 초반부터 이미:

- FT 서버
- Packaged COM
- AppModel activatable class
- main Game Bar app

이 4축이 같이 얽혀서 움직인다.

이건 `Game Bar private API 몇 개를 호출하면 끝` 같은 단순 모델보다,
`brokered activation + packaged full-trust helper + app model activation` 구조가 실제에 더 가깝다는 쪽을 강화한다.

### 2.15 Shell ETL 로그 해석

`GameBar_*_Sh.etl`은 `tracerpt`로 바로 CSV 변환이 가능했고,
대부분의 이벤트는 `Microsoft-Windows-Diagnostics-LoggingChannel` 문자열 로그였다.

최신 ETL 기준 특징:

- 총 이벤트 약 `1112`
- 그중 `LoggingChannel` 이벤트 약 `1110`
- 핵심 태그 상위
  - `WB`
  - `HPVM`
  - `PC`
  - `WM`
  - `SC`
  - `ATM`
  - `IDM`

즉 이 ETL은 단순 커널 추적보다
`Game Bar 내부 서브시스템 태그가 붙은 구조화 문자열 로그`에 가깝다.

#### ETL에서 직접 확인된 흐름

실제 메시지에는 아래 같은 순서가 보인다.

- `OnInitializeAsync: Calling StartFullTrustServer`
- `StartFullTrustServer: Called`
- `StartFullTrustServer: full trust pid(1860)`
- `InitializeUIAsync: Calling m_appTargetManager->InitializeAsync`
- `InitializeFtServerAsync: Calling m_appTargetManagerFT.InitializeAsync()`
- `OnInitializeAsync: Settings::IsClickThroughEnabled - [1]`
- `PinnedOnlyAsync: Set ClickThrough`
- `SetClickThrough: enabled(true)`
- `InitializeUIAsync: Calling m_inputDelegationManager->InitializeAsync`
- `UpdateWindowRegionForPinnedOnlyAsync: Called`
- `UpdateEmTargetDisplayToUse: Called. Calling GamingOverlayBroker::GetDisplayMonitors`
- `ResetWindowRect: Called. Calling GamingOverlayBroker::ResetWindowRect`

이걸 그대로 해석하면:

1. UI 프로세스가 FT 서버를 먼저 띄운다
2. FT 측 `AppTargetManagerFT`를 초기화한다
3. pinned-only 상태에서 click-through를 건다
4. target display / window rect는 `GamingOverlayBroker`를 통해 조정한다
5. input delegation manager도 별도로 초기화한다

즉 `ETL`, `WinMD`, `FT text log`, `Procmon`이 서로 같은 구조를 가리키기 시작했다.

#### 위젯 로딩 흐름

ETL에는 실제 위젯 로딩 흔적도 직접 나온다.

- `LoadInboxWidgets`
- `CreateAndAddWidgetAsync`
- `HandleWidgetAddedAsync`
- `InitializeInternal: Called. id(HomeWidget)`
- `InitializeInternal: Called. id(CaptureWidget)`
- `InitializeInternal: Called. id(GameLauncherWidget)`
- `Command_ActivateAsync: Called. id(HomeWidget), uri(ms-gamebar://launch/activate)`

즉 Game Bar는:

- inbox widget 세트를 로드하고
- hosted widget를 별도 단계에서 추가하고
- widget 단위로 activation / focus / window region 갱신을 수행한다

이건 `GameBar private API`만 단독으로 떼어다 쓰기 어려운 이유를 더 설명해 준다.

#### 런처 / 게임 탐지 정황

ETL 문자열에도 아래가 직접 드러난다.

- `Loaded icon for MRU item from steam exePath: ...`
- `GameLauncherWidget`

즉 Procmon에서 확인한 `steamapps` 순회는 우연이 아니라,
실제로 UI 계층에서도 `최근 게임 / 런처 연동` 쪽 데이터를 소비하고 있음을 시사한다.

### 2.16 윈도우 polling 결과

`EnumWindows + GetWindowBand + DwmGetWindowAttribute` 기반 polling도 추가했다.

- 스크립트
  - `scripts/gamebar/capture-gamebar-window-poll.ps1`
- 최신 smoke 산출물
  - `docs/artifacts/gamebar-window-poll-smoke.json`

현재 자동 polling에서 보인 정황은 이렇다.

- `GameBarFTServer.exe`
  - top-level로는 `.class.1`, `IME` 정도의 숨겨진 창만 관찰
- `Widgets.exe`
  - `WindowsDashboard`, `MessageWindowClass`, `IME` 계열 숨김 창 관찰
- `XboxPcAppFT.exe`
  - `.class.1`, `IME` 계열 숨김 창 관찰
- visible top-level은 오히려 `ApplicationFrameHost` 쪽 `ApplicationFrameWindow`가 더 눈에 띔

또한 최신 polling 기준:

- 새 top-level HWND 생성은 자동으로 포착하지 못함
- baseline 대비 `visible/cloaked/title/rect` 변화도 자동으로는 두드러지지 않음
- 관찰된 Game Bar 관련 프로세스의 top-level window `band`는 여전히 `1`

이 결과는 두 가지 해석으로 갈린다.

1. 실제 UI가 이미 떠 있던 shell / frame 경로를 재사용한다
2. top-level HWND가 아니라 composition / child / hosted view 경로에 더 가깝다

즉 현재 자동 polling만으로는
`별도 top-level 특권 창이 새로 생긴다`는 증거는 못 잡았고,
오히려 `숨김 유틸리티 창 + 별도 composition/hosted view` 가설 쪽이 더 무거워졌다.

### 2.17 패키지 구조 정리

패키지 매니페스트 자체를 별도 요약 스크립트로 다시 정리했다.

- 스크립트
  - `scripts/gamebar/summarize-gamebar-package.ps1`
- 산출물 예시
  - `docs/artifacts/gamebar-package-summary-20260314-202125.json`

여기서 추가로 확인된 핵심은 이렇다.

- 프로토콜
  - `ms-gamingoverlay`
  - `ms-gamebar`
- COM 서버
  - `GameBarFTServer.exe`
  - `GbftComFactory`
- 실행 별칭
  - `GameBarElevatedFT_Alias.exe`
- app extension host
  - `microsoft.gameBarUIExtension`
- in-process server
  - `Microsoft.Graphics.Canvas.dll`
  - `Microsoft.Web.WebView2.Core.dll`
  - `Xbox.Experimentation.dll`

특히 `Microsoft.Web.WebView2.Core.dll`이 패키지 안에 직접 포함되어 있고,
`CoreWebView2CompositionController`까지 activatable class로 등록돼 있다.

즉 Game Bar 패키지는 단순 XAML 셸이 아니라:

1. Win2D
2. WebView2
3. FullTrust COM 서버
4. widget app-extension host

를 한 패키지 안에 같이 가진다.

### 2.18 바이너리 정적 분석 보강

`dumpbin + strings64` 기반 요약도 따로 자동화했다.

- 스크립트
  - `scripts/gamebar/summarize-gamebar-binaries.ps1`
- 산출물 예시
  - `docs/artifacts/gamebar-binaries-summary-20260314-202125.json`

#### GameBar.exe

정적 import는 의외로 소박하다.

- `dxgi.dll`
  - `CreateDXGIFactory2`
- `user32.dll`
  - `GetAncestor`
  - `GetWindowPlacement`
  - `GetWindowThreadProcessId`

반면 문자열에는 내부 구조가 훨씬 많이 드러난다.

- `AppTargetManager`
- `InputDelegationManager`
- `TargetIsFullscreen`
- `InitializeFtServerAsync: Calling m_appTargetManagerFT.InitializeAsync()`
- `InitializeUIAsync: Calling m_inputDelegationManager->InitializeAsync`
- `SetClickThrough: enabled(true|false)`
- `UpdateWindowRegionForPinnedOnlyAsync`
- `GamingOverlayBroker::ResetWindowRect`
- `SetAppFrameHwnd`
- `SetCoreWindowHwnd`
- `AttachViewToWindowAsync`
- `ChangeHostedViewSizeAsync`
- 다수의 `IXboxGameBarWidgetHost*` 구현 흔적

즉 `GameBar.exe`는 private widget host 계약과
`click-through / hosted view / window region / broker` 제어 흐름을 내부에서 직접 가진다.

#### GameBarFTServer.exe

정적 import 기준으로는 오히려 FT 서버 쪽이 Win32 제어 흔적이 더 강하다.

- `user32.dll`
  - `CreateWindowExW`
  - `EnumWindows`
  - `GetGUIThreadInfo`
  - `GetWindowLongPtrW`
  - `GetWindowRect`
  - `GetWindowTextW`
  - `SetWindowLongPtrW`
  - `SetWindowRgn`
  - `SetWinEventHook`
  - `ShowWindow`
  - `WaitForInputIdle`
- `coremessaging.dll`
  - `CreateDispatcherQueueController`
- `dxgi.dll`
  - `CreateDXGIFactory1`
  - `CreateDXGIFactory2`
- `api-ms-win-ntuser-sysparams-l1-1-0.dll`
  - `QueryDisplayConfig`
  - `DisplayConfigGetDeviceInfo`
  - `DisplayConfigSetDeviceInfo`
  - `GetMonitorInfoW`

문자열도 같은 방향을 가리킨다.

- `XboxGameBarFT.AppTargetManagerFT`
- `IsProcessFse`
- `IsWindowFullscreenOnMonitor`
- `RegisterFullscreenCheckTimer`
- `UpdateAllTargetData`
- `pIDXGISwapChain`
- `DwmProcessID`

즉 FT 서버는:

1. Win32 윈도우 enumeration / hook
2. 전체화면 판정
3. display config 조회
4. swapchain / DWM 관련 추적

을 담당하는 쪽에 가깝다.

### 2.19 최근 ETL 이력 비교

최근 5개 `GameBar_*_Sh.etl`을 한 번에 요약하는 스크립트도 추가했다.

- 스크립트
  - `scripts/gamebar/summarize-gamebar-etl-history.ps1`
- 산출물
  - `docs/artifacts/gamebar-etl-history-summary-20260314.json`

이력 비교에서도 같은 패턴이 반복됐다.

- 태그 합계 상위
  - `WB`
  - `PC`
  - `HPVM`
  - `WM`
  - `SC`
  - `PROF`
  - `ATM`
  - `IDM`
- 패턴 합계 상위
  - `widgets`
  - `launcher`
  - `windowing`
  - `target_tracking`
  - `full_trust`

즉 단발성 로그가 아니라, Game Bar 초기화 구조 자체가
`widget 중심 + launcher 연동 + window region / click-through 제어 + FT target tracking`
으로 고정돼 있다고 보는 편이 맞다.

### 2.20 도구 대체 경로 확보

수동 설치가 막혔던 도구 대신, 현재 머신에서 바로 쓸 수 있는 대체 경로도 정리했다.

- 이미 로컬에 존재
  - `C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\Tools\spyxx_amd64.exe`
  - `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\inspect.exe`
  - `C:\Program Files\rohitab.com\API Monitor\apimonitor-x64.exe`
- 이번에 portable로 추가 세팅
  - `C:\Users\esihun\Desktop\tools\research\x64dbg\release\x64\x64dbg.exe`
  - `C:\Users\esihun\Desktop\tools\research\systeminformer\amd64\SystemInformer.exe`
  - `C:\Users\esihun\Desktop\tools\research\systeminformer\amd64\peview.exe`

즉 현재 기준으로는:

1. `Spy++` 대체는 사실상 이미 해결
2. `Inspect.exe`도 SDK에 이미 포함
3. `WinDbg` 부재는 여전하지만, `x64dbg + System Informer + API Monitor` 조합으로 상당 부분 대체 가능

### 2.21 UI Automation / HWND tree 자동 수집

GUI 도구를 직접 클릭하지 않고도 비슷한 정보를 얻기 위해
UI Automation tree와 HWND child tree를 자동으로 덤프하는 스크립트를 추가했다.

- UIA 스크립트
  - `scripts/gamebar/capture-gamebar-uia-tree.ps1`
- HWND tree 스크립트
  - `scripts/gamebar/capture-gamebar-hwnd-tree.ps1`
- 산출물 예시
  - `docs/artifacts/gamebar-uia-tree-20260315-2.json`
  - `docs/artifacts/gamebar-hwnd-tree-20260315-1.json`

#### UIA 결과

자동 UIA 기준으로 눈에 띈 루트는 다음 정도였다.

- `Widgets.exe`
  - `WindowsDashboard`
- `TextInputHost`
  - `Windows.UI.Core.CoreWindow`
- `explorer`
  - `XamlExplorerHostIslandWindow`
  - `TopLevelWindowForOverflowXamlIsland`

하지만 `WindowsDashboard` 루트는 UIA child를 거의 노출하지 않았다.
즉 `Inspect.exe` 계열만으로는 내부 hosted content가 잘 안 보일 가능성이 있다.

#### HWND tree 결과

반대로 HWND tree 덤프에서는 `Widgets.exe`의 `WindowsDashboard` 아래에
`Chrome_WidgetWin_0` child HWND가 실제로 보였다.

- root
  - `Widgets.exe`
  - class: `WindowsDashboard`
  - rect: `1920x1032`
  - visible: `false`
  - cloaked: `0`
- child
  - class: `Chrome_WidgetWin_0`

이건 두 가지 가능성을 남긴다.

1. Game Bar 또는 관련 shell content가 Chromium/WebView 계열 child HWND를 통해 일부 호스팅된다
2. `Widgets.exe` 자체가 Windows 11 Widgets 보드라서, 이번 캡처에 같이 걸린 별도 shell surface일 뿐이다

즉 이 결과만으로 `WindowsDashboard = Game Bar`라고 단정하면 안 된다.
다만 중요한 건 여전히 동일하다.

- `GameBar.exe` 자체의 뚜렷한 top-level HWND는 자동으로 안 잡힌다
- UI는 shell-hosted view / child HWND / composition surface 쪽일 가능성이 높다

### 2.22 CLI 대체 도구 확장

GUI 도구를 직접 열지 않고도 밀어볼 수 있는 CLI / 반자동 경로를 추가로 확보했다.

- 내장 CLI
  - `logman.exe`
  - `tracerpt.exe`
  - `wpr.exe`
  - `Get-WinEvent`
- Python / instrumentation
  - `frida-tools`
  - 경로: `C:\Users\esihun\AppData\Roaming\Python\Python313\Scripts\frida-*.exe`
- 정적 분석
  - `rizin`
  - 경로: `C:\Users\esihun\Desktop\tools\research\rizin\rizin-win-installer-vs2019_static-64\bin\rizin.exe`
- Sysinternals CLI
  - `handle.exe`
  - `Listdlls.exe`
  - `strings.exe`
  - `sigcheck.exe`
  - 경로: `C:\Users\esihun\Downloads\SysinternalsSuite\`
- Visual Studio CLI
  - `dumpbin.exe`
  - `undname.exe`

즉 현재는 `WinDbg`가 없어도 최소한 아래 축은 CLI로 커버 가능하다.

1. 정적 import / 문자열 / export 조사
2. ETW 캡처 및 raw event 파싱
3. user32 / dxgi / dcomp / loadlibrary 계열 사용자 모드 함수 훅
4. 프로세스 DLL / handle 관찰

### 2.23 Frida 기반 동적 훅 결과

`frida` 기반 CLI 추적도 추가했다.

- 스크립트
  - `scripts/gamebar/trace_gamebar_frida.py`
- 최근 산출물
  - `docs/artifacts/gamebar-frida-trace-getproc-coldstart.json`
  - `docs/artifacts/gamebar-frida-trace-getproc-reattach.json`

현재 훅 범위:

- `CreateWindowExW`
- `CreateWindowInBand`
- `CreateWindowInBandEx`
- `SetWindowBand`
- `SetWindowRgn`
- `SetWindowLongPtrW`
- `CreateDXGIFactory1/2`
- `DCompositionCreateDevice*`
- `DCompositionCreateSurfaceHandle`
- `GetProcAddress`
- `LdrGetProcedureAddress`
- `LoadLibraryExW`
- `LoadPackagedLibrary`

이 경로로 확인된 사실:

- `GameBar.exe`, `GameBarFTServer.exe`, `Widgets.exe` 모두 훅 자체는 안정적으로 걸린다
- `GameBar.exe`와 `GameBarFTServer.exe`에 `CreateWindowInBand*`, `SetWindowBand` export는 실제로 로드된 `user32.dll`에서 해석 가능하다
- 다만 현재 자동 attach 타이밍만으로는 `CreateWindowInBand*`, `SetWindowBand`, `GetProcAddress("CreateWindowInBand")` 실제 호출 샘플은 아직 못 잡았다

즉 결론은 이렇다.

- `OS export 존재`는 확인됨
- `Game Bar 프로세스에서 그 export를 해석 가능한 상태`도 확인됨
- 하지만 `실제 runtime 호출 증거`는 아직 없음

이건 `호출이 없다`기보다, Game Bar 초기 부트스트랩이 빨라서 현 attach 방식이 너무 늦을 가능성을 남긴다.

### 2.24 Logman + Get-WinEvent raw ETW 파싱

기존 `tracerpt summary`만으로는 거칠었기 때문에, ETL raw event를 직접 파싱하는 경로를 추가했다.

- 캡처
  - `scripts/gamebar/capture-gamebar-logman.ps1`
- raw ETW 요약
  - `scripts/gamebar/summarize-gamebar-etw-events.ps1`
- baseline vs launch diff
  - `scripts/gamebar/compare-gamebar-logman.ps1`
- 전체 CLI 패스
  - `scripts/gamebar/run-gamebar-cli-pass.ps1`

핵심 산출물:

- `docs/artifacts/gamebar-logman-launch-summary-20260315-100620.json`
- `docs/artifacts/gamebar-logman-diff-20260315-100620.json`
- `docs/artifacts/gamebar-logman-dxgi-xaml-summary.json`

`idle vs launch` 3초 비교 기준 상위 delta:

- `Microsoft-Windows-DirectComposition`
  - event `25`, task `17`, `+2132`
  - event `44`, task `32`, `+2132`
  - event `45`, task `32`, `+2132`
  - event `38`, task `28`, `+1112`
  - event `1`, task `1`, `+258`
- `Microsoft-Windows-Dwm-Core`
  - event `388`, task `286`, `+1605`
  - event `133`, task `81`, `+205`
- `Microsoft-Windows-XAML`
  - event `297`, task `195`, `+1303`
  - event `555`, task `368`, `+634`
  - event `556`, task `368`, `+634`
  - event `61`, task `40`, `+201`
  - event `561`, task `371`, `+158`
  - event `562`, task `371`, `+158`

즉 Game Bar를 띄우면:

1. XAML resource/style/visual 계층이 크게 활성화된다
2. DirectComposition resource/channel 계층도 같이 증가한다
3. DWM 쪽 resource/command 복사류 이벤트도 동반 상승한다

이건 `XAML -> DirectComposition -> DWM` 경로가 실제로 동시에 움직인다는 직접 증거다.

### 2.25 GameBar PID에 귀속된 XAML / DirectComposition / DXGI 이벤트

이번에는 `DXGI`와 `XAML` provider까지 같이 켜고 raw ETW를 파싱했다.

- 캡처
  - `capture-gamebar-logman.ps1 -IncludeDxgi -IncludeXaml`
- 요약
  - `docs/artifacts/gamebar-logman-dxgi-xaml-summary.json`
  - `docs/artifacts/gamebar-xaml-elements-20260315-100620.json`

#### XAML은 실제로 GameBar.exe 쪽이다

`launch-summary-20260315-100620` 기준:

- `Microsoft-Windows-XAML`
  - `process_id = 25552`
  - `process_name = GameBar`
  - count `5621`

샘플에서 확인된 element / resource 이름:

- `HomePanelRoot`
- `CapturePanelRoot`
- `CapturePanelBackground`
- `ClickThroughToggleButton`
- `ViewHost`
- `ViewChromeRoot`
- `ChromeBar`
- `LeftResizeDragHandle`
- `RightResizeDragHandle`
- `TopResizeDragHandle`
- `BottomResizeDragHandle`
- `HomeBar`
- `HomeMenu`
- `MruListView`
- `ThirdPartyLauncherListView`

추가로 XAML 클래스 / 키도 의미가 있다.

- 클래스
  - `GameBar.GamebarButton`
  - `GameBar.XdsContentPresenter`
  - `Windows.UI.Xaml.RootVisual`
- 리소스 키
  - `GameBarHCHighlightBrush`
  - `GameBarFluentFont`
  - `GameBarAllCornerRadiusRounded`
  - `GameBarHoverBrush`
  - `GameBarPressBrush`

이건 굉장히 중요하다.

- Game Bar UI는 실제로 `XAML root visual` 위에 구성된다
- `resize handle`, `click-through toggle`, `view host` 같은 overlay UX 요소가 ETW에 그대로 드러난다
- 즉 Game Bar가 단순히 숨겨진 DWM surface 하나만 올리는 구조는 아니다

#### DirectComposition도 GameBar PID를 직접 포함한다

같은 캡처에서 `Microsoft-Windows-DirectComposition`은:

- `process_id = 25552`
  - `process_name = GameBar`
  - count `445`

GameBar PID에서 직접 잡힌 샘플 이벤트:

- event `67`
  - `animatorResourceHandle`
  - `animatorCallbackId`
- event `68`
  - `expressionAnimatorInstance`
  - `nodesBuffer`
- event `69`
  - `expressionAnimatorInstance`
  - `nodesBuffer`

즉 Game Bar는 DWM이 대신 합성해 주기만 하는 수동 소비자가 아니라,
자기 프로세스 안에서도 `DirectComposition animator / expression` 계층을 실제로 만진다.

#### DXGI는 GameBar와 FTServer 둘 다 만진다

같은 캡처에서 `Microsoft-Windows-DXGI`는:

- `GameBar`
  - count `125`
- `GameBarFTServer`
  - count `8`

샘플 기준:

- `GameBar.exe`
  - `CreateDXGIFactory`류 초기화 흔적
  - GPU preference / AutoHDR / swap effect upgrade 조회 실패 로그
  - adapter enumeration 이벤트
- `GameBarFTServer.exe`
  - `pIDXGIFactory`
  - `Mode`
  - `BlockedAdapters`
  - `hWnd=0`, `Flags=1` 계열 factory/swapchain 초기화 흔적

즉 DXGI도 `UI 쪽 GameBar`와 `FT helper`가 둘 다 만지지만,
강도와 역할은 다르다.

- `GameBar.exe`는 UI/composition 초기화 성격
- `GameBarFTServer.exe`는 factory / fullscreen target 보조 성격

### 2.15 PLM + cdb cold-start 추적

`Debugging Tools for Windows`를 Windows SDK 경로로 설치한 뒤,
`plmdebug.exe + cdb.exe` 조합으로 Game Bar 패키지의 cold start를 직접 추적했다.

- 사용 경로
  - `C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\plmdebug.exe`
  - `C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe`
- 대표 산출물
  - `docs/artifacts/gamebar-cdb-20260315-110758/gamebar-cdb.log`
  - `docs/artifacts/gamebar-cdb-20260315-110758/gamebar-cdb-summary.json`

핵심은 `PLM debug`가 실제로 `GameBar.exe`에 붙는다는 점이다.
이 경로로 `GameBar.exe`의 very-early startup 구간을 잡을 수 있었다.

#### 모듈 로드

초기 로드 구간에서 아래 모듈이 바로 보였다.

- `dxgi.dll`
- `d3d12.dll`
- `Windows.UI.Xaml.dll`
- `CoreMessaging.dll`
- `GamingTelemetryNuGet.dll`

즉 UI 프로세스는 startup 시점부터
`XAML + CoreMessaging + DXGI/D3D12` 계층을 실제로 물고 시작한다.

#### 실제 breakpoint hit

`cdb` breakpoint로 직접 잡힌 건 아래 3개다.

- `CoreMessaging!CreateDispatcherQueueController`
- `USER32!CreateWindowExW`
- `USER32!SetWindowLongPtrW`

특히 `CreateDispatcherQueueController`의 스택은 아래 흐름을 직접 보여준다.

- `CoreMessaging!CreateDispatcherQueueController`
- `Windows_UI!Windows::UI::Core::CDispatcher::CreateDispatcherQueue`
- `Windows_UI!Windows::UI::Core::CDispatcher::RuntimeClassInitialize`
- `Windows_UI!Windows::UI::Core::CCoreDispatcherStatic::GetOrCreateForCurrentThread`

즉 Game Bar UI는 추상적인 UWP shell 뒤에 숨은 게 아니라,
startup 초기에 `Windows.UI` dispatcher / message loop를 실제로 세운다.

`CreateWindowExW`의 스택도 의미가 크다.

- `USER32!CreateWindowExW`
- `CoreMessaging!Microsoft::CoreUI::Dispatch::UserAdapter::NoContext_CreateWindow`
- `CoreMessaging!Microsoft::CoreUI::Dispatch::UserAdapter::CreateWindowWithReentrancyCheck`
- `CoreMessaging!Microsoft::CoreUI::Dispatch::UserAdapter::InitializeWindow`
- `CoreMessaging!Microsoft::CoreUI::Dispatch::Win32EventLoopBridge::CheckForUserIntegration`

이건 적어도 cold-start 구간에서는
`GameBar.exe`가 `CoreMessaging`을 통해 일반 `USER32!CreateWindowExW` 경로를 타며
Win32 창 호스팅 계층을 실제로 세운다는 뜻이다.

추가로 `SetWindowLongPtrW`는 `uxtheme!CThemeWnd::Attach` 경로로 들어왔다.

- `USER32!SetWindowLongPtrW`
- `uxtheme!CThemeWnd::Reject`
- `uxtheme!CThemeWnd::Attach`
- `uxtheme!ThemeDefWindowProcW`

즉 최소한 startup 초기엔
Game Bar가 완전히 숨겨진 DWM private surface만 쓰는 구조가 아니라,
`USER32 + uxtheme + CoreMessaging + Windows.UI.Xaml`이 같이 움직이는 hybrid 경로다.

#### 아직 직접 안 잡힌 것

이번 cold-start trace 창에서 아래는 직접 breakpoint hit가 없었다.

- `CreateWindowInBand`
- `CreateWindowInBandEx`
- `GetWindowBand`
- `CreateDXGIFactory1`
- `CreateDXGIFactory2`
- `DCompositionCreateDevice*`

이 부재는 꽤 중요하다.

1. 최소한 `GameBar.exe` startup 초반 핵심 경로는 `CreateWindowInBand`가 아닐 수 있다
2. DXGI / DirectComposition 사용은 `export 직접 호출`이 아니라 XAML / WinRT / 내부 래퍼 아래에 숨어 있을 수 있다
3. `CreateWindowInBand`가 쓰이더라도 더 뒤 시점, 다른 프로세스, 또는 다른 activation 경로일 수 있다

즉 현재 증거는
`Game Bar = undocumented API만으로 떠 있는 특수 surface`
보다는
`Win32 window host + CoreMessaging + XAML + composition helper`
쪽을 더 강하게 지지한다.

### 2.16 FTServer 직접 attach 추적

`plmdebug` 경유가 계속 `GameBar.exe`로 붙는 문제를 피하기 위해,
실행 중인 `GameBarFTServer.exe` PID에 직접 `cdb -p` attach 하는 별도 경로를 만들었다.

- 대표 산출물
  - `docs/artifacts/gamebar-running-ftserver-cdb-20260315-114410/gamebar-running-ftserver-cdb.log`
  - `docs/artifacts/gamebar-running-ftserver-cdb-20260315-114410/gamebar-running-ftserver-cdb-summary.json`
- 사용 스크립트
  - `scripts/gamebar/trace-running-ftserver-cdb.ps1`
  - `scripts/gamebar/start-fullscreen-probe.ps1`

이 경로로는 실제로 `GameBarFTServer.exe`에 직접 attach 됐다.

- 로그 선두 모듈
  - `GameBarFTServer.exe`
  - `user32.dll`
  - `CoreMessaging.dll`
  - `dxgi.dll`
  - `combase.dll`
- 동적 hit
  - `user32!SetWindowLongPtrW` 4회

스택은 두 갈래로 갈렸다.

#### uxtheme window attach 경로

- `user32!SetWindowLongPtrW`
- `uxtheme!CThemeWnd::Reject`
- `uxtheme!CThemeWnd::Attach`
- `uxtheme!ThemeDefWindowProcW`

즉 FTServer도 실제 USER32 window object에 theme/window-proc attach를 수행한다.

#### COM server startup 경로

- `user32!SetWindowLongPtrW`
- `combase!OXIDEntry::StartServer`
- `combase!CComApartment::StartServer`
- `combase!InitChannelIfNecessary`
- `combase!CoMarshalInterface`
- `combase!CGIPTable::RegisterInterfaceInGlobalHlp`

이건 `GameBarFTServer.exe`가 이름 그대로 packaged full-trust helper일 뿐 아니라,
실제로 COM apartment / OXID server startup을 수행하는 프로세스라는 강한 증거다.

또한 같은 attach 창에서 아래 런타임 로그가 직접 찍혔다.

- `Source\\GameBarFTServer\\Utilities\\ThirdPartyLauncherDataProvider.cpp`
- `Failed to access library directory C:\Program Files (x86)\Steam\steamapps\ ...`

즉 FTServer의 `ThirdPartyLauncherDataProvider` 경로가 실제로 살아 있고,
Steam 라이브러리 스캔도 여전히 활성 상태다.

반대로 이 direct-attach 창에서는 아래 hit가 없었다.

- `EnumWindows`
- `SetWinEventHook`
- `GetForegroundWindow`
- `QueryDisplayConfig`
- `SetWindowRgn`
- `CreateDXGIFactory1`
- `CreateDXGIFactory2`

즉 FTServer에 직접 붙는 데는 성공했지만,
fullscreen / target tracking 경로의 대표 API는 아직 적중하지 않았다.
현재까지는 startup 이후 attach 시점이 이미 늦었거나,
그 경로가 더 이른 초기화 또는 다른 스레드/상황에 묶여 있을 가능성이 높다.

### 2.17 Frida 기반 FTServer / UI attach 비교

`Frida`로도 같은 대상을 병행 추적해서,
`cdb`가 놓치는 짧은 호출이나 모듈 부재를 비교했다.

- 대표 산출물
  - `docs/artifacts/gamebar-ftserver-frida-20260315-114534.json`
  - `docs/artifacts/gamebar-ftserver-frida-20260315-114700.json`
  - `docs/artifacts/gamebar-ui-frida-20260315-115000.json`

#### FTServer

`GameBarFTServer.exe`에는 아래 export 훅을 실제로 설치할 수 있었다.

- `user32.dll`
  - `EnumWindows`
  - `CreateWindowExW`
  - `CreateWindowInBand`
  - `CreateWindowInBandEx`
  - `GetForegroundWindow`
  - `QueryDisplayConfig`
  - `SetWindowBand`
  - `GetWindowBand`
  - `SetWindowLongPtrW`
  - `SetWinEventHook`
- `dxgi.dll`
  - `CreateDXGIFactory1`
  - `CreateDXGIFactory2`
- `coremessaging.dll`
  - `CreateDispatcherQueueController`

하지만 FTServer attach + fullscreen probe 시점에 실제로 잡힌 건 아래뿐이었다.

- `user32.dll!CreateWindowExW` 3회
- `user32.dll!SetWindowLongPtrW` 6회

여기서 `CreateWindowExW`의 class 인자는 문자열이 아니라 `0xc03e` 같은 atom으로 들어왔다.
즉 FTServer는 string class name 대신 등록된 window class atom을 써서
숨은 helper window를 만들 가능성이 높다.

또한 FTServer attach 시점에는 아래 모듈/함수가 `missing`으로 나왔다.

- `dwmapi.dll!DwmSetWindowAttribute`
- `dwmapi.dll!DwmpDxGetWindowSharedSurface`
- `dcomp.dll!DCompositionCreateDevice*`
- `dcomp.dll!DCompositionCreateSurfaceHandle`

즉 현재 attach 구간의 FTServer는
적어도 직접적인 `DWM API`나 `DirectComposition export`를 로드하지 않았다.

#### GameBar UI

반대로 `GameBar.exe` attach 시점에는 아래 export가 모두 훅 가능했다.

- `dcomp.dll!DCompositionCreateDevice`
- `dcomp.dll!DCompositionCreateDevice2`
- `dcomp.dll!DCompositionCreateDevice3`
- `dcomp.dll!DCompositionCreateSurfaceHandle`
- `dxgi.dll!CreateDXGIFactory1`
- `dxgi.dll!CreateDXGIFactory2`
- `CreateWindowInBand*`
- `SetWindowBand`
- `GetWindowBand`

하지만 attach 이후 10초 관찰 + fullscreen probe 구간에서는
실제 call sample이 하나도 나오지 않았다.

이건 다음 해석과 맞는다.

1. `GameBar.exe`는 해당 export를 쓸 준비가 된 상태로 모듈을 로드한다
2. 하지만 우리가 attach 한 시점 이후엔 그 경로가 이미 지나갔거나,
3. XAML / WinRT / composition wrapper 아래의 다른 경로로만 움직인다

즉 `GameBar.exe는 DComp/DXGI export를 갖고 있지만`,
`attach 이후 직접 export 호출을 계속 반복하는 구조`라고 보이지는 않는다.

#### FTServer hidden window 상관관계

빠른 polling 기준으로 `GameBarFTServer.exe`는 일관되게 아래 top-level hidden window를 남겼다.

- `.class.1`
- `IME` / `Default IME`

둘 다 특징은 같다.

- `band = 1`
- `visible = false`
- `rect = 0,0,0,0`

Frida로 본 FTServer의 `SetWindowLongPtrW` 대상 HWND는
이 장기 생존 hidden window와 정확히 일치하진 않았지만,
여러 런에서 `0x...03ca`, `0x...094x`처럼 비슷한 하위 패턴이 반복됐다.

즉 현재 해석은 이렇다.

- FTServer는 숨은 helper window를 여러 개 만든다
- polling에 잡히는 `.class.1` / `IME`는 그중 장기 생존하는 일부다
- `CreateWindowExW + SetWindowLongPtrW`로 잡힌 HWND 중 일부는 더 짧게 생성/소멸하는 transient helper window일 수 있다

### 2.18 probe-first target acquisition 성공

이전까지 probe를 `Game Bar 실행 후` 띄우는 흐름에서는
FTServer가 계속 기존 포그라운드 창(`Code.exe`)을 target으로 유지했다.

흐름을 반대로 바꿔서:

1. borderless fullscreen probe를 먼저 foreground로 올리고
2. 그 상태에서 `ms-gamebar:`를 실행

하도록 바꾸자 FTServer 로그와 Frida가 모두 probe를 실제 fullscreen target으로 인식했다.

- 대표 산출물
  - `docs/artifacts/gamebar-ftserver-frida-20260315-122803.json`
  - `docs/artifacts/gamebar-window-poll-probe-first-20260315.json`

#### FTServer 텍스트 로그

최신 FT 로그에는 아래가 직접 찍혔다.

- `GetFocusedHwnd: Returning hwnd as 2361738`
- `UpdateAllTargetData: ... image(powershell.exe), pid(...), displayName(GameBar), class(WindowsForms10.Window.8.app...), input(1), IsFse(0), IsFullscreen(1)`

이건 아주 중요하다.

1. Game Bar의 fullscreen target 판정은 `FSE`만 보지 않는다
2. borderless fullscreen Win32 창도 `IsFullscreen(1)`로 인식한다
3. 현재 실험용 probe는 Game Bar target acquisition을 재현하는 데 충분하다

즉 이후 자동 조사에서는
더 이상 실제 게임이나 exclusive fullscreen이 없어도,
이 probe로 FTServer fullscreen 추적 경로를 안정적으로 자극할 수 있다.

#### 같은 조건에서 잡힌 FTServer API 호출

probe-first + Game Bar + FTServer Frida attach 조건에서는
기존보다 훨씬 의미 있는 API들이 실제로 잡혔다.

- `user32.dll!GetWindowThreadProcessId` 11회
- `user32.dll!GetWindowRect` 5회
- `user32.dll!MonitorFromWindow` 5회
- `user32.dll!GetMonitorInfoW` 5회

즉 FTServer가 probe window를 fullscreen target으로 삼았을 때
실제 판정 루프는 적어도 이 조합을 쓴다.

- 대상 HWND -> `GetWindowThreadProcessId`
- 대상 크기 -> `GetWindowRect`
- 대상 모니터 -> `MonitorFromWindow`
- 모니터 크기 -> `GetMonitorInfoW`

이는 FT 로그의 문자열:

- `IsWindowFullscreenOnMonitor`
- `monWidth / monHeight`
- `winWidth / winHeight`

와 정확히 맞물린다.

즉 이전엔 문자열 추정이었던 것이,
이번엔 실제 user32 API 호출로 실증됐다.

#### 여전히 안 잡힌 것

probe-first 조건에서도 아래는 실제 call sample이 없었다.

- `CreateWindowInBand`
- `CreateWindowInBandEx`
- `SetWindowBand`
- `GetWindowBand`
- `QueryDisplayConfig`
- `CreateDXGIFactory1`
- `CreateDXGIFactory2`

따라서 현재까지는 다음 해석이 더 강하다.

- FTServer fullscreen 판정 경로는
  `QueryDisplayConfig`나 undocumented band API보다
  `GetWindowRect + MonitorFromWindow + GetMonitorInfoW` 같은 일반 USER32 경로에 더 가깝다
- undocumented API가 아예 없다고 단정할 수는 없지만,
  적어도 `target acquisition / fullscreen detection 핵심 루프`는 그쪽이 아니다

### 2.19 FTServer fullscreen helper 정적 확정

`probe-first + cdb`에서 잡힌 RVAs를 `rizin`으로 다시 풀어
fullscreen helper 자체를 정적으로 확인했다.

- 대표 산출물
  - `docs/artifacts/gamebar-ftserver-rizin-fullscreen-20260315-124955.txt`
  - `docs/artifacts/gamebar-running-ftserver-cdb-20260315-123016/gamebar-running-ftserver-cdb.log`
  - `docs/artifacts/gamebar-running-ftserver-cdb-20260315-123016/gamebar-running-ftserver-cdb-summary.json`

핵심 함수는 두 개다.

- `fcn.140002bb0`
  - `GetDesktopWindow`
  - `GetShellWindow`
  - `IsWindowVisible`
  - `CompareStringOrdinal(..., "explorer.exe", ...)`
  - `GetWindowRect`
  - `MonitorFromWindow`
  - `GetMonitorInfoW`
  - 로그 문자열
    - `IsWindowFullscreenOnMonitor: hwnd(%zu), monWidth(%d), monHeight(%d), winWidth(%d), winHeight(%d)`
  - 마지막엔 `monitor width/height == window width/height` 비교 결과를 bool로 반환

- `fcn.1400828f0`
  - `GetWindowThreadProcessId`
  - `fcn.140002e10` 호출
  - `fcn.140002bb0` 호출
  - 로그 문자열
    - `UpdateIsFullscreenTargetData: Returning true. isFullscreen(%u)`
    - `UpdateIsFullscreenTargetData: Returning false. isFullscreen(%u)`

즉 FTServer의 fullscreen 판정은 실제로
`Game Bar만의 비공개 surface 질의`가 아니라
`윈도우 가시성 / explorer 제외 / 창 사각형 / 모니터 사각형 비교`
로 이루어진 일반 Win32 helper임이 사실상 확정됐다.

### 2.26 GameBar.exe 정적 surface 보강

`GameBar.exe` 자체도 `rizin`으로 다시 좁혀 보니,
UI 프로세스가 어떤 개념을 직접 가지고 있는지가 더 선명해졌다.

- 대표 산출물
  - `docs/artifacts/gamebar-ui-rizin-20260315-130100.json`
  - `docs/artifacts/gamebar-resolve-cdb-20260315-125242/gamebar-resolve-cdb.log`
  - `docs/artifacts/gamebar-resolve-cdb-20260315-125242/gamebar-resolve-cdb-summary.json`
  - `docs/artifacts/gamebar-ui-broker-rizin-20260315-130420.txt`
  - `docs/artifacts/gamebar-winmd-summary-20260315-131200.json`

정적 surface에서 바로 잡힌 항목:

- import
  - `LoadLibraryExW`
  - `GetProcAddress`
  - `LoadPackagedLibrary`
  - `RoGetActivationFactory`
  - `CreateDXGIFactory2`
- XAML / WinRT 타입
  - 대량의 `Windows.UI.Xaml.*`
  - `Windows.UI.Xaml.Hosting.ElementCompositionPreview`
  - `Windows.UI.Xaml.Window`
- UI / 입력 / 호스팅 관련 문자열
  - `InputDelegationManager`
  - `GameBar::InputDelegationManager::HandleWinGForegroundTargetFseLaunch`
  - `GameBar::ViewChromeBase::GetHostedViewRectForPinning`
  - `HostedViewSize::set calling WidgetWindow::Size/Position`
  - `GlobalClickThroughTransparency`
  - `SetClickThrough: enabled(true|false)`
- broker 관련 문자열
  - `GamingOverlayBroker().Hide()`
  - `GamingOverlayBroker().Show()`
  - `GamingOverlayBroker().SetForeground()`
  - `GamingOverlayBroker().ResetWindowRegion()`
  - `GamingOverlayBroker().SetCombinedWindowRegion()`
  - `GamingOverlayBroker::GetDisplayMonitors`

패키지 자체 `GameBar.winmd`를 덤프해보면,
메타데이터 표면에는 아래만 직접 올라와 있었다.

- `InputDelegationManagerCommandKind`
- `GetDesiredInitialHostedViewSize(...)`
- `HostedView`
- `IsClickThroughEnabled`
- `ClickThroughToggleClicked`
- `ClickThroughWidgetTransparency`
- `ClickThroughWidgetOpacity`

타입 레벨로 보면:

- `GameBar.ViewChromeBase`가 `HostedView`를 직접 노출하고
- `GameBar.HomePanelViewModel`이 `IsClickThroughEnabled`, `ClickThroughToggleClicked()`를 직접 노출한다
- `InputDelegationManager`는 구체 구현보다 `InputDelegationManagerCommandKind` enum 수준만 표면에 나타난다

반대로 `GamingOverlayBroker` 자체는 `GameBar.idl` 메타데이터에 나타나지 않았다.
즉 `HostedView / ClickThrough / InputDelegation`은 패키지 타입 표면에 드러나지만,
`GamingOverlayBroker`는 그 아래의 내부 구현 디테일일 가능성이 높다.

반대로 cold-start `resolve-cdb` 패스에서
`GetProcAddress` / `LoadLibraryExW`를 직접 잡아도,
아래 이름은 관측되지 않았다.

- `CreateWindowInBand`
- `SetWindowBand`
- `GetWindowBand`
- `DwmpDxGetWindowSharedSurface`
- `DCompositionCreateDevice*`
- `DCompositionCreateSurfaceHandle`
- `CreateDXGIFactory2` 동적 해석 이름

즉 현재까지는
`GameBar.exe가 undocumented band API를 startup에서 노골적으로 GetProcAddress 한다`
는 증거보다,
`XAML + hosted view + input delegation + private GamingOverlayBroker abstraction`
쪽 증거가 훨씬 강하다

추가로 string xref를 따라가 보면,

- `SetClickThrough: enabled(true|false)`는 `fcn.14025bb20` 본문에 직접 매달려 있고
- `HostedViewSize::set calling WidgetWindow::Size/Position`도 `fcn.1402a304a`에 직접 매달려 있다

즉 이들은 단순 로그 잔재가 아니라,
실제 GameBar UI 코드 안에서 호출되는 창/호스팅 제어 함수들에 가깝다

---

### 2.27 broker COM runtime 실증과 일반 Win32 접근성 확인

`cdb` broker cold-start 패스를 별도로 구성해,
`GamingOverlayBroker` 래퍼가 실제로 어떤 COM 객체를 만드는지 다시 잡았다.

추가 스크립트:

- `scripts/gamebar/trace-gamebar-broker-cdb.ps1`
- `scripts/gamebar/trace-running-gamebar-broker-cdb.ps1`
- `scripts/gamebar/summarize-gamebar-broker-cdb.ps1`

대표 산출물:

- `docs/artifacts/gamebar-broker-cdb-20260315-133714/gamebar-broker-cdb.log`
- `docs/artifacts/gamebar-broker-cdb-20260315-133714/gamebar-broker-cdb-summary.json`
- `docs/artifacts/gamebar-running-broker-cdb-20260315-133602/gamebar-running-broker-cdb.log`

핵심 hit:

- `EnsureBrokerComObject = 8`
- `UpdateWindowRegionForPinnedOnlyAsync = 3`
- `BrokerHide = 1`
- `SetClickThrough = 1`
- `ResetWindowRectCaller = 1`
- `GetDisplayMonitorsCaller = 1`
- `combase!CoCreateInstance = 65`
- `dcomp.dll` load 관측

특히 `EnsureBrokerComObject` 직후의 `CoCreateInstance` 인자 바이트가
정적으로 뽑은 GUID와 정확히 일치했다.

- CLSID bytes -> `{59614133-bfb4-4906-90af-c44f15167f1a}`
- IID bytes -> `{9767060c-9476-42e2-8f7b-2f10fd13765c}`

이 CLSID는 registry 기준으로:

- `HKCR\\CLSID\\{59614133-bfb4-4906-90af-c44f15167f1a}` -> `AgileImmersiveShellBroker`
- `HKCR\\AppID\\{2fd08a73-d1f1-43eb-b888-24c2496f95fd}` -> `ImmersiveShellBrokers`
- `RunAs = Interactive User`
- `LaunchPermission` 존재

또 다른 runtime stack에는 아래가 직접 잡혔다.

- `windowsudk_shellcommon!GetImmersiveShellBroker<IExperienceApplicationViewBroker>`
- `windowsudk_shellcommon!winrt::WindowsUdk::ApplicationModel::factory_implementation::ApplicationView::ApplicationView`

즉 `GamingOverlayBroker`는 패키지 내부 구현에만 갇힌 것이 아니라,
실제로는 `Immersive Shell / ApplicationView` 계층으로 내려가는 wrapper일 가능성이 매우 강해졌다.

정적 해석도 한 단계 더 좁혀졌다.

- `fcn.1400ad240`은 `CoCreateInstance(CLSID=AgileImmersiveShellBroker, IID=9767...)`
- 그 뒤 primary interface의 `vtable+0x60`을 호출
- 인자 배치가 `(guidService, riid, out)` 형태라 `QueryService`류와 매우 유사
- 여기서 `{30dad006-cf4a-45e0-aec1-2195d76fd9c0}` GUID를 서비스/최종 IID로 사용
- 반환된 intermediate 객체에 다시 `QueryInterface(alt IID)`를 걸어 최종 broker interface를 얻는다

즉 최종적으로 `Show/Hide/ResetWindowRect/SetClickThrough/GetDisplayMonitors`를 거는 객체는
`CoCreateInstance`로 직접 받는 1차 객체가 아니라,
`ImmersiveShell broker -> service query -> final broker interface` 체인으로 얻는 2차 객체에 가깝다.

이 가설은 일반 Win32 프로세스에서도 자동 probe로 다시 확인했다.

추가 스크립트:

- `scripts/gamebar/probe-gamebar-broker-win32.ps1`

대표 산출물:

- `docs/artifacts/gamebar-broker-win32-no-ui-20260315-135040.json`
- `docs/artifacts/gamebar-broker-win32-with-ui-20260315-135040.json`

이 probe는 `PowerShell` 같은 일반 desktop 프로세스에서:

1. `CoCreateInstance(CLSID=AgileImmersiveShellBroker, IID=9767...)`
2. primary interface `slot12(=0x60)` 호출
3. `QueryInterface(alt IID=30dad...)`
4. 최종 interface의 broker method 호출

을 순서대로 시도한다.

결과는 다음과 같았다.

- `CLSCTX_INPROC_SERVER(1)` / `CLSCTX_INPROC_HANDLER(16)` -> `REGDB_E_CLASSNOTREG (0x80040154)`
- `CLSCTX_LOCAL_SERVER(4)` / `CLSCTX_ALL(5)` / `20` / `21` -> `S_OK`
- 즉 이 broker는 `in-proc`가 아니라 `local server / out-of-proc COM` 경로다

또한:

- primary interface에 대해 `QueryInterface(alt IID)`를 바로 걸면 실패
- 대신 `slot12` 경유 후 `QueryInterface(alt IID)`는 성공
- 최종 interface proxy vtable은 현재 프로세스의 `combase.dll`을 가리킨다

메서드 호출 결과도 상태에 따라 달랐다.

`Game Bar`를 띄우지 않은 상태:

- `show_slot6` -> `0x80004003`
- `hide_slot7` -> `0x80004003`
- `reset_window_rect_slot10` -> `0x8000FFFF`
- `set_click_through_false_slot51` -> `0x80004003`

`ms-gamebar:`로 `Game Bar`를 실제로 띄운 상태:

- `show_slot6` -> `0x00000000`
- `hide_slot7` -> `0x00000000`
- `reset_window_rect_slot10` -> `0x00000000`
- `set_click_through_false_slot51` -> `0x00000000`

즉 이 시점에서 말할 수 있는 건 분명하다.

- 일반 Win32 프로세스도 `ImmersiveShell broker`에 실제로 접근할 수 있다
- 최종 broker interface 획득도 package identity 없이 가능하다
- 다만 메서드는 ambient `Game Bar` 상태 / shell session이 있을 때만 정상 동작한다
- 따라서 `완전한 package-only 봉인 경로`는 아니지만, 여전히 `shell state 의존`은 강하다

이건 현재 연구에서 가장 중요한 전환점이다.

- 예전 가설: `Game Bar package privilege 없이는 broker 자체 접근 불가`
- 현재 증거: `broker 접근과 일부 제어는 일반 Win32에서도 가능`
- 남은 미지수: `custom hosted view / custom overlay surface / widget-host 수준의 생성`까지 외부 프로세스가 열 수 있는지

---

### 2.28 private widget host / CuiWidgetAdapter 경로 정적 실증

broker 경로와 별개로, 실제 `widget load / hosted view attach`가 어디에 묶여 있는지도
별도 스크립트로 다시 요약했다.

추가 스크립트:

- `scripts/gamebar/summarize-gamebar-widget-host.ps1`

대표 산출물:

- `docs/artifacts/gamebar-widget-host-summary-20260315-142946.json`

이 패스에서 확인된 핵심은 다음과 같다.

#### `CuiWidgetAdapter`는 실제 widget host 구현체다

바이너리 문자열과 registration xref 기준으로,
`GameBar.exe` 안에는 `GameBar.CuiWidgetAdapter` runtime type이 실제로 등록되어 있다.

- `GameBar.CuiWidgetAdapter`
- `C:\__w\1\s\Source\GameBar\Widgets\CuiHost\CuiWidgetAdapter.cpp`
- `winrt::GameBar::implementation::CuiWidgetAdapter::ActivateWidgetAsync`

registration 문자열 xref는 아래처럼 별도 factory/등록 코드에 직접 걸린다.

- `(nofunc) 0x14023eab2 [DATA] lea rax, str.GameBar.CuiWidgetAdapter`

즉 `CuiWidgetAdapter`는 단순 디버그 문자열이 아니라
실제로 런타임 객체로 등록되는 widget host 구현체로 보는 편이 맞다.

#### `LoadWidget`는 계약 기반 launch + visual attach를 한 함수에서 묶는다

`LaunchAsyncByContractWithArgsAsUser` 로그 문자열을 따라가면
모두 `fcn.14068fb70` 한 함수에 모인다.

- 함수: `fcn.14068fb70`
- 크기: 약 `11,382` bytes
- basic blocks: `539`
- edges: `812`

같은 함수 안에서 다음 문자열이 함께 관찰된다.

- `Windows.GameBarUIExtension`
- `WebView2SupportRequired`
- `CuiWidgetAdapter::LoadWidget: Calling LaunchAsyncByContractWithArgsAsUser`
- `CuiWidgetAdapter::LoadWidget: LaunchAsyncByContractWithArgsAsUser completed`
- `CuiWidgetAdapter::LoadWidget: Contract not supported`
- `CuiWidgetAdapter::LoadWidget: id(%ws), Calling AcquireHamDependency with componentPid(%u)`
- `CuiWidgetAdapter::LoadWidget: Widget private not set before timeout`
- `CuiWidgetAdapter::AttachVisualToElement called`
- `CuiWidgetAdapter::UnloadWidgetInternal SetElementChildVisual failed`

이 조합은 중요하다.

1. widget 로딩은 단순 broker `Show/Hide` 수준이 아니라
   `contract launch + dependency 획득 + visual attach + unload/close`까지 한 파이프라인이다
2. `Windows.GameBarUIExtension`과 `LaunchAsyncByContractWithArgsAsUser`가 같은 함수 군집에 묶여 있으므로,
   custom widget 로딩은 여전히 app-extension / contract 경로에 매우 강하게 묶여 있다
3. `AttachVisualToElement`, `SetElementChildVisual failed`, `WaitForCompositionTargetRendered` 정황을 합치면,
   최종 렌더링은 `hosted view -> element child visual` 계층으로 붙는 가능성이 높다

#### private IDL과 바이너리 문자열이 서로 맞물린다

`Microsoft.Gaming.XboxGameBar.Private.idl`에서 실제로 보이는 계약은 다음과 같다.

`IXboxGameBarWidgetControlHost`

- `ActivateSettingsAsync`
- `ActivateWithUriAsync`
- `MinimizeAsync`
- `RestoreAsync`
- `CloseAsync`

`IXboxGameBarWidgetHost5`

- `LaunchUriAsync`

`IXboxGameBarWidgetHost6`

- `GetAppTargetHost`
- `GetWindowBounds`
- `LaunchUriAsync`
- `LaunchUriAsync2`

`IXboxGameBarWidgetPrivate`

- `SetClickThroughEnabled`
- `SetInputDelegation`
- `WaitForCompositionTargetRendered`

`IXboxGameBarWidgetPrivate2`

- `SetRequestedOpacity`
- `EnableInputDelegation`
- `DisableInputDelegation`

`IXboxGameBarWidgetPrivate4/5/6`

- `SetWindowBounds`
- `SetCompactModeEnabled`
- `RaiseBackButtonClickedEvent`

그리고 `CuiWidgetAdapter` 문자열군에는 실제로 아래가 대응된다.

- `LaunchUriAsync called: ... routing to system launcher`
- `LaunchUriAsync called: ... routing to system launcher with options`
- `LaunchUriAsync called: ... routing to system launcher with options and inputData`
- `ClickThroughChangedHandler`
- `InputDelegated`
- `RequestedThemeChangedHandler`
- `OpacityChangedHandler`
- `PinnedChangedHandler`
- `SetHomeMenuVisibleSupported`
- `SetConfirmClose`
- `SetCanGoBack`
- `SetSecondaryPageTitle`

즉 `private IDL에 보이는 widget host/private surface`와
`GameBar.exe 안 CuiWidgetAdapter 구현`은 거의 1:1로 대응한다.

추가로 바이너리 문자열 기준으로
`CuiWidgetAdapter`는 `IXboxGameBarWidgetHost 1-9` 구현 흔적을 모두 가진다.

#### 현재 해석상 의미

이제 구조는 꽤 명확하게 둘로 갈린다.

1. `ImmersiveShell broker`
   - 일반 Win32에서도 접근 가능
   - `Show/Hide/ResetWindowRect/SetClickThrough`는 shell state가 맞으면 외부에서도 성공

2. `widget host / hosted view creation`
   - `CuiWidgetAdapter`
   - `Windows.GameBarUIExtension`
   - `LaunchAsyncByContractWithArgsAsUser`
   - `IXboxGameBarWidgetHost* / IXboxGameBarWidgetPrivate*`
   - `AttachVisualToElement / SetElementChildVisual`

즉 현재까지는
`브로커 제어는 외부 Win32에서도 재현 가능성이 있다`
는 쪽으로 더 긍정적이지만,
`임의의 custom widget / hosted view를 Game Bar 방식으로 새로 띄우는 것`은
여전히 packaged widget contract 경로에 묶여 있을 가능성이 높다.

---

### 2.29 외부 Win32에서 packaged widget runtime class 활성화 probe

정적 문자열만으로는 부족하므로,
이번에는 외부 Win32 프로세스가 `GameBar` 쪽 runtime class를
직접 `RoGetActivationFactory` / `RoActivateInstance`로 열 수 있는지 probe했다.

추가 스크립트:

- `scripts/gamebar/probe-gamebar-winrt-activation.ps1`

대표 산출물:

- `docs/artifacts/gamebar-winrt-activation-no-ui-20260315-v2.json`
- `docs/artifacts/gamebar-winrt-activation-with-ui-20260315-v2.json`

probe 대상:

- `GameBar.CuiWidgetAdapter`
- `GameBar.WidgetControlHost`
- `GameBar.ForegroundWorkerHost`
- `GameBar.AppTargetHost`
- `GameBar.NotificationHost`

비교용 control:

- `Windows.Foundation.Collections.ValueSet`
- `Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions`
- `Microsoft.Web.WebView2.Core.CoreWebView2ControllerWindowReference`

결과는 매우 선명했다.

#### `GameBar.*` runtime class는 외부 Win32에서 바로 활성화되지 않는다

`Game Bar`를 띄우지 않은 상태와 `ms-gamebar:`로 띄운 상태 모두 동일했다.

- `RoGetActivationFactory("GameBar.CuiWidgetAdapter")` -> `0x80040154`
- `RoActivateInstance("GameBar.CuiWidgetAdapter")` -> `0x80040154`
- `GameBar.WidgetControlHost` -> `0x80040154`
- `GameBar.ForegroundWorkerHost` -> `0x80040154`
- `GameBar.AppTargetHost` -> `0x80040154`
- `GameBar.NotificationHost` -> `0x80040154`

즉 `Game Bar` UI가 이미 떠 있어도,
plain Win32 process는 이 runtime class들을 activation class로 직접 얻지 못했다.

#### probe 자체는 정상이다

control class인 `Windows.Foundation.Collections.ValueSet`는 정상 성공했다.

- `RoGetActivationFactory` -> `0x00000000`
- `IActivationFactory::ActivateInstance` -> `0x00000000`
- `RoActivateInstance` -> `0x00000000`

즉 실패 원인은 probe 코드가 아니라
`GameBar.*` runtime class 등록/가시성 자체에 있다.

참고로 `Microsoft.Web.WebView2.Core.*` class도 외부 Win32에선 `0x80040154`였다.
이건 `Game Bar` 패키지 안 activatable class라고 해도,
plain Win32에서 자동으로 WinRT activation 대상이 되진 않는다는 쪽과 맞는다.

#### 해석상 의미

이 결과는 현재까지의 경계선을 더 뚜렷하게 만든다.

1. `broker interface`
   - 일반 Win32에서도 획득 가능
   - shell state가 맞으면 일부 제어 메서드도 성공

2. `GameBar.* packaged runtime class`
   - 외부 Win32에서 class name 기반 activation 불가
   - `Game Bar`가 떠 있어도 여전히 `REGDB_E_CLASSNOTREG`

즉 현재 증거만 놓고 보면,
외부 Win32가 `GameBar.CuiWidgetAdapter`나 `GameBar.WidgetControlHost`를
그대로 활성화해서 widget-host 경로를 재사용할 가능성은 크게 낮아졌다.

다만 아직 완전히 닫힌 것은 아니다.

- class activation은 막혀도 다른 broker/service path가 있을 수 있음
- `LaunchAsyncByContractWithArgsAsUser`와 동일한 widget contract launch를
  다른 shell service를 통해 우회 호출할 가능성은 남아 있음

그래도 적어도 하나는 이제 말할 수 있다.

`custom hosted view 생성이 가능하더라도, 그 진입점은 GameBar.* runtime class의 단순 WinRT activation은 아닐 가능성이 매우 높다.`

---

### 2.30 packaged process 내부 activation / FT COM probe

외부 Win32 probe만으로는 `package identity` 경계를 다 닫을 수 없어서,
이번에는 `Frida`로 이미 패키지 identity를 가진 `GameBar.exe`와 `GameBarFTServer.exe`
프로세스 내부에서 직접 `RoGetActivationFactory / RoActivateInstance / CoCreateInstance`
probe를 돌렸다.

추가 스크립트:

- `scripts/gamebar/probe_packaged_identity_frida.py`
- `scripts/gamebar/run-gamebar-packaged-identity-pass.ps1`

대표 산출물:

- `docs/artifacts/gamebar-packaged-identity-gamebar-20260315-154413.json`
- `docs/artifacts/gamebar-packaged-identity-gamebarftserver-20260315-154413.json`
- `docs/artifacts/gamebar-packaged-identity-gamebar-20260315-154809.json`
- `docs/artifacts/gamebar-packaged-identity-gamebarftserver-20260315-154809.json`

이 패스에서 먼저 확인된 사실은 두 프로세스 모두 실제로 패키지 identity를 가진다는 점이다.

- `GetCurrentPackageFullName()` -> `Microsoft.XboxGamingOverlay_7.325.10021.0_x64__8wekyb3d8bbwe`

즉 여기서의 실패는 더 이상 `NO_PACKAGE` 문제가 아니다.

#### `GameBar.*` / `XboxGameBarFT.*` runtime class는 packaged process 내부에서도 direct activation이 안 잡힌다

`GameBar.exe`와 `GameBarFTServer.exe` 내부에서 모두 동일했다.

- `RoGetActivationFactory("GameBar.CuiWidgetAdapter")` -> `0x80040154`
- `RoActivateInstance("GameBar.CuiWidgetAdapter")` -> `0x80040154`
- `GameBar.WidgetControlHost` -> `0x80040154`
- `GameBar.ForegroundWorkerHost` -> `0x80040154`
- `GameBar.AppTargetHost` -> `0x80040154`
- `GameBar.NotificationHost` -> `0x80040154`
- `XboxGameBarFT.GbftFactory` -> `0x80040154`
- `XboxGameBarFT.AppTargetManagerFT` -> `0x80040154`
- `XboxGameBarFT.WindowManagerFT` -> `0x80040154`
- `XboxGameBarFT.InputFocusTrackerFT` -> `0x80040154`
- `XboxGameBarFT.GameConfigStoreFT` -> `0x80040154`

즉 `Game Bar` 패키지 내부 프로세스라고 해도
이 이름들이 `RoGetActivationFactory`로 바로 열리는 public activation class는 아니다.

이건 중요한 선이다.

- `GameBar.CuiWidgetAdapter` 같은 이름은 실제 구현/문자열/등록 흔적은 강하게 보이지만
- 그렇다고 해서 `WinRT activation class`로 직접 노출되는 것은 아니다

즉 현재까지는 `internal implementation type` 또는
다른 activation 경로로만 접근 가능한 class라고 보는 편이 더 자연스럽다.

#### 반대로 `XboxGameBarFT.GbftFactory` COM 경로는 packaged process 내부에서 완전히 열린다

같은 프로세스 내부에서 FT COM CLSID를 직접 호출하면 결과가 달랐다.

- `CoCreateInstance(CLSID={FD06603A-2BDF-4BB1-B7DF-5DC68F353601}, IUnknown)` -> `S_OK`
- `QI(IActivationFactory)` -> `S_OK`
- `IActivationFactory::ActivateInstance()` -> `S_OK`
- `GetRuntimeClassName()` -> `XboxGameBarFT.GbftFactory`
- `QI(IGbftFactory)` -> `S_OK`

이건 `GameBar.exe`와 `GameBarFTServer.exe` 둘 다 동일했다.

추가로 `IGbftFactory` 하위 슬롯도 실제로 모두 열렸다.

- `slot7` -> `XboxGameBarFT.AppTargetManagerFT`
- `slot11` -> `XboxGameBarFT.WindowManagerFT`
- `slot16` -> `XboxGameBarFT.GameConfigStoreFT`
- `slot25` -> `XboxGameBarFT.InputFocusTrackerFT`

각 경로에서:

- `createHr` -> `S_OK`
- `GetRuntimeClassName()` -> 각 FT runtime class 이름 반환
- `QI(expected FT IID)` -> `S_OK`

즉 현재까지는 `GbftFactory 단일 객체`만 열린 것이 아니라,
적어도 probe한 범위의 `FT helper surface` 전체가 package identity를 가진 프로세스 안에서는
정상적으로 활성화된다고 보는 편이 맞다.

즉 현재까지 가장 자연스러운 해석은 이렇다.

1. `XboxGameBarFT` 계층은 `RoGetActivationFactory("XboxGameBarFT.GbftFactory")` 같은 공개형 activation class가 아니라
   `COM CLSID -> IActivationFactory -> ActivateInstance -> runtime object` 체인으로 열리는 경로다
2. `GameBar.*` widget host 계층은 그보다도 더 내부적이어서,
   적어도 지금 probe한 범위에선 direct activation class로는 드러나지 않는다

이 결과는 plain Win32 probe 때 보였던
`FT COM 경로는 package identity 없이는 IGbftFactory QI에서 APPMODEL_ERROR_NO_PACKAGE`
라는 현상과 정확히 이어진다.

- plain Win32: `FT COM instantiate 가능`, `ActivateInstance 가능`, `IGbftFactory` 단계에서 `NO_PACKAGE`
- packaged GameBar process: 같은 경로가 끝까지 `S_OK`

즉 `XboxGameBarFT`는 지금까지의 증거상
`package identity dependent COM activation surface`에 가깝다.

#### 현재 의미

이제 경계는 더 또렷하다.

1. `ImmersiveShell broker / shell state control`
   - 일반 Win32에서도 접근 가능
   - `Show/Hide/ResetWindowRect/SetClickThrough` 같은 제어는 재현 가능

2. `XboxGameBarFT`
   - plain Win32에선 `NO_PACKAGE`
   - packaged GameBar process 내부에선 `GbftFactory`, `AppTargetManagerFT`, `WindowManagerFT`, `GameConfigStoreFT`, `InputFocusTrackerFT`까지 정상 활성화
   - 즉 package identity 의존 FT helper surface

3. `GameBar.* widget host runtime class`
   - packaged GameBar process 내부에서도 `REGDB_E_CLASSNOTREG`
   - 즉 적어도 direct WinRT activation class는 아님

따라서 지금 가장 설득력 있는 방향은:

- `브로커 기반 창/상태 제어`는 재현 후보
- `FT helper`는 package identity를 가진 별도 surface
- `widget host / hosted view 생성`은 그보다 더 내부적인 계약 경로

으로 보는 것이다.

---

### 2.31 broker 메서드 양방향 probe와 UI 가시성 확인

브로커가 실제로 shell 제어면을 갖는지 확인하려고,
`show / hide / set_click_through_true / set_click_through_false`를
개별 호출할 수 있게 probe를 분리했다.

추가 스크립트:

- `scripts/gamebar/run-broker-visibility-pass.ps1`

대표 산출물:

- `docs/artifacts/gamebar-broker-visibility-20260315-154106/summary.json`
- `docs/artifacts/gamebar-broker-clickthrough-20260315-154500.json`

확인된 점:

- `hide` -> `S_OK`
- `show` -> `S_OK`
- `set_click_through_true` -> `S_OK`
- `set_click_through_false` -> `S_OK`

즉 최소한 `브로커 메서드의 성공/실패` 관점에서는
양방향 제어면이 실제로 살아 있다.

다만 같은 타이밍에 UIA root를 비교하면 top-level visible root 집합은 거의 바뀌지 않았다.

- `before.visible_root_count = 8`
- `after_hide.visible_root_count = 8`
- `after_show.visible_root_count = 8`

이건 두 가지 중 하나를 시사한다.

1. 우리가 보고 있는 UIA root 후보가 실제 Game Bar surface가 아니다
2. broker가 제어하는 대상이 top-level HWND/일반 UIA 노드보다 더 아래쪽 composition / hosted-view 계층이다

현재까지는 두 번째 해석이 더 자연스럽다.
즉 `S_OK`로 보이는 제어가 곧바로 `눈에 보이는 top-level HWND 변화`로 이어지지 않는다는 점은,
Game Bar surface가 계속 `숨은 host window + composition child visual`에 더 가깝다는 쪽을 다시 지지한다.

---

## 3. 현재 해석

현재까지의 증거만 놓고 보면, 다음 해석이 가장 자연스럽다.

1. Game Bar는 단순 UWP 뷰 호스팅을 넘어 `privileged package contract`를 가진다
2. UI 프로세스는 `private widget host + XAML root visual + DirectComposition animator + click-through + hosted view + broker` 계층을 직접 가진다
3. FT 서버는 `Win32 target tracking + fullscreen/FSE 판정 + DXGI factory/swapchain 보조 + window style/region helper` 계층을 직접 가진다
4. 렌더링 쪽은 `XAML + DirectComposition + DXGI + Win2D + WebView2` 조합 가능성이 높다
5. 다만 `GameBar.exe` startup 초반 자체는 `CoreMessaging + USER32!CreateWindowExW + uxtheme` 경로를 직접 타는 것으로 보인다
6. `GameBarFTServer.exe`는 runtime 기준으로 `COM server startup + helper window` 성격이 매우 강하며, 이 시점에는 직접적인 `dwmapi/dcomp` export 사용이 보이지 않는다
7. FTServer의 `target acquisition / fullscreen detection` 핵심 루프는 현재까지 `GetWindowRect + MonitorFromWindow + GetMonitorInfoW + GetWindowThreadProcessId` 조합으로 더 잘 설명된다
8. `GameBar.exe`는 `dcomp/dxgi` export를 로드한 상태이지만, attach 이후 직접 호출을 반복하는 구조는 아직 보이지 않는다
9. `GameBar.exe` 정적 surface에는 `GamingOverlayBroker().Show/Hide/SetForeground/ResetWindowRegion/SetCombinedWindowRegion`, `HostedView`, `ClickThrough`, `InputDelegationManager`가 직접 드러난다
10. 이제 `GamingOverlayBroker`는 단순한 private abstraction 가설을 넘어서, runtime 기준 `AgileImmersiveShellBroker -> ApplicationView / ImmersiveShell broker` 경로와 실제로 연결된다
11. 현재 registry / symbol / public reversing 단서들을 합치면, 1차 IID `{9767060c-9476-42e2-8f7b-2f10fd13765c}`는 `IImmersiveShellBroker`로 보는 해석이 가장 자연스럽다
12. 이 broker는 `in-proc DLL`이 아니라 `local server / out-of-proc COM` 경로이고, 일반 Win32 프로세스에서도 `CoCreateInstance + service query + QI` 체인으로 최종 interface를 얻을 수 있다
13. 다만 같은 메서드라도 `Game Bar` shell state가 없으면 `E_POINTER / E_UNEXPECTED`로 실패하고, `ms-gamebar:`로 UI를 띄운 상태에서는 `Show/Hide/ResetWindowRect/SetClickThrough`가 `S_OK`로 돌아온다
14. 심지어 `set_click_through_true / false` 양방향도 모두 `S_OK`라서, 적어도 broker 제어면 자체는 단방향 stub이 아니라 실제 상태 변경 surface로 보인다
15. 그러나 같은 시점의 UIA root 비교에서는 top-level visible window 집합이 거의 바뀌지 않았고, 이건 broker 제어 대상이 일반 HWND보다 더 아래쪽 composition / hosted-view 계층일 가능성을 강화한다
16. 외형상 결과는 여전히 `window band` 또는 `DWM composition` 경로와 잘 맞지만, 그게 `startup 초기 주 경로`라고 단정할 수는 없다
17. 특히 cold-start `GetProcAddress` 패스에서 undocumented API 이름이 직접 잡히지 않았기 때문에, 현재는 `band API 직접 호출`보다 `ImmersiveShell broker + hosted view + shell state` 조합 가능성이 더 강하다
18. 즉 현 단계에서는 `Game Bar private API 직접 재사용`보다 `Win32 host + XAML dispatcher + ImmersiveShell broker + FT helper` 조합을 먼저 의심하는 것이 더 타당하다
19. 다만 `custom widget load / hosted view attach` 경로는 별개이며, 현재 정적 증거는 `CuiWidgetAdapter + Windows.GameBarUIExtension + LaunchAsyncByContractWithArgsAsUser + private widget host interfaces` 조합으로 더 잘 설명된다
20. `CuiWidgetAdapter`는 `IXboxGameBarWidgetHost 1-9` 및 `IXboxGameBarWidgetPrivate*` 계층과 직접 대응하고, 여기엔 `LaunchUriAsync2`, `WaitForCompositionTargetRendered`, `SetClickThroughEnabled`, `SetWindowBounds`, `SetRequestedOpacity` 같은 진짜 호스팅 기능이 들어 있다
21. 동시에 packaged process 내부 probe를 합치면, `GameBar.*` / `XboxGameBarFT.*` 이름 자체는 direct WinRT activation class가 아니고, `XboxGameBarFT`는 `COM CLSID -> IActivationFactory -> ActivateInstance` 경로에서만 정상 surface가 열린다
22. 따라서 현재 가장 자연스러운 경계선은 `broker 기반 창/상태 제어는 외부 Win32에서도 가능`, `FT helper는 package identity dependent COM surface`, `widget component launch / visual attach / hosted view 생성은 packaged app-extension host 경로에 더 강하게 묶임`이다
23. 이 해석은 plain Win32에서 `RoGetActivationFactory("GameBar.CuiWidgetAdapter")`와 `RoActivateInstance("GameBar.CuiWidgetAdapter")`가 모두 `REGDB_E_CLASSNOTREG`로 실패한 결과, 그리고 packaged GameBar process 내부에서도 같은 이름들이 계속 `REGDB_E_CLASSNOTREG`인 결과와 동시에 맞는다
24. 즉 현재까지는 `GameBar.* runtime class를 외부에서 직접 활성화해 widget host를 재사용한다`는 경로보다, `브로커는 열려 있고 FT helper는 package-bound COM surface이며 widget-host runtime class는 direct activation으로는 드러나지 않는다`는 쪽이 훨씬 강하다

---

## 4. 자동화로 확인한 한계

다음은 자동 수집만으로는 결론이 안 났다.

- Game Bar UI가 실제로 어떤 HWND / visual tree에 붙는지
- `CreateWindowInBand*` 호출이 실제로 있었는지
- `dwm.exe` 또는 시스템 프로세스 쪽 렌더 경로를 타는지
- `ImmersiveShell broker`에서 `custom hosted view / custom overlay surface / widget-host`를 외부 프로세스가 새로 생성할 수 있는지
- `GamingOverlayBroker` 최종 interface의 전체 메서드 시그니처와 상태 요구사항이 무엇인지
- 외부 Win32가 `LaunchAsyncByContractWithArgsAsUser`와 동일한 widget contract 경로를 직접 재현할 수 있는지
- 외부 Win32가 유효한 `IXboxGameBarWidgetPrivate* / WidgetControlHost` 객체를 shell에 주입할 수 있는지
- `GameBar.*` runtime class activation 대신 사용할 수 있는 다른 shell service / COM service / contract bridge가 있는지

---

## 5. 수동 조사 필요 항목

### 5.1 우선순위 높은 항목

- `Spy++`
  - Game Bar가 화면에 떠 있는 순간 top-level / child HWND 확인
- `API Monitor`
  - `CreateWindowInBand*`, `SetWindowBand`, `DCompositionCreateDevice*` 호출 추적
- `cdb` / `WinDbg classic` / `x64dbg`
  - `GameBar.exe`, `GameBarFTServer.exe`, 필요 시 `dwm.exe` 호출 스택 관찰
- `Procmon`
  - `ms-gamebar:` 실행 직후 프로세스 / 파일 / 레지스트리 활동 비교
- `Process Explorer`
  - Game Bar 표시 직후 자식 프로세스 / 모듈 / handle 관찰

### 5.2 현재 막힌 점

이제 classic debugger 자체는 확보됐다.

- `cdb`
- `WinDbg classic`

경로:

- `C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe`
- `C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\windbg.exe`

설치 방식:

- `winsdksetup.exe /features OptionId.WindowsDesktopDebuggers /quiet /norestart`

즉 현재 병목은 `디버거 부재`가 아니라,
`WinDbg Preview(AppX/MSIX) 경로는 여전히 0x80070005로 깨져 있지만`,
`classic debugger로는 이미 충분히 파고들 수 있다`는 쪽으로 바뀌었다.

다만 아래 도구는 Store 없이 공식 ZIP으로 로컬에 준비해둘 수 있었다.

- `C:\Users\esihun\Desktop\tools\sysinternals\ProcessExplorer_extracted\procexp64.exe`
- `C:\Users\esihun\Desktop\tools\sysinternals\Procmon_extracted\Procmon64.exe`

반대로 아래는 현재 로컬에서 이미 사용 가능하다.

- `Spy++`
- `API Monitor`
- `x64dbg`
- `Inspect.exe`
- `Process Explorer`
- `Procmon`
- `frida-tools`
- `rizin`
- `handle.exe`
- `Listdlls.exe`

또한 `Procmon`은 headless 캡처가 실제로 가능함을 확인했다.

- 캡처 스크립트
  - `scripts/gamebar/capture-gamebar-procmon.ps1`
- CSV 내보내기 스크립트
  - `scripts/gamebar/export-procmon-log.ps1`
- Procmon 요약 스크립트
  - `scripts/gamebar/summarize-procmon-gamebar.ps1`
- Procmon 시작 순서 요약 스크립트
  - `scripts/gamebar/summarize-procmon-startup.ps1`
- Procmon CLSID 해석 스크립트
  - `scripts/gamebar/resolve-procmon-clsids.ps1`
- FT 서버 로그 요약 스크립트
  - `scripts/gamebar/summarize-ftserver-log.ps1`
- WinMD / IDL 덤프 스크립트
  - `scripts/gamebar/dump-gamebar-winmd.ps1`
- ETL 요약 스크립트
  - `scripts/gamebar/summarize-gamebar-etl.ps1`
- ETL 이력 요약 스크립트
  - `scripts/gamebar/summarize-gamebar-etl-history.ps1`
- 윈도우 polling 스크립트
  - `scripts/gamebar/capture-gamebar-window-poll.ps1`
- UIA tree 스크립트
  - `scripts/gamebar/capture-gamebar-uia-tree.ps1`
- HWND tree 스크립트
  - `scripts/gamebar/capture-gamebar-hwnd-tree.ps1`
- 패키지 요약 스크립트
  - `scripts/gamebar/summarize-gamebar-package.ps1`
- 바이너리 요약 스크립트
  - `scripts/gamebar/summarize-gamebar-binaries.ps1`
- 경량 구조 패스 러너
  - `scripts/gamebar/run-gamebar-structural-pass.ps1`
- 전체 패스 러너
  - `scripts/gamebar/run-gamebar-research-pass.ps1`

다만 현재 환경에서는 `Procmon`이 필터 없이 전체 시스템 이벤트를 과도하게 수집해
`run-gamebar-research-pass.ps1`가 불안정해질 수 있었다.
반대로 아래 경량 러너는 현재 환경에서 안정적으로 끝까지 실행된다.

- `scripts/gamebar/run-gamebar-structural-pass.ps1`

또한 `winget`으로 `WinDbg`와 일부 Store 경로 설치는
Microsoft Store 단계에서 `0x80070005`로 실패했다.

즉 현재 병목은 `GUI 도구 자체의 부재`라기보다,
`classic debugger는 확보됐고, 이제 남은 건 더 깊은 호출 시점/프로세스 경로를 잡는 일`에 가깝다.

---

## 6. 현재 결론

현재 자동 조사만으로도 다음 정도는 말할 수 있다.

- `Game Bar`는 일반 UWP 앱보다 훨씬 특권적인 패키지 구조를 가진다
- `Real Overlay`류 제품이 존재한다면, 단순한 topmost 창보다 `window band / composition / DWM 하부 경로`를 쓸 가능성이 높다
- 동시에 Game Bar 자체도 `fullscreen 대상 판정`, `설치 게임 탐지`, `GPU/런처 환경 스캔`을 별도 서비스 프로세스에서 수행하는 것으로 보인다
- 하지만 `GameBar.exe` startup 초반 그 자체는 `CoreMessaging + USER32!CreateWindowExW + Windows.UI.Xaml` 경로를 직접 타며, 적어도 이 구간에선 `CreateWindowInBand`가 주 경로라고 보이지 않는다
- `GameBarFTServer.exe`를 직접 attach 하면 hidden helper window / COM server startup 흔적은 잘 잡히지만, 그 구간에서 `EnumWindows`, `QueryDisplayConfig`, `CreateDXGIFactory*`, `CreateWindowInBand*`가 바로 돌지는 않았다
- `Frida` 기준으로도 FTServer는 현재 구간에서 `dwmapi/dcomp`를 직접 로드하지 않았고, UI 프로세스는 반대로 `dcomp/dxgi` export를 갖고 있지만 attach 이후 직접 호출 샘플은 없었다
- 다만 `probe-first` 조건에선 FTServer가 borderless fullscreen Win32 창을 실제 target으로 잡고, `GetWindowRect`, `MonitorFromWindow`, `GetMonitorInfoW`, `GetWindowThreadProcessId`를 반복 호출하는 것이 실증됐다
- `rizin` 정적 분석으로도 FTServer의 fullscreen helper는 `GetDesktopWindow / GetShellWindow / IsWindowVisible / explorer.exe 제외 / GetWindowRect / MonitorFromWindow / GetMonitorInfoW` 조합임이 사실상 확정됐다
- 반면 `GameBar.exe` 쪽은 `GamingOverlayBroker`, `HostedView`, `ClickThrough`, `InputDelegationManager`, 대량의 `Windows.UI.Xaml.*` 타입이 직접 드러나서, UI/입력/창 영역 제어는 이 private broker abstraction 주도로 보인다
- broker runtime과 Win32 probe를 합치면, 이 `GamingOverlayBroker`는 실제로 `AgileImmersiveShellBroker / ApplicationView` 계층으로 연결되고 일반 Win32 프로세스에서도 최종 interface 획득이 가능하다
- 게다가 `Game Bar`가 떠 있는 상태에서는 외부 Win32 프로세스에서 `Show/Hide/ResetWindowRect/SetClickThrough`가 모두 `S_OK`로 돌아온다
- 추가로 `CuiWidgetAdapter` 정적 요약까지 합치면, broker path와 widget-host path는 이미 상당히 분리해서 볼 수 있다
- 긍정적인 부분은 `broker/state control`이 외부 Win32에 열려 있다는 점이고, 부정적인 부분은 `custom widget launch + visual attach`가 아직 packaged widget contract에 묶여 보인다는 점이다
- 여기에 더해 plain Win32에서 `GameBar.CuiWidgetAdapter`, `GameBar.WidgetControlHost` 등 runtime class activation이 전부 `REGDB_E_CLASSNOTREG`로 실패했기 때문에, 최소한 `runtime class 직접 활성화` 경로는 현재로선 거의 아니라고 봐도 된다
- packaged `GameBar.exe` / `GameBarFTServer.exe` 내부에서도 `GameBar.*`, `XboxGameBarFT.*` 이름은 direct WinRT activation class로는 계속 `REGDB_E_CLASSNOTREG`였고, 대신 `XboxGameBarFT.GbftFactory`는 `COM CLSID -> IActivationFactory -> ActivateInstance` 경로로만 정상 활성화됐다
- 일반 plain Win32 프로세스도 `CoCreateInstance -> IActivationFactory -> ActivateInstance`로 `XboxGameBarFT.GbftFactory` runtime class까지는 얻을 수 있었지만, `IGbftFactory`로의 `QueryInterface`는 `0x80073D54`에서 막혔다
- 게다가 plain Win32에서 activated `IInspectable`를 default interface처럼 직접 두드리려는 시도는 `AccessViolation`로 바로 깨졌기 때문에, 외부 프로세스가 `GbftFactory` 실사용 슬롯에 바로 접근하는 경로는 현재 증거상 막혀 있다고 보는 편이 맞다
- 반대로 같은 packaged FT COM 경로에서 `AppTargetManagerFT`, `WindowManagerFT`, `GameConfigStoreFT`, `InputFocusTrackerFT`는 전부 `S_OK`로 생성되며, 이 helper surface는 packaged Game Bar 프로세스 내부에서는 실제 메서드 호출까지 가능했다
- 실제 method probe 결과도 갈린다. `GameConfigStoreFT.EntryExistsForHwnd(desktop/shell)`는 `S_OK` + `false`, `InputFocusTrackerFT.GetLatestInputFocusEvent()`는 `S_OK` + `null`, `AppTargetManagerFT.Target`는 `S_OK` + `null`이었고, `WindowManagerFT.GetWindowLong(desktop/shell)`는 `S_OK`로 정상 style / exstyle 값을 반환했다
- 따라서 `XboxGameBarFT`는 단순한 public WinRT surface가 아니라, `runtime class 표면 자체는 보이지만 실사용 helper interface/method layer는 더 강하게 gate된 FT COM surface`로 보는 편이 현재 증거와 더 잘 맞는다
- 따라서 `GameBar.* 문자열 = direct activatable runtime class`라는 가설은 현재 증거상 성립하지 않는다
- 대신 `XboxGameBarFT`는 `외부 plain Win32에서도 일부 activation 흔적은 보이지만 helper interface/method 실사용은 gate된 FT COM surface`, `broker`는 `shell-state dependent control surface`, `widget host`는 그보다 더 내부적인 contract surface로 층이 나뉜다고 보는 편이 가장 자연스럽다
- cold-start `GetProcAddress` 패스에서도 `CreateWindowInBand`, `SetWindowBand`, `DwmpDxGetWindowSharedSurface`, `DCompositionCreateDevice*` 같은 이름은 직접 관측되지 않았다
- 즉 fullscreen target 판정 자체는 생각보다 하위 undocumented API가 아니라 일반 USER32 경로에 더 가깝고, 남은 미지수는 `ImmersiveShell broker`가 어디까지 public-ish하게 열려 있는지와 `custom hosted view` 생성 가능성이다
- 반대로 이제는 `패키지 특권이 아니면 broker 접근 자체가 불가능하다`고 보긴 어렵다
- 하지만 `custom hosted view` 가능성은 이전보다 보수적으로 봐야 한다. 지금까지 증거 기준으론 `broker control`은 열려도 `widget host class`는 직접 열리지 않는다
- `show/hide/set_click_through_true/set_click_through_false`가 모두 `S_OK`였는데도 top-level UIA 가시성은 거의 그대로였기 때문에, broker 제어 대상은 여전히 `일반 top-level HWND`보다 `숨은 host + composition child visual`에 더 가까워 보인다
- 추가로 우리 `GameBarOverlay` 패키지 앱을 별도 packaged probe로 재활용하려 했지만, 현재 standalone activation은 `COM ActivateExtension` 단계 실패와 direct launch crash로 막혀 있다. 즉 "아무 packaged app이면 FT helper가 열리는가"는 아직 완전히 닫히지 않았다
- 가장 큰 최근 진전은 `WindowManagerFT`가 packaged `GameBar.exe`와 `GameBarFTServer.exe` 내부에서 임의 외부 Win32 HWND를 실제로 받아들인다는 점이다
- 구체적으로 fullscreen probe window에 대해 두 프로세스 모두 `GetWindowLong`, `ShowWindow`, `EnableClickThrough`, `DisableClickThrough`, `SetWindowLong`이 전부 `S_OK`였고, raw USER32 snapshot에서도 style / exstyle / visible 상태 변화가 그대로 확인됐다
- 특히 `EnableClickThrough`는 `0x00050008 -> 0x000D0028`로 `WS_EX_TRANSPARENT(0x20)`와 `WS_EX_LAYERED(0x80000)`를 추가했고, `DisableClickThrough`는 이를 다시 원복했다
- `SetWindowLong(-20, baseline|0x20)`도 `S_OK`였고 raw exstyle이 `0x00050028`로 바뀐 뒤 다시 `0x00050008`로 복원됐다
- 반면 같은 임의 HWND의 `band`는 before / show / click-through / set-long / restore 전 구간에서 계속 `1`이었다
- 즉 현재 증거상 `WindowManagerFT`는 arbitrary HWND 제어는 가능하지만, 이 경로만으로는 `특수 window band 승격`이나 `shell overlay layer 편입`이 보이지 않는다
- `ShowWindow(SW_HIDE)`는 두 프로세스 모두 `S_OK`였고 probe HWND는 곧바로 invalid가 됐다. 다만 이 부분은 현재 probe가 `WinForms ShowDialog()` 기반이라, hide 뒤에 창/프로세스가 종료되는 현상이 helper의 강제 destroy인지 modal-dialog 특성인지까지는 아직 단정하지 않는다
- 당장 제품 관점에선 기존 `GameBarOverlay` 경로가 여전히 가장 현실적이다
- 대체 경로를 더 파려면 이제부터는 `broker 메서드 시그니처 매핑`과 `custom hosted view 생성 경로`를 더 파야 한다

### 6.6 ImmersiveShell broker registry 정체

- 외부 Win32에서 접근한 broker CLSID `{59614133-BFB4-4906-90AF-C44F15167F1A}`는 레지스트리상 `AgileImmersiveShellBroker`이며, AppID는 `ImmersiveShellBrokers` `{2FD08A73-D1F1-43EB-B888-24C2496F95FD}`였다
- 이 AppID는 `RunAs=Interactive User`이고 별도 `LocalService`는 없었다. 즉 최소한 등록 표면만 보면 `GameBar` 전용 broker가 아니라 `immersive shell` 계열 local server로 보는 편이 더 자연스럽다
- broker 체인의 `primary IID` `{9767060C-9476-42E2-8F7B-2F10FD13765C}`는 `OneCoreUAPCommonProxyStub.dll`이 marshalling을 맡고, 최종 `final IID` `{30DAD006-CF4A-45E0-AEC1-2195D76FD9C0}`는 `ActXPrxy.dll`이 맡는다
- 이 조합은 현재까지 `GameBar` 패키지 전용 private proxy/stub보다 `shell/common COM surface`라는 해석을 더 지지한다

### 6.7 Broker method -> shell/Game Bar API trace

- `run-broker-api-trace-pass.ps1`로 `hide`, `show`, `reset_window_rect`, `set_click_through_true`, `set_click_through_false`를 각각 호출하면서 `GameBar.exe`, `explorer.exe`, `ShellHost.exe`, `ApplicationFrameHost.exe`, `StartMenuExperienceHost.exe`, `Widgets.exe`, `WidgetService.exe`, `TextInputHost.exe`에 Frida API trace를 걸었다
- `StartMenuExperienceHost.exe`, `Widgets.exe`, `WidgetService.exe`, `TextInputHost.exe` 그룹은 다섯 메서드 모두에서 의미 있는 user32/dcomp/dwm activity가 전혀 보이지 않았다
- 반대로 `GameBar.exe + explorer.exe` 그룹에서는 `show`와 click-through 계열에서만 의미 있는 activity가 잡혔다
- `show` 시점에는 `GameBar.exe`가 `HWND 0xB0804`에 대해 `SetWindowLongW(index=0x18)`와 `SetWindowLongPtrW(index=-2)`를 반복 호출했고, 같은 `HWND 0xB0804`에 대해 `GetWindowRect`, `GetAncestor`, `MonitorFromWindow`, `GetMonitorInfoW`를 호출했다
- 같은 `show` 시점에 `explorer.exe`는 `HWND 0x13081E`, `0x9080E`, `0x101E0`, `0x101E4` 등을 대상으로 `GetWindowRect`, `GetWindowBand`, `ShowWindow`, `SetWindowPos`, `DwmSetWindowAttribute`, `DCompositionCreateSurfaceHandle`를 호출했다
- `set_click_through_true/false` 시점에는 `explorer.exe` 쪽에서 `SetWindowLongW(index=-20)`와 `GetWindowBand`가 관측됐다
- `reset_window_rect`는 `explorer.exe` 쪽의 `GetWindowRect`, `MonitorFromWindow`, `GetMonitorInfoW`, `GetWindowBand` 정도만 보였다
- 중요한 점은, 이 패스에서는 `SetWindowBand`, `CreateWindowInBand`, `CreateWindowInBandEx`가 직접 잡히지 않았다는 것이다
- 따라서 현재 증거상 broker 제어는 `GameBar` 단독이 아니라 `GameBar.exe의 fullscreen-sized host HWND + explorer shell/composition surface`를 함께 건드리는 쪽에 더 가깝다
- 즉 이번 단계까지의 해석은 `마지막 overlay 성립 지점이 GameBar 프로세스 하나 안에만 있지는 않다`는 쪽으로 더 기울었다

### 6.8 WindowManagerFT arbitrary HWND probe

- `run-windowmanager-external-hwnd-pass.ps1`로 외부 Win32 probe window를 하나 띄운 뒤, `GameBarFTServer.exe`와 `GameBar.exe` 내부 Frida probe에서 `XboxGameBarFT.GbftFactory -> WindowManagerFT`를 생성해 그 HWND를 직접 넘겨봤다
- 대표 결과는 `docs/artifacts/gamebar-windowmanager-external-hwnd-20260315-171701/summary.json`이다
- 이 패스에서 두 프로세스 모두 다음이 실증됐다
  - `GetWindowLong(hwnd, -16 / -20)` -> `S_OK`
  - `ShowWindow(hwnd, SW_SHOW)` -> `S_OK`
  - `EnableClickThrough(hwnd)` -> `S_OK`
  - `DisableClickThrough(hwnd)` -> `S_OK`
  - `SetWindowLong(hwnd, -20, baseline | 0x20)` -> `S_OK`
  - `SetWindowLong(hwnd, -20, baseline)` -> `S_OK`
- raw USER32 snapshot 결과도 동일하게 맞았다
  - baseline: `style=0x17010000`, `exstyle=0x00050008`, `visible=true`, `band=1`
  - `EnableClickThrough` 후: `exstyle=0x000D0028`
  - `DisableClickThrough` 후: `exstyle=0x00050008`
  - `SetWindowLong` 후: `exstyle=0x00050028`
  - restore 후: `exstyle=0x00050008`
- 즉 `WindowManagerFT`는 packaged Game Bar 내부에서 `desktop/shell HWND 조회용 helper` 수준을 넘어, 일반 외부 Win32 창의 style / exstyle / visibility를 실제로 바꾸는 helper surface로 볼 수 있다
- 하지만 같은 구간에서 `band`는 계속 `1`이었다. 따라서 현재 증거상 `WindowManagerFT`가 arbitrary HWND를 `special overlay band`로 올려주는 것은 아니다
- 이 결과는 구현 가능성 해석을 꽤 바꾼다
  - 긍정적: packaged helper 층은 임의 Win32 HWND를 실제로 받아들인다
  - 부정적: 이 helper만으로는 fullscreen shell overlay의 `마지막 z/composition 승격`은 설명되지 않는다
- 따라서 남은 핵심은 더 좁아졌다. 지금 병목은 `WindowManagerFT가 arbitrary HWND를 받는가`가 아니라, `그 HWND를 shell/composition overlay layer에 편입시키는 별도 경로가 있는가`이다
- 참고로 같은 probe를 `windowed` variant로 돌리려 했지만, 현재 probe harness는 창 정보 파일 생성 전에 끝나서 아직 비교가 안 됐다. 즉 fullscreen 의존성 여부는 아직 미확정이다

### 6.9 Arbitrary HWND shell backtrace 패스

- `run-windowmanager-shell-backtrace-pass.ps1`로 fullscreen probe HWND를 먼저 만든 뒤, `explorer.exe`, `GameBar.exe`, `ShellHost.exe`, `ApplicationFrameHost.exe`에 `watch-hwnd + backtrace` Frida trace를 걸고 `WindowManagerFT` arbitrary HWND probe를 실행했다
- 대표 결과는 `docs/artifacts/gamebar-windowmanager-shell-backtrace-20260315-175205/summary.json`이다
- 이 패스에서 반복적으로 확인된 것은 다음이다
  - `explorer.exe`는 이미 만들어진 arbitrary fullscreen HWND를 대상으로 `GetWindowBand`, `GetClassNameW`, `MonitorFromWindow`를 반복 호출했다
  - 일부 런에서는 `GetWindowRect`, `GetAncestor`, `GetWindowThreadProcessId`도 같은 HWND를 대상으로 호출됐다
  - `WindowManagerFT` host가 `GameBar.exe`일 때는 같은 arbitrary HWND에 대해 `GameBar.exe` 자체가 `GetWindowBand`를 반복 호출하고 `ShowWindow`도 직접 호출했다
  - 반대로 `WindowManagerFT` host가 `GameBarFTServer.exe`일 때는 이 `GameBar.exe -> arbitrary HWND` 직접 호출이 관측되지 않았다
- 이 패스에서 중요한 부정 신호도 있었다
  - probe HWND가 이미 만들어진 뒤 trace를 붙인 구간에서는 `SetWindowBand`, `CreateWindowInBand`, `CreateWindowInBandEx`, `DwmpDxGetWindowSharedSurface`, watched `DwmSetWindowAttribute`가 관측되지 않았다
  - 즉 이미 존재하는 arbitrary HWND를 `WindowManagerFT`로 조작하는 단계만 놓고 보면, 현재까지는 `band 승격`이나 `DWM private surface 편입` 증거가 없다
- 해석
  - `explorer.exe`가 arbitrary fullscreen HWND를 적극적으로 살펴보는 것은 맞다
  - 그러나 이 시점의 shell 반응은 현재까지 `generic fullscreen-window inspection`과 `GameBar host가 추가로 HWND를 만지는 단계` 정도로 보이며, 곧바로 `special overlay layer 승격`으로 이어진다는 증거는 아니다

### 6.10 Fullscreen control 패스와 DWM cloak 재해석

- `run-probe-window-shell-control-pass.ps1`로 `WindowManagerFT`를 전혀 호출하지 않고, fullscreen probe window만 띄운 control trace를 여러 번 수집했다
- 대표 결과는 `docs/artifacts/gamebar-probe-window-shell-control-20260315-175846/summary.json`이다
- 중요한 점은 `Game Bar`를 아예 띄우지 않고(`-SkipLaunchGameBar`) trace 대상도 `explorer.exe`만 둔 control 패스에서도 같은 HWND에 대해 다음이 계속 잡혔다는 점이다
  - `GetWindowBand`
  - `GetClassNameW`
  - `MonitorFromWindow`
  - 일부 런에서 `GetWindowRect`
  - `DwmSetWindowAttribute`
- `DwmSetWindowAttribute`는 인자상 `attr=0xD`, `cb=4`였고, SDK 헤더 `dwmapi.h` 기준 `DWMWA_CLOAK`에 해당한다
  - `C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um\dwmapi.h`
  - line 54: `DWMWA_CLOAK // [set] Cloak or uncloak the window`
- 이 결과는 해석을 크게 바꾼다
  - 이전의 `explorer.exe -> DwmSetWindowAttribute(hwnd)` 신호는 `Game Bar / WindowManagerFT 전용 경로`가 아니라, fullscreen probe window 생성 자체에 대한 `generic shell reaction`일 가능성이 높다
  - 즉 `explorer.exe`의 `DWMWA_CLOAK`만으로는 `Game Bar overlay 편입 지점`을 설명할 수 없다
- 따라서 현재 differential signal은 오히려 다른 쪽이다
  - plain fullscreen control에서도 `explorer.exe` 쪽 shell query / cloak는 발생한다
  - `GameBar.exe`가 arbitrary HWND에 대해 직접 `GetWindowBand` / `ShowWindow`를 호출하는 것은 `WindowManagerFT`를 `GameBar.exe` 내부에서 호스트했을 때만 추가로 보인다
- 현재까지의 결론
  - `explorer.exe`의 `DWM cloak`는 generic shell/fullscreen 처리
  - `Game Bar` 특이 경로는 여전히 `GameBar.exe host + broker/composition handshake` 쪽이 더 유력
  - 따라서 남은 핵심은 `explorer cloak`가 아니라, `GameBar host가 arbitrary HWND 또는 별도 hosted surface를 어떤 shell/composition layer에 연결하는가`이다
- 참고로 우리 `GameBarOverlay` 패키지를 AUMID로 standalone activation하려 했을 때는 현재 `0x8027025B`로 시작 실패가 나왔다. 따라서 `아무 packaged app이면 FT helper가 열리는가`는 여전히 미해결이다

### 6.11 `SetAppFrameHwnd`와 `SetCombinedWindowRegion` 경로 재확인

- 현재 설치 버전 `Microsoft.XboxGamingOverlay_7.325.10021.0_x64__8wekyb3d8bbwe` 기준으로 `GameBar.exe` 복사본을 다시 열어 정적 분석을 반복했다
- `fcn.14025bc60`은 여전히 `SetAppFrameHwnd` helper로 보이며, 다음 흐름을 가진다
  - 객체 `+0x290`의 `coreWindowHwnd`를 읽는다
  - `GetAncestor(coreWindowHwnd, 2)`를 호출한다
  - 반환된 ancestor를 객체 `+0x288`에 `AppFrameHwnd`로 저장한다
  - 로그 문자열도 그대로 붙어 있다
    - `SetAppFrameHwnd: coreWindowHwnd(%I64u), ancestorHwnd(%p)`
    - `SetAppFrameHwnd: AppFrameHwnd(%I64u) found`
- 이 경로는 `Game Bar`가 최종 shell/broker 제어를 `CoreWindow`가 아니라 `AppFrameHwnd` 기준으로 묶는다는 점을 다시 확인해 준다
- 이전 버전에서 확인했던 `UpdateWindowRegionForPinnedOnlyAsync`의 문자열
  - `GamingOverlayBroker().Show()`
  - `GamingOverlayBroker().Hide()`
  - `GamingOverlayBroker().SetCombinedWindowRegion() failed`
  - `m_appFrameHwnd not set. Falling back to EM SetCombinedWindowRegion`
  과 결합하면, 현재 해석은 더 강해진다
- 즉 `BrokerShow/Hide`만 있는 것이 아니라, 그 전에 `AppFrameHwnd`를 찾고 `SetCombinedWindowRegion`을 통해 shell 쪽 region을 갱신하는 단계가 실제 핵심 후보이다

### 6.12 broker `show` 시 explorer shell 모듈 체인 식별

- `trace_gamebar_frida.py`를 연구용으로 확장해 모든 샘플에 backtrace를 저장할 수 있게 했다
- 새 결과
  - `docs/artifacts/gamebar-broker-show-frida-bt-20260315-185855.json`
  - `docs/artifacts/gamebar-broker-hide-show-frida-bt-20260315-185959.json`
  - `docs/artifacts/gamebar-broker-show-cdb-20260315-185338/explorer.log`
  - `docs/artifacts/gamebar-broker-show-cdb-20260315-185338/gamebar.log`
- 동적 결과의 핵심은 `explorer.exe` 반응이 단순 generic top-level window 제어가 아니라, 구체적인 shell 모듈 체인 위에서 나온다는 점이다
  - `DwmSetWindowAttribute(DWMWA_CLOAK)` backtrace 주소를 현재 explorer 모듈 맵에 대입하면 `twinui.dll` / `twinui.pcshell.dll` 범위에 걸린다
  - `ShowWindow` / 일부 `GetWindowRect`는 `twinui.dll` 계열 COM/RPC 경로 위에서 호출된다
  - `GetWindowBand`의 backtrace 주소는 `Taskbar.dll` 범위에 걸린다
  - `SetWindowLongPtrW`, `GetAncestor`, `GetWindowThreadProcessId`의 주요 backtrace 주소는 `ApplicationFrame.dll`과 `Taskbar.dll` 범위에 걸린다
- 대표 해석
  - broker `show`는 `explorer` 안에서 `twinui.pcshell + twinui + Taskbar + ApplicationFrame` 조합을 깨운다
  - 즉 이전에 봤던 `explorer.exe`의 `DwmSetWindowAttribute`, `GetWindowBand`, `SetWindowLongPtrW`는 하나의 generic shell 반응이 아니라, `Composable Shell / ApplicationFrame / Taskbar` 계층이 결합된 실제 shell 처리 경로로 보는 편이 더 정확하다
- 이 결과는 중요한 분기점이다
  - `widget host`만으로 설명하기 어려운 shell 측 후처리 계층이 실제로 존재한다
  - 동시에 `arbitrary HWND를 그냥 band 승격`시키는 단순 모델도 약해진다
  - 현재까지 가장 유력한 모델은 `GameBar host(CoreWindow -> AppFrameHwnd) + GamingOverlayBroker + explorer shell composition` 결합 구조다
- `GameBar.exe` 쪽 cdb 로그도 같은 방향을 지지한다
  - `docs/artifacts/gamebar-broker-show-cdb-20260315-185338/gamebar.log`
  - broker `show` 직후 짧은 창에서는 `USER32!SetWindowLongW`가 `Windows_UI_Xaml!CJupiterWindow::CoreWindowSubclassProc` 경로에서 잡혔다
  - 즉 `GameBar.exe`는 적어도 자신의 쪽 host window를 `XAML/CoreWindow` 계층에서 직접 만지고 있다
- 현재까지의 의미
  - `explorer` 쪽 अंतिम 승격/배치 계층은 `twinui.pcshell / Taskbar / ApplicationFrame` 쪽 가능성이 높다
  - `GameBar.exe`는 자기 host window를 관리하고, `explorer`는 shell companion window/composition을 만지는 쪽으로 역할이 갈리는 그림이 더 자연스럽다
  - 따라서 최종 overlay 성립 지점은 `widget host 단독`보다 `GameBar host + shell companion surface` 쪽으로 더 좁혀졌다

### 6.13 raw shell backtrace 주소의 오프라인 심볼 해석

- `explorer.exe`에 다시 붙지 않고, `dbh.exe`를 이용해 `Taskbar.dll`, `ApplicationFrame.dll`, `twinui.dll`, `twinui.pcshell.dll`의 raw 주소를 오프라인으로 함수명까지 해석했다
- 결과 artifact:
  - `docs/artifacts/gamebar-shell-symbol-resolution-20260315.json`
  - 해석 스크립트:
    - `scripts/gamebar/resolve-symbol-addresses.ps1`
- 해석된 대표 함수
  - `twinui.pcshell.dll`
    - `FrameWrapper::PrepareFrameForDestroy+0x1e`
    - `FrameFactory::DestroyFrameWithWrapper+0x24`
    - `IViewWrapper/IViewEventArgs delegate invoke helper+0x1a`
  - `twinui.dll`
    - `CEdgeUiInput::Position+0x170`
    - `CEdgeUiManager::_LayoutEdgeUiInputs+0x1e5`
  - `Taskbar.dll`
    - `_IsValidWindowForShellHookMessage+0x33`
    - `CTaskBand::_HandleShellHook+0x72`
    - `CTaskBand::v_WndProc+0xd0b`
    - `CImpWndProc::s_WndProc+0x8e`
  - `ApplicationFrame.dll`
    - `CApplicationFrame::v_WndProc+0x168`
    - `CWRLImpWndProc<CApplicationFrame>::s_WndProcBase+0xa3`
    - `CWRLImpWndProc<CTitleBar>::s_WndProcBase+0x17d`
    - `<lambda_221dacdd06ccd66cd3dfa12ab74b7670>::operator()+0x74`
- 이 해석은 가설을 더 강하게 만든다
  - `explorer` 쪽 후처리는 단순 `DWM cloak` 호출 하나가 아니라
    - `FrameWrapper/FrameFactory`
    - `ApplicationFrame`
    - `Taskbar shell hook`
    - `Edge UI layout`
    계층이 함께 움직이는 shell pipeline에 가깝다
  - 특히 `FrameWrapper::PrepareFrameForDestroy`, `FrameFactory::DestroyFrameWithWrapper`는 shell side frame wrapper lifecycle이 실제로 관여한다는 신호다
  - `CTaskBand::_HandleShellHook`, `CTaskBand::v_WndProc`는 taskbar shell hook 경로가 broker `show/hide` 반응과 연결됨을 보여준다
  - `CApplicationFrame::v_WndProc`와 `CWRLImpWndProc<CApplicationFrame>::s_WndProcBase`는 `AppFrameHwnd` 가설과 매우 잘 맞는다
- 현재까지의 업데이트된 해석
  - 최종 overlay 성립 지점은 `GameBar widget host` 단독보다는
    - `GameBar CoreWindow host`
    - `AppFrameHwnd`
    - `GamingOverlayBroker().SetCombinedWindowRegion()`
    - `explorer shell companion frame/taskbar pipeline`
    의 결합 구조일 가능성이 더 높다
  - 즉 남은 핵심은 `SetCombinedWindowRegion`가 이 shell companion frame을 어떻게 잡아 region/surface를 갱신하는지 확인하는 것이다

### 6.14 `GamingOverlayExperienceManager::SetCombinedWindowRegion` 정적 분석

- `twinui.pcshell.dll` public symbol에서 `GamingOverlayExperienceManager::SetCombinedWindowRegion`를 다시 찾았고, 주소는 `0x134ee70` (`rizin` 기준 `0x18034ee70`)였다
- 대표 산출물:
  - `docs/artifacts/gamebar-twinui-setcombinedwindowregion-20260315.txt`
- 이 함수의 구현은 현재까지 예상보다 더 단순하고 직접적이다
  - 입력 rect 개수(`arg2`)와 rect 배열 포인터(`arg3`)를 받는다
  - 내부 객체 `this + 0xe8`를 먼저 확인한다
  - vtable 호출을 통해 최종 대상 window handle을 얻는다
  - 빈 `HRGN`을 만든 뒤(`CreateRectRgn(0,0,0,0)`)
  - rect 배열을 순회하면서 각 rect마다 `CreateRectRgn(...)`를 만든다
  - `CombineRgn(..., RGN_OR)`로 누적한다
  - 마지막에 `SetWindowRgn(hwnd, hrgn, TRUE)`를 직접 호출한다
- 이 함수 내부에서는 적어도 다음 경로가 보이지 않았다
  - `DwmSetWindowAttribute`
  - `DwmpDxGetWindowSharedSurface`
  - `CreateWindowInBand*`
  - `SetWindowBand`
- 즉 현재까지의 가장 강한 해석은 이렇다
  - `SetCombinedWindowRegion`의 "마지막 단계"는 DWM private surface가 아니라 shell companion window의 `window region` 갱신이다
  - 따라서 fullscreen overlay의 최종 외형/가시 영역은 적어도 이 단계에선 `정상 HWND + HRGN` 모델 위에 있다
- 이건 구현 가능성 해석에도 중요하다
  - 부정적: 마지막 window handle을 얻는 shell internal object는 아직 외부에 열려 있지 않다
  - 긍정적: 최종 렌더 형태 자체는 "완전히 비가시적인 DWM 전용 surface"가 아니라는 점이 드러났다

### 6.15 internal shell class activation 재검증

- `probe-gamebar-winrt-activation.ps1`와 `probe_packaged_identity_frida.py`에 다음 class를 추가해 다시 probe했다
  - `Microsoft.Windows.Shell.GamingOverlayExperienceManager`
  - `Windows.Internal.GamingOverlay.GameBarWindowControl`
- 대표 산출물:
  - `docs/artifacts/gamebar-winrt-activation-no-ui-20260315-v3.json`
  - `docs/artifacts/gamebar-winrt-activation-with-ui-20260315-v3.json`
  - `docs/artifacts/gamebar-packaged-identity-gamebar-20260315-v2.json`
  - `docs/artifacts/gamebar-packaged-identity-explorer-20260315-v1.json`
- 결과는 일관됐다
  - plain Win32 probe: 두 class 모두 `RoGetActivationFactory = 0x80040154`, `RoActivateInstance = 0x80040154`
  - `GameBar.exe` 내부 Frida probe: 동일하게 `0x80040154`
  - `explorer.exe` 내부 Frida probe: 동일하게 `0x80040154`
- `explorer.exe` 결과는 부가 정보도 준다
  - `GetCurrentPackageFullName` 계열 결과가 `0x00003D54`였고, package identity는 없었다
  - 즉 `explorer.exe`는 packaged process가 아니다
  - 그런데도 `XboxGameBarFT.GbftFactory`는 `CoCreateInstance -> IActivationFactory -> ActivateInstance`까지는 된다
  - 하지만 `IGbftFactory` `QueryInterface`는 여전히 `0x8000000F`로 막힌다
- 현재 해석
  - `GamingOverlayExperienceManager`와 `GameBarWindowControl`은 외부 WinRT activation class가 아니다
  - 심지어 `GameBar.exe` 안에서도 직접 `RoGetActivationFactory`로 여는 표면이 아니다
  - 따라서 shell companion layer는 `등록된 runtime class`보다는 `twinui.pcshell` 내부 객체 / broker bridge / private COM chain`에 더 가까운 것으로 보인다

### 6.16 package manifest 재확인

- 설치 패키지 manifest를 직접 다시 읽어 봤다
  - `C:\Program Files\WindowsApps\Microsoft.XboxGamingOverlay_7.325.10021.0_x64__8wekyb3d8bbwe\AppxManifest.xml`
- manifest에서 실제로 확인되는 것은 다음뿐이다
  - `GameBarFTServer.exe` COM server
    - `GbftComFactory` CLSID `FD06603A-2BDF-4BB1-B7DF-5DC68F353601`
  - `Microsoft.Gaming.XboxGameBar.winmd` 기반 private proxy stub 등록
  - `microsoft.gameBarUIExtension` appExtensionHost
  - `runFullTrust`, `gameBarServices`, `shellExperience` 등 capability
- 반대로 manifest에 **없다**
  - `GameBar.CuiWidgetAdapter`
  - `GameBar.WidgetControlHost`
  - `XboxGameBarFT.*`
  - `Microsoft.Windows.Shell.GamingOverlayExperienceManager`
  - `Windows.Internal.GamingOverlay.GameBarWindowControl`
  의 `windows.activatableClass.inProcessServer` 등록
- 이건 6.15의 activation 실패와 정확히 맞아떨어진다
  - 즉 이 이름들이 안 열리는 건 probe 문제라기보다, 애초에 일반 activatable class로 등록되지 않았기 때문이다
- 현재까지의 종합 해석은 더 선명해졌다
  - `XboxGameBarFT` helper는 `GbftComFactory` COM server + packaged context + private interface surface` 조합
  - `widget host` 쪽은 `proxyStub + appExtensionHost + private interface` 조합
  - `shell companion frame` 쪽은 `twinui.pcshell` 내부 객체로 보이며, manifest에 직접 노출된 activatable class는 아니다

### 6.17 현재 가설 업데이트

- 지금까지의 증거를 다시 합치면, 현재 가장 강한 모델은 아래와 같다
  - `GameBar.exe`
    - `CoreWindow/XAML host`를 유지
    - `SetAppFrameHwnd`로 `AppFrameHwnd`를 찾음
  - `GamingOverlayBroker`
    - `Show/Hide/ResetWindowRect/SetClickThrough`
    - `SetCombinedWindowRegion`
  - `explorer/twinui.pcshell`
    - `GamingOverlayExperienceManager::SetCombinedWindowRegion`
    - shell companion window에 대해 `SetWindowRgn` 수행
    - `ApplicationFrame / Taskbar / FrameWrapper` pipeline 처리
- 즉 마지막 overlay 성립 지점 후보는 이제 상당히 좁혀졌다
  - `widget host 단독` 가설: 더 약해짐
  - `DWM private surface 단독` 가설: 더 약해짐
  - 현재 최유력: `GameBar host + broker + twinui.pcshell shell companion window(region)` 결합
- 남은 핵심은 하나다
  - `SetCombinedWindowRegion`가 region을 거는 **그 shell companion HWND/control object를 외부에서 어떻게 얻거나 재현할 수 있느냐**
  - 여기가 열리면 PoC 가능성은 크게 오른다
  - 여기가 shell internal bridge에 묶여 있으면, 공식 Game Bar/UWP 셸이 계속 가장 현실적인 경로로 남는다

### 6.18 `twinui.pcshell!DllGetActivationFactory` direct probe

- 마지막으로 `RoGetActivationFactory` 등록 경로 자체를 우회해서, `twinui.pcshell.dll`을 직접 로드한 뒤 `DllGetActivationFactory` export를 호출해 봤다
- probe 스크립트:
  - `scripts/gamebar/probe-twinui-direct-activation.ps1`
- 산출물:
  - `docs/artifacts/gamebar-twinui-direct-activation-20260315.json`
- probe 대상 class
  - `Microsoft.Windows.Shell.GamingOverlayExperienceManager`
  - `Windows.Internal.GamingOverlay.GameBarWindowControl`
  - 비교용 `Windows.Internal.Shell.Taskbar.TaskbarFrame`
- 결과
  - `LoadLibrary("twinui.pcshell.dll")` 성공
  - `GetProcAddress("DllGetActivationFactory")` 성공
  - 그러나 세 class 모두 `DllGetActivationFactory = 0x80040111`
  - 즉 `CLASS_E_CLASSNOTAVAILABLE` 수준으로 factory를 주지 않았다
- 이 결과는 의미가 크다
  - `RoGetActivationFactory`가 막히는 이유가 단순히 registration 누락만은 아니라는 뜻이다
  - 적어도 `twinui.pcshell.dll`은 이 이름들을 일반 activation class처럼 직접 내놓지 않는다
  - 따라서 현재 보이는 `GameBarWindowControl` / `GamingOverlayExperienceManager` 문자열은
    - public WinRT activation class
    - manifest activatable class
    - direct `DllGetActivationFactory` 대상
    가 아니다
- 현재까지의 해석은 더 보수적으로 바뀐다
  - shell companion layer는 `activation class`가 아니라, broker/COM/private C++ object 경로일 가능성이 더 높다
  - 즉 남은 핵심은 `class activation`이 아니라 `broker interface / internal object creation path`를 찾는 쪽이다

### 6.19 broker final object의 `IInspectable`/IID surface probe

- 새 probe 스크립트:
  - `scripts/gamebar/probe-gamebar-broker-inspectable.ps1`
- 대표 산출물:
  - `docs/artifacts/gamebar-broker-inspectable-no-ui-20260315.json`
- `AgileImmersiveShellBroker -> slot12 query-service-like -> final broker` 체인으로 얻은 객체에 대해 `IInspectable::GetIids / GetRuntimeClassName / GetTrustLevel`를 직접 호출했다
- 결과는 예상보다 흥미로웠다
  - `primary` object (`9767060c-9476-42e2-8f7b-2f10fd13765c`)
    - `IInspectable`를 지원하지 않았다 (`E_NOINTERFACE`)
  - `service` / `final` object
    - 같은 pointer / 같은 vtable (`combase.dll` proxy)였다
    - `IInspectable`는 지원했다
    - 그러나 `GetRuntimeClassName`, `GetTrustLevel`은 둘 다 `0x80004001`
      - 즉 runtime class name을 순수하게 노출하는 projected WinRT object라기보다, remote COM/WinRT proxy 성격이 강하다
  - `GetIids()`는 아래 4개를 돌려줬다
    - `30dad006-cf4a-45e0-aec1-2195d76fd9c0`
    - `00000038-0000-0000-c000-000000000046` (`IWeakReferenceSource`)
    - `5eac68f9-e031-4c66-b4ea-5ab6aff979c8`
    - `d6332df0-dbfb-575e-93f1-c7bff0693913`
- 추가 probe 결과
  - `GetIids()`로 나온 4개를 다시 `QueryInterface` 해보면
    - `30dad...`, `5eac...`, `d633...`는 전부 성공
    - 세 인터페이스는 모두 같은 proxy family(vtbl `0x7ffde8d3c3e0`)를 가리킨다
    - `IWeakReferenceSource`는 별도 pointer지만 결국 같은 object surface를 되돌린다
  - 레지스트리에서 이름이 확인된 건 `IWeakReferenceSource`뿐이었다
    - `5eac...`, `d633...`는 `HKCR\\Interface`에 이름이 없다
- 해석
  - 외부 Win32가 잡은 `final` object는 단일 인터페이스가 아니라, 최소 3개의 hidden broker-facing IID를 가진 remote proxy다
  - 이 중 하나는 `GameBar.exe` 문자열에 드러난 `IGamingOverlayBroker` 쪽, 다른 하나는 `GameBarWindowControlBroker` 쪽일 가능성이 높다
  - 반대로 `GetRuntimeClassName`이 끝까지 안 나오는 점은, 이 surface가 일반 WinRT activation class가 아니라 broker/private object를 COM proxy로 감싼 형태라는 해석을 더 강하게 만든다

### 6.20 `GameBar.exe` 내부 GUID cluster 재검증

- 전날 기록했던 `final IID 30dad...가 raw scan에 안 보인다`는 부분은 재검증 결과 틀렸다
- `GameBar.exe`에는 아래 6개 GUID가 한 군데 연속으로 묶여 있다
  - 파일 offset `0x8f7b00` / RVA `0x8f8f00` / VA `0x1408f8f00`
  - 순서:
    - `a3be5d0a-5420-50ee-a639-ff2ea687a270`
    - `5eac68f9-e031-4c66-b4ea-5ab6aff979c8`
    - `d6332df0-dbfb-575e-93f1-c7bff0693913`
    - broker CLSID `59614133-bfb4-4906-90af-c44f15167f1a`
    - primary IID `9767060c-9476-42e2-8f7b-2f10fd13765c`
    - final IID `30dad006-cf4a-45e0-aec1-2195d76fd9c0`
- 이 6개 raw GUID는 `GameBar.exe` 안에서 각각 1회만 나타난다
  - 즉 현재 설치 버전에선 `broker 관련 metadata blob` 하나로 보는 해석이 가장 자연스럽다
- 새 자동 스크립트 `scripts/gamebar/find-guid-cluster-xrefs.py`로 `.text` 전체를 `capstone` 기준 재스캔했다
  - 대표 산출물: `docs/artifacts/gamebar-guid-cluster-xrefs-20260316.json`
  - 결과: `0x1408f8f00 ~ 0x1408f8f5f`를 직접 참조하는 RIP-relative/imm instruction이 하나도 없었다
- 같은 이유로 `show/hide` 시 data breakpoint가 안 걸린 것도 설명이 된다
  - 이 GUID blob은 ordinary broker method hot path가 아니라
  - 더 이른 초기 metadata/proxy setup 단계에서 소비될 가능성이 높다
- 추가 확인
  - 8-byte absolute pointer 검색에서도 `0x1408f8f00 ~ 0x1408f8f5f`를 직접 가리키는 값은 없었다
  - 대신 blob 바로 뒤 문자열 영역 `0x1408f8fc8`만 두 군데에서 포인터로 참조됐다
  - 즉 이 구간은 코드 xref보다 `registration/descriptor table` 쪽에 더 가깝다
- `a3be5d0a-5420-50ee-a639-ff2ea687a270`는 여전히 `QueryInterface`에 `E_NOINTERFACE`였다
  - 따라서 같은 blob 안에 있어도, 현재 외부 Win32가 잡은 broker object surface 일부는 아니다

### 6.21 `IGamingOverlayBroker` / `GameBarWindowControlBroker` binary-only type surface

- `GameBar.exe` 문자열/RTTI surface를 다시 좁혀 보니, 내부 타입 이름이 더 선명하게 드러난다
  - `IGamingOverlayBroker`
  - `GameBarWindowControlBroker`
- 중요한 점은 이 두 이름이 `winmdidl`로 덤프한 IDL 어디에도 없다는 것이다
  - 즉 현재까지는 public/internal metadata type이라기보다
  - `binary 안에만 남아 있는 projected/private type` 쪽 해석이 더 맞다
- `IGamingOverlayBroker`는 아래 형태로 잡힌다
  - `TypedEventHandler<IGamingOverlayBroker, IInspectable>`
  - `delegate / implements_delegate / type@abi`
- `GameBarWindowControlBroker`는 아래 형태로 잡힌다
  - `TypedEventHandler<GameBarWindowControlBroker, GameBarWindowState>`
  - `delegate / implements_delegate / type@abi`
- 이 차이는 역할 추정에도 의미가 있다
  - `IGamingOverlayBroker`
    - `Show/Hide/ResetWindowRect/SetCombinedWindowRegion/GetDisplayMonitors` 로그 문자열과 자연스럽게 이어지는 main broker surface 후보
  - `GameBarWindowControlBroker`
    - `GameBarWindowState`와 묶여 있으므로, shell companion frame의 state/event layer 후보
    - 즉 최종 overlay 표시 그 자체보다는 `window state transition` 알림 또는 wrapper object 성격이 더 강하다
- 외부 Win32가 잡은 `final` proxy의 `GetIids()`는
  - `30dad...`
  - `5eac...`
  - `d633...`
  를 함께 돌려주므로, 현재 가장 그럴듯한 추정은 이렇다
  - `30dad...` = 외부 caller가 직접 만나는 broker-facing service contract
  - `5eac...`, `d633...` = 내부 projected type(`IGamingOverlayBroker`, `GameBarWindowControlBroker`)과 가까운 hidden IID 후보
- 아직 이름과 GUID를 1:1로 고정할 증거는 부족하다
  - 하지만 현재까지는 `5eac/d633 -> internal broker/control types`, `30dad -> 외부 proxy face` 모델이 가장 자연스럽다

### 6.22 hidden IID registry / proxy stub / service matrix

- 새 probe 스크립트:
  - `scripts/gamebar/probe-gamebar-broker-service-matrix.ps1`
- 대표 산출물:
  - `docs/artifacts/gamebar-broker-service-matrix-20260316.json`
- 레지스트리를 다시 확인해보니, 전날 `이름이 없다`고만 봤던 hidden IID 둘도 실제 `HKCR\Interface` 등록은 있다
  - `30dad006-cf4a-45e0-aec1-2195d76fd9c0`
    - `ProxyStubClsid32 = {C90250F3-4D7D-4991-9B69-A5C5BC1C2AE6}`
  - `5eac68f9-e031-4c66-b4ea-5ab6aff979c8`
    - `ProxyStubClsid32 = {C90250F3-4D7D-4991-9B69-A5C5BC1C2AE6}`
  - `d6332df0-dbfb-575e-93f1-c7bff0693913`
    - `ProxyStubClsid32 = {C90250F3-4D7D-4991-9B69-A5C5BC1C2AE6}`
  - `9767060c-9476-42e2-8f7b-2f10fd13765c`
    - `ProxyStubClsid32 = {95E15D0A-66E6-93D9-C53C-76E6219D3341}`
- CLSID를 풀어보면 역할 차이도 보인다
  - `{C90250F3-4D7D-4991-9B69-A5C5BC1C2AE6}`
    - `PSFactoryBuffer`
    - `InProcServer32 = C:\Windows\System32\ActXPrxy.dll`
  - `{95E15D0A-66E6-93D9-C53C-76E6219D3341}`
    - `PSFactoryBuffer`
    - `InProcServer32 = C:\Windows\System32\OneCoreUAPCommonProxyStub.dll`
- 이건 꽤 중요하다
  - `primary IID 9767...`는 `OneCoreUAPCommonProxyStub` 경로
  - `final/hidden IID 30da.../5eac.../d633...`는 모두 `ActXPrxy` generic proxy 경로
  - 즉 `primary broker`와 `service-facing broker interfaces`가 서로 다른 marshalling surface를 쓰는 구조다
- `primary` object의 slot12 query-service-like 호출 matrix를 다시 돌려 보면 더 명확해진다
  - `serviceGuid = final(30dad...)`일 때만 성공
  - 그 위에서 `riid = final / hidden1 / hidden2`는 모두 `S_OK`
  - 반대로 `serviceGuid = hidden1` 또는 `hidden2`는 어떤 `riid`를 넣어도 `0x80004001`
- 해석
  - `5eac...`와 `d633...`는 `30dad...`와 별도 서비스가 아니다
  - 둘 다 **같은 broker service(`30dad...`) 아래에 매달린 추가 인터페이스**다
  - 즉 현재 가장 자연스러운 모델은
    - `30dad...` = 외부 caller가 서비스 엔트리로 쓰는 broker-facing contract
    - `5eac...`, `d633...` = 그 서비스가 추가로 노출하는 hidden internal interfaces
- 이름 매핑은 아직 미확정이지만, 현재까지는 다음 해석이 가장 강하다
  - `IGamingOverlayBroker` = `30dad...` 또는 그에 아주 가까운 main control surface
  - `GameBarWindowControlBroker` = `5eac...` / `d633...` 중 하나인 state/event side-car interface
  - 남은 핵심은 결국 이 hidden side-car 중 어느 쪽이 실제 companion object/window state를 대표하는지 닫는 것이다

### 6.23 hidden side-car slot fuzz와 `hidden1.slot7` 후보

- 새 probe 스크립트
  - `scripts/gamebar/probe-gamebar-broker-slot.ps1`
  - `scripts/gamebar/run-broker-hidden-slot-pass.ps1`
- 대표 산출물
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-094943/summary.json`
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-095616/summary.json`
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-100644/summary.json`
- `30dad...` 메인 face 말고 `5eac...` / `d633...` 자체를 직접 호출해보면 패턴이 분명히 갈린다
  - `hidden1(5eac...)`
    - `slot6(noarg)` -> `0x800706F4`
      - low-word `0x06F4 = RPC_X_NULL_REF_POINTER`
      - 즉 이 메서드는 `null ref pointer`가 아닌 실제 pointer/out 인자를 기대하는 쪽으로 해석된다
    - `slot7(outptr)` -> `0x80040155`
      - `REGDB_E_IIDNOTREG`
      - 외부 Win32에서 가장 안정적으로 재현되는 `hidden1` 호출
    - `slot20(outptr)` -> `0x800706D1`
      - `RPC_S_PROCNUM_OUT_OF_RANGE`
  - `hidden2(d633...)`
    - `slot6(outptr)` -> `0x8007000E`
      - `E_OUTOFMEMORY`
    - `slot21(outptr)` -> `0x80004021`
      - `Operation is not supported`
    - `slot39(outptr)` / `slot52(outptr)` -> `0x800706D1`
      - `RPC_S_PROCNUM_OUT_OF_RANGE`
- 동적 trace도 같이 돌려 보면
  - `hidden1.slot7(outptr)`나 `hidden2.slot21(outptr)`는
  - `show/hide`처럼 `GameBar.exe` / `explorer.exe` shell API를 직접 크게 흔들지는 않는다
  - 즉 이 둘은 `표시/배치`보다 `broker 내부 object/state/materialization` 쪽일 가능성이 더 높다
- 현재까지의 해석
  - `hidden1`은 pointer/out 기반 method를 가진 main hidden broker face에 더 가깝다
  - 특히 `slot7(outptr)`는 **외부 Win32에서 unregistered interface/class를 materialize하려다 막히는 후보**로 가장 강하다
  - `hidden2`는 별도 보조 interface이지만, 적어도 현재까지는 `companion object 생성 경로`보다는 state/helper 쪽으로 보인다

### 6.24 `actxprxy.dll` 내부 hidden broker descriptor chain

- 새 대표 산출물
  - `docs/artifacts/gamebar-actxprxy-broker-metadata-20260316.json`
  - `docs/artifacts/gamebar-broker-chain-qi-20260316.json`
- `actxprxy.dll` 안에는 hidden broker용 private proxy metadata가 실제로 존재한다
  - hidden2 descriptor: RVA `0x8140`
  - hidden1 descriptor: RVA `0x8158`
  - hidden2 proxy info: RVA `0x48f98`
  - hidden1 proxy info: RVA `0x498f0`
- 특히 중요한 점
  - `hidden1` descriptor(`0x8158`)는 `hidden2` descriptor(`0x8140`)의 suffix다
  - 즉 `hidden2 -> hidden1 -> ...` 형태의 **확장/계층 구조**가 실제 proxy metadata 수준에서 보인다
- GUID chain도 분명하다
  - final chain (`0x56eb0`)
    - `30dad006-cf4a-45e0-aec1-2195d76fd9c0`
    - `9f8edc08-cbcc-59b7-8dee-a299deb75fc1`
    - `ab758746-5c5d-5738-9439-3e85dade945c`
    - `b4b868ab-eef2-5bf5-8992-fbbef2582d2d`
    - `9f45f4ae-912a-53ec-b31d-01b39be7b957`
    - `c8f91eef-ea1b-5aee-ad42-66842218d157`
  - hidden2 chain (`0x56f10`)
    - `d6332df0-dbfb-575e-93f1-c7bff0693913`
    - `5eac68f9-e031-4c66-b4ea-5ab6aff979c8`
    - `9302a129-7433-42a0-9cb8-5da5964f2756`
    - `c343e0c0-9666-444b-898f-cc498c7e521a`
    - `8f352570-5bb7-4d72-921f-6fb3f2611c71`
    - `65476df8-27e5-47be-9aae-29b9921dcb70`
    - `054da1f8-65a1-4805-9902-ca6561227524`
    - `a8c66395-6ae3-4a53-8547-992bd899d74d`
  - hidden1 chain (`0x56f20`)
    - `5eac68f9-e031-4c66-b4ea-5ab6aff979c8`
    - `9302a129-7433-42a0-9cb8-5da5964f2756`
    - `c343e0c0-9666-444b-898f-cc498c7e521a`
    - `8f352570-5bb7-4d72-921f-6fb3f2611c71`
    - `65476df8-27e5-47be-9aae-29b9921dcb70`
    - `054da1f8-65a1-4805-9902-ca6561227524`
    - `a8c66395-6ae3-4a53-8547-992bd899d74d`
    - `e85a41cb-d4e3-4e1d-9348-a584f1623a36`
- `QI` 결과도 의미가 있다
  - service가 직접 내주는 건 여전히 `30dad`, `5eac`, `d633`뿐이다
  - 나머지 chain GUID들은 registry와 `ActXPrxy` proxy stub 등록은 있지만, service에 직접 `QI`하면 전부 `E_NOINTERFACE`
- 해석
  - hidden GUID chain은 임의 noise가 아니라, 실제 `actxprxy` private proxy 계층이다
  - 하지만 외부 caller에 직접 열리는 건 그 중 일부뿐이며, 나머지는 **더 안쪽 projected/private object 계층**일 가능성이 높다

### 6.25 packaged `GameBar.exe` 내부 `hidden1.slot7` 직접 호출

- 대표 산출물
  - `docs/artifacts/gamebar-hidden1-slot7-inproc-20260316-v5.json`
- `GameBar.exe` 프로세스 안에 frida를 주입해 같은 broker chain을 직접 만들고, 그 안에서 `hidden1.slot7(outptr)`를 호출해봤다
- 결과
  - `CoCreateInstance` -> `queryService(final)` -> `QI(hidden1)`는 전부 성공
  - `hidden1.slot7(outptr)`는 packaged context에서도 실제 method entry까지 도달한다
  - 하지만 결과는 `0x80070490` + `child = null`
- 이건 두 가지 의미가 있다
  - `hidden1.slot7` 자체는 허상이 아니라 실제 packaged broker method다
  - 다만 외부 Win32에서 보인 `0x80040155`와 동일 결과는 아니라서,
    - 외부 Win32 failure는 pure shell state 문제만은 아니고
    - projection/marshalling 차이가 섞여 있을 가능성이 높다
- 현재까지의 strongest model
  - `30dad` = 외부 service entry
  - `5eac(hidden1)` = pointer/out 기반 hidden broker face
  - 이 face의 `slot7`이 **companion object 또는 window-control object lookup/materialization 후보**로 가장 유력하다
  - `d633(hidden2)` = 별도 보조 interface / state/helper 쪽 가능성이 더 높다
  - 그리고 최종 표시 단계는 기존 가설대로 `GameBar host -> broker -> twinui.pcshell companion window -> SetCombinedWindowRegion -> SetWindowRgn`으로 이어지는 쪽이 가장 강하다

### 6.26 `hidden1/hidden2`는 같은 외부 service object의 추가 face

- 새 대표 산출물
  - `docs/artifacts/gamebar-hidden-qi-graph-20260316.json`
- `service`에서 `QI`로 얻은 `final(30dad...)`, `hidden1(5eac...)`, `hidden2(d633...)`는 서로 다시 `QI`하면 전부 서로를 내준다
  - `final -> final/hidden1/hidden2` = 모두 `S_OK`
  - `hidden1 -> final/hidden1/hidden2` = 모두 `S_OK`
  - `hidden2 -> final/hidden1/hidden2` = 모두 `S_OK`
- 반대로 `actxprxy` GUID chain에 있던 추가 GUID들
  - `9f8edc08-...`
  - `ab758746-...`
  - `9302a129-...`
  - `e85a41cb-...`
  - 기타 나머지
  는 `QI` 기준 전부 `E_NOINTERFACE`
- 해석
  - `30dad/5eac/d633`는 **서로 다른 object가 아니라 같은 외부 broker service object의 face**
  - `actxprxy` chain의 나머지 GUID들은 외부 caller에 직접 노출되는 interface가 아니라, proxy metadata/internal projection 쪽일 가능성이 더 높다

### 6.27 `hidden1.slot6/slot7`는 단순 show/hide 상태와 무관하다

- 새 대표 산출물
  - `docs/artifacts/gamebar-hidden-state-20260316.json`
- `GameBar.exe` 내부에서 같은 broker chain을 만들고 다음 시나리오를 직접 돌렸다
  - baseline
  - `show`
  - `show + sleep 500ms`
  - `show + sleep 2000ms`
  - `show + reset`
  - `show + hide + show`
- 결과
  - `hidden1.slot6(outptr)` = 전 시나리오에서 항상 `0x80070490` + `child=null`
  - `hidden1.slot7(outptr)` = 전 시나리오에서 항상 `0x80070490` + `child=null`
  - `hidden2.slot6(outptr)` = 여전히 AV
  - `hidden2.slot21(outptr)` = 여전히 system error
- 즉 `show/reset/hide`만으로는 `hidden1.slot6/slot7`이 찾는 object/state가 materialize되지 않는다
- 해석
  - `hidden1.slot6/slot7`는 단순한 `show/hide` hot path가 아니라, 더 별도의 host/control state를 전제로 한 lookup일 가능성이 높다

### 6.28 external client `hidden1.slot7`의 `IID_NOTREG`는 client-side proxy lookup 흔적이 약하다

- 새 대표 산출물
  - `docs/artifacts/gamebar-hidden1-slot7-client-trace-20260316.json`
- 외부 Win32 client를 지연 실행시키고 `ole32!CoGetPSClsid`, `CoGetClassObject`, `CoCreateInstance`, `advapi32!RegOpenKeyExW`를 직접 후킹했다
- 결과
  - `hidden1.slot7(outptr)`는 여전히 `0x80040155`
  - 하지만 client 측 hook에서는 `CoGetPSClsid` / registry lookup 이벤트가 잡히지 않았다
- 해석
  - 이 `IID_NOTREG`는 단순한 client-side registry lookup 실패라기보다,
  - broker/proxy 내부에서 더 안쪽 projection/state 조건이 안 맞아 올라오는 failure일 가능성이 높다
  - 즉 `hidden1.slot7`는 “아무 interface 하나를 외부로 그냥 marshal하려다 실패”하는 단순 모델보다 더 깊은 internal state 의존 경로로 보인다

### 6.29 `GameBar.exe` 내부 hot path는 외부 broker proxy slot을 직접 쓰지 않는다

- 새 대표 산출물
  - `docs/artifacts/gamebar-hidden-slot-inproc-calls-20260316.json`
  - `docs/artifacts/gamebar-final-slot-inproc-calls-20260316.json`
  - `docs/artifacts/gamebar-early-broker-calls-20260316.json`
- `GameBar.exe`에 직접 attach해서
  - `hidden1.slot6`
  - `hidden1.slot7`
  - `hidden2.slot21`
  - `final slot 6..60`
  를 모두 훅킹하고
  - running attach
  - `show/hide/show` 외부 자극
  - `ms-gamebar:` 직후 최대한 이른 attach
  를 각각 시도했다
- 결과
  - hook install은 전부 성공
  - 하지만 `GameBar.exe` 내부에서 자연스럽게 이 slot들을 치는 흔적은 한 번도 안 잡혔다
- 해석
  - 외부에서 쓸 수 있는 `final/hidden1/hidden2` COM face는 **external control surface**로는 맞지만,
  - 적어도 관측된 startup/show/hide hot path에서 `GameBar.exe` 내부 구현이 직접 쓰는 동일한 경로는 아니다
  - 즉 현재 strongest model은 더 선명해진다
    - external caller: `broker service face -> shell visibility/control`
    - internal Game Bar host: `CoreWindow/AppFrameHwnd -> private C++/projected path -> twinui.pcshell companion window -> SetCombinedWindowRegion -> SetWindowRgn`
- 이건 중요하다
  - 이전에는 `hidden1.slot7`가 마지막 companion object materialization hot path일 수 있다고 봤지만,
  - 현재 증거상 그 가능성은 낮아졌다
  - `hidden1/hidden2`는 hot path라기보다 외부 또는 부가 state/control face일 가능성이 더 높다

### 6.30 live `UpdateWindowRegionForPinnedOnlyAsync`는 fallback broker보다 `WindowManagerFT` 쪽이 더 가깝다

- 새 대표 산출물
  - `docs/artifacts/gamebar-region-branch-20260316-115207/summary.json`
  - `docs/artifacts/gamebar-updatewindowregion-disasm-20260316.txt`
  - `docs/artifacts/gamebar-gbftfactorycreate-disasm-20260316.txt`
  - `docs/artifacts/gamebar-ftserver-setwindowregion-disasm-20260316.txt`
- 기존에는
  - `GameBar host -> broker -> twinui.pcshell!GamingOverlayExperienceManager::SetCombinedWindowRegion -> SetWindowRgn`
  - 을 최유력 live path로 두고 있었지만,
  - branch trace + 정적 재분석 결과 지금은 이건 **fallback path**로 보는 편이 더 맞다
- 핵심 근거
  - `gamebar-region-branch-20260316-115207/summary.json`
    - live path에서 `SetAppFrameHwnd`
    - `UpdateWindowRegionForPinnedOnlyAsync`
    - `WindowManagerRegionPath_B`
    - `Broker_Hide`
    - 는 반복 관측됐지만
    - `Broker_SetCombinedWindowRegion` fallback은 hit되지 않았다
  - `GameBar.exe`의 `UpdateWindowRegionForPinnedOnlyAsync` (`docs/artifacts/gamebar-updatewindowregion-disasm-20260316.txt`)
    - `m_appFrameHwnd`가 **존재할 때**는 `Calling WindowManagerFT::SetWindowRegion` 로그 경로로 간다
    - 이 경로에서 `fcn.140243360`을 호출해 FT helper/object를 준비한 뒤
    - object vtable `+0x50` 슬롯을 호출한다
    - 그 뒤 호출되는 `fcn.1401d1660`, `fcn.1401d19d0`는 더 이상 region apply 본체가 아니라 `ActivityAdd`, `ActivityRemove` bookkeeping으로 재분류하는 게 맞다
  - 반대로 `m_appFrameHwnd`가 **없을 때만**
    - `m_appFrameHwnd not set. Falling back to EM SetCombinedWindowRegion`
    - fallback branch로 내려가고
    - 그때 `GamingOverlayBroker().Show()`가 이어진다
- `fcn.140243360`는 FT helper 준비 경로와 더 강하게 이어진다
  - `docs/artifacts/gamebar-gbftfactorycreate-disasm-20260316.txt`
  - 이 함수 안에는 `GbftFactoryCreate: Full trust server is in terminal state...` 문자열이 직접 있고
  - 내부적으로 `GbftComFactory` CLSID (`FD06603A-2BDF-4BB1-B7DF-5DC68F353601`) 활성화 경로와 맞물린다
- `GameBarFTServer.exe` 쪽 구현은 거의 닫혔다
  - `docs/artifacts/gamebar-ftserver-setwindowregion-disasm-20260316.txt`
  - `fcn.140073300`은 `IWindowManagerFT` wrapper xref에서 직접 들어오며
  - 내부에서
    - `CreateRectRgn`
    - `CombineRgn`
    - `SetWindowRgn`
    - clear 경로의 `SetWindowRgn(hwnd, NULL, TRUE)`
    - 를 모두 직접 호출한다
  - 문자열도 그대로 일치한다
    - `SetWindowRegion: CreateRectRgn failed`
    - `SetWindowRegion: CombineRgn failed`
    - `SetWindowRegion: SetWindowRgn failed`
- 현재 해석
  - live pinned-only hot path는 이제
    - `GameBar internal host`
    - `SetAppFrameHwnd`
    - `UpdateWindowRegionForPinnedOnlyAsync`
    - `GbftFactoryCreate`
    - `WindowManagerFT::SetWindowRegion`
    - `GameBarFTServer.exe -> CreateRectRgn / CombineRgn / SetWindowRgn`
    - 쪽이 훨씬 강하다
  - `twinui.pcshell!GamingOverlayExperienceManager::SetCombinedWindowRegion`는
    - 여전히 존재하고
    - fallback/secondary path로는 중요하지만
    - **observed live hot path**와는 구분해서 봐야 한다

### 6.31 `WindowManagerFT`는 FTServer same-process에선 arbitrary HWND region apply를 직접 수행한다

- 새 대표 산출물
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121139/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121213/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121435/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121457/summary.json`
- external HWND probe에 `ResetWindowRegion` 호출과 local API trace를 추가했다
  - probe 스크립트: `scripts/gamebar/probe_windowmanager_external_hwnd_frida.py`
  - runner: `scripts/gamebar/run-windowmanager-external-hwnd-pass.ps1`
- 결과 1: `GameBarFTServer.exe` 내부에서 `WindowManagerFT`를 만든 경우
  - `SetWindowRegion(fake IVectorView<Rect>)` = `S_OK`
  - `ResetWindowRegion` = `S_OK`
  - local API trace
    - `CreateRectRgn` = 3회
    - `CombineRgn` = 2회
    - `SetWindowRgn` = 2회
  - sample
    - `SetWindowRgn(hwnd=probe HWND, hrgn=non-null, redraw=true)`
    - `SetWindowRgn(hwnd=probe HWND, hrgn=NULL, redraw=true)`
  - 즉 FTServer same-process에선 arbitrary HWND에 대해
    - `CreateRectRgn -> CombineRgn -> SetWindowRgn`
    - `ResetWindowRegion -> SetWindowRgn(hwnd, NULL, TRUE)`
    - 가 실제로 일어난다
- 결과 2: `GameBar.exe` 내부에서 같은 `WindowManagerFT` face를 쓴 경우
  - 이전 reset-only probe에선 `ResetWindowRegion = S_OK`였지만 local `SetWindowRgn` hit는 0회였다
  - 이번엔 같은 방식의 fake `IVectorView<Rect>`로 `SetWindowRegion`을 호출해보니
    - `system error`
    - local API trace는 여전히
      - `CreateRectRgn = 0`
      - `CombineRgn = 0`
      - `SetWindowRgn = 0`
  - 이건 중요하다
    - FTServer same-process에서는 fake vector가 그대로 소비된다
    - `GameBar.exe`에서는 같은 fake vector가 **proxy/marshalling 경계**를 못 넘고 깨진다
- 해석
  - `GameBar.exe`의 `IWindowManagerFT` face는 local implementation이라기보다 FTServer remote implementation/proxy로 보는 게 맞다
  - 실제 arbitrary HWND region mutation은 FTServer 쪽에 있다
  - 그리고 `SetWindowRegion`의 rect collection 인자도 이 proxy 경계에서 marshal되어야 한다
- 이건 중요하다
  - 이제 `WindowManagerFT`가 단순 style/click-through helper가 아니라
  - 실제 arbitrary HWND의 **region 적용층**이라는 동적 증거까지 생겼다
  - 즉 현재 strongest model은
    - `GameBar host -> GbftFactory / IWindowManagerFT proxy -> FTServer WindowManagerFT::SetWindowRegion / ResetWindowRegion -> SetWindowRgn`
    - 쪽이다

### 6.32 `GbftFactory / IWindowManagerFT` 접근성은 app model에 따라 다르게 막힌다

- 새 대표 산출물
  - `docs/artifacts/calculator-packaged-identity-20260316.json`
  - `docs/artifacts/notepad-packaged-identity-20260316.json`
  - `docs/artifacts/windows-terminal-packaged-identity-20260316.json`
  - `docs/artifacts/notepad-ft-defaultinterface-20260316.json`
- 이번에는 `Game Bar package` 밖의 packaged process에서 같은 FT helper를 열 수 있는지 비교했다

#### 6.32.1 UWP packaged app: Calculator

- 대상
  - `Microsoft.WindowsCalculator`
  - classic UWP/Windows.Universal 계열
- 결과
  - package identity는 있음
  - 하지만 `GbftComFactory` `CoCreateInstance(IUnknown)` 단계부터
    - `0x80070005`
    - `E_ACCESSDENIED`
  - 즉 Calculator 쪽에선 FT COM surface에 아예 진입하지 못한다

#### 6.32.2 full-trust packaged desktop app: Notepad

- 대상
  - `Microsoft.WindowsNotepad`
  - manifest에 `EntryPoint="Windows.FullTrustApplication"`
  - `runFullTrust` capability 존재
- 결과
  - package identity 있음
  - `GbftComFactory` `CoCreateInstance(IUnknown)` = `S_OK`
  - `IActivationFactory` `QI` = `S_OK`
  - `ActivateInstance` = `S_OK`
  - runtime class = `XboxGameBarFT.GbftFactory`
  - 하지만 `QI(IGbftFactory)` = `0x8000000F`
    - `.NET` 해석상 `Typename 또는 Namespace가 메타데이터 파일에서 발견되지 않았습니다`
- 추가 probe
  - 새 스크립트: `scripts/gamebar/probe_ft_default_interface_frida.py`
  - activated `XboxGameBarFT.GbftFactory`의 default-interface slot 11(`CreateWindowManagerFT` 추정)을 직접 두드려 봤다
  - 결과: `system error`
  - 즉 package identity + full-trust만으로도 `IGbftFactory` 실사용 경로는 열리지 않았다
- 같은 패턴은 `Microsoft.WindowsTerminal`에서도 다시 나왔다
  - 산출물: `docs/artifacts/windows-terminal-packaged-identity-20260316.json`
  - `GbftComFactory CoCreate` = 가능
  - `ActivateInstance` = 가능
  - runtime class = `XboxGameBarFT.GbftFactory`
  - `QI(IGbftFactory)` = 동일하게 `0x8000000F`
- 따라서 이건 Notepad 특이값이라기보다, 적어도 **packaged desktop app 일반군**에서 반복되는 패턴으로 보는 편이 맞다

#### 6.32.3 비교 해석

- 지금까지의 access matrix는 이렇다
  - plain Win32
    - `GbftComFactory CoCreate` = 가능
    - `ActivateInstance` = 가능
    - `QI(IGbftFactory)` = `0x80073D54` (`프로세스에 패키지 ID가 없습니다`)
  - UWP packaged app (Calculator)
    - `GbftComFactory CoCreate` = `0x80070005` (`E_ACCESSDENIED`)
  - full-trust packaged desktop app (Notepad)
    - `GbftComFactory CoCreate` = 가능
    - `ActivateInstance` = 가능
    - runtime class = `XboxGameBarFT.GbftFactory`
    - `QI(IGbftFactory)` = `0x8000000F`
    - default slot direct call = `system error`
  - Game Bar package (`GameBar.exe`, `GameBarFTServer.exe`)
    - `QI(IGbftFactory)` = 가능
    - `WindowManagerFT` 생성 = 가능
    - method probe = 가능
- 이 비교는 꽤 중요하다
  - gate는 단순히 “package identity가 있느냐” 하나가 아니다
  - 최소한
    - `UWP sandbox`
    - `full-trust packaged desktop`
    - `XboxGamingOverlay 전용 package / capability / metadata context`
    - 가 서로 다른 지점에서 갈린다
  - 현재 strongest interpretation
  - `GbftFactory` surface는
    - plain Win32에도 일부 projection 흔적을 보이고
    - full-trust packaged app에서도 activation까지는 되지만
    - 실제 `IGbftFactory` / `WindowManagerFT` helper 실사용은 **Game Bar package 특수 컨텍스트** 쪽으로 더 강하게 묶여 있다
  - 즉 “아무 packaged app이면 FT helper를 쓸 수 있다” 가설은 현재 증거상 틀린 쪽에 가깝다

### 6.33 설치 패키지 signal scan: `widget host`와 `FT helper`는 manifest 신호도 다르다

- 새 대표 산출물
  - `docs/artifacts/gamebar-package-signal-scan-20260316.json`
- 설치된 패키지 manifest를 전수 스캔해서 세 가지 신호를 비교했다
  - `gameBarServices`
  - `microsoft.gameBarUIExtension`
  - `GbftComFactory`
- 결과 요약
  - `Microsoft.XboxGamingOverlay`
    - `gameBarServices = true`
    - `microsoft.gameBarUIExtension = true`
    - `GbftComFactory = true`
  - `Microsoft.Edge.GameAssist`
    - `microsoft.gameBarUIExtension = true`
    - `GbftComFactory = false`
  - `Microsoft.GamingApp`
    - `microsoft.gameBarUIExtension = true`
    - `GbftComFactory = false`
  - 현재 로컬의 우리 위젯 패키지
    - `microsoft.gameBarUIExtension = true`
    - `GbftComFactory = false`
  - `Microsoft.XboxGameOverlay`
    - `gameBarServices = true`
    - `microsoft.gameBarUIExtension = false`
    - `GbftComFactory = false`
- 해석
  - `gameBarUIExtension`은 “Game Bar widget host에 붙을 수 있다”는 신호에 가깝다
  - `GbftComFactory`는 그와 별개로 `XboxGameBarFT` helper surface를 내주는 더 안쪽 신호다
  - 즉 manifest 층에서도
    - `widget host contract`
    - `FT helper contract`
    - 가 분리돼 있다
  - 이건 현재 동적 결과와도 잘 맞는다
    - 우리 패키지처럼 `gameBarUIExtension`만 가진 앱은 위젯 셸로는 동작 가능
    - 하지만 `WindowManagerFT` 같은 FT helper surface는 자동으로 따라오지 않는다

### 6.34 실제 widget 패키지인 `Edge Game Assist`도 standalone 컨텍스트에선 `IGbftFactory`를 못 연다

- 새 대표 산출물
  - `docs/artifacts/edge-gameassist-launcher-packaged-identity-20260316.json`
  - `docs/artifacts/edge-gameassist-ui-packaged-identity-20260316.json`
- `EdgeGameAssist.exe`를 직접 실행하면 bootstrapper로 `SystemUWPLauncher.exe`가 뜨고,
  실제 packaged UI는 별도 `EdgeGameAssist.exe` 프로세스가 가진다
  - `ApplicationFrameHost.exe` + `EdgeGameAssist.exe` 조합은
    HWND/UIA 덤프에서도 다시 확인됐다
- 중요한 건 `launcher`와 `real UI process`의 FT helper 결과가 다르다는 점이다
  - `SystemUWPLauncher.exe`
    - `packageFullName.hr = 0x00003D54`
    - FT helper 관점에선 **package identity가 없는 것처럼 보인다**
    - `QI(IGbftFactory)`도 plain Win32와 같은 `0x80073D54`
  - `EdgeGameAssist.exe`
    - `packageFullName.hr = 0x00000000`
    - `packageFullName = Microsoft.Edge.GameAssist_1.0.3456.0_x64__8wekyb3d8bbwe`
    - 즉 **진짜 packaged widget app context**가 맞다
    - 그런데도
      - `GbftComFactory CoCreate` = 가능
      - `ActivateInstance` = 가능
      - runtime class = `XboxGameBarFT.GbftFactory`
      - `QI(IGbftFactory)` = `0x8000000F`
- 이건 중요하다
  - `Edge Game Assist`는
    - 실제 `microsoft.gameBarUIExtension` widget 패키지이고
    - `runFullTrust`를 갖고
    - `Microsoft.coreAppActivation_8wekyb3d8bbwe` custom capability도 있다
  - 그런데도 standalone packaged UI process에서는 `IGbftFactory` helper 실사용이 막힌다
- 따라서 현재 strongest interpretation
  - `widget 패키지다`
  - `runFullTrust가 있다`
  - `coreAppActivation capability가 있다`
  - 만으로는 `WindowManagerFT` 같은 restricted helper surface가 자동으로 열리지 않는다
  - 즉 gate는 여기보다 더 안쪽에 있다

### 6.35 `settings.dat`에는 실제 `RESTRICTED-API-ALLOW-LIST`가 있고, 우리 widget AppId는 없다

- 새 대표 산출물
  - `docs/artifacts/gamebar-settings-signals-20260316.json`
  - `scripts/gamebar/extract-gamebar-settings-signals.ps1`
- `Microsoft.XboxGamingOverlay`의 `settings.dat`를 직접 읽어보면,
  다음 raw allow-list가 들어 있다
- 같은 settings hive 안에는
  `https://dlassets-ssl.xboxlive.com/public/content/kgl/Version/2658/kgl.2658.compressed`
  형태의 KGL OneSettings URL도 남아 있다
  - 즉 allow-list가 최소한 **Game Bar 내부 설정/원격 구성 채널과 같은 평면**에 있다는 건 확인된다

```json
{
  "RestrictedApiAllowList": [
    "Microsoft.TeamsXboxGameBarWidget_8wekyb3d8bbwe_App_TeamsWidget",
    "Microsoft.TeamsXboxGameBarWidget_8wekyb3d8bbwe_App_TeamsFeedbackWidget",
    "Microsoft.TeamsXboxGameBarWidgetBundled_8wekyb3d8bbwe_App_TeamsWidget",
    "62269AlexShats.CrosshairZoom_gghb1w55myjr2_App_CrosshairZoomWidget"
  ]
}
```

- 여기서 중요한 건 allow-list entry 형식이 단순 PFN이 아니라
  **`<PackageFamilyName>_App_<ApplicationId>` 형태의 AppId**라는 점이다
- candidate check 결과
  - `f60d6f7e-5a38-4fbe-bb53-37ed4ec7d424_ws4vteaf97a5e_App_DmNoteOverlay`
    - settings 안에 없음
    - allow-list 안에도 없음
  - `Microsoft.Edge.GameAssist_8wekyb3d8bbwe_App`
    - settings 안에 없음
    - allow-list 안에도 없음
  - `Microsoft.TeamsXboxGameBarWidget_8wekyb3d8bbwe_App_TeamsWidget`
    - settings 안에 있음
    - allow-list 안에도 있음
  - `62269AlexShats.CrosshairZoom_gghb1w55myjr2_App_CrosshairZoomWidget`
    - settings 안에 있음
    - allow-list 안에도 있음
- 이 신호는 강하다
  - restricted helper gate가 단순 manifest/packaging만이 아니라
    **Game Bar 내부 설정/원격 구성 쪽 allow-list**로도 관리될 가능성이 높다
  - 특히 allow-list가 우리 widget과 `Edge Game Assist`를 모두 제외하고 있으므로,
    standalone widget package가 helper surface를 못 여는 현재 결과와도 잘 맞는다
- 따라서 현재 가장 자연스러운 해석은 이렇다
  - `microsoft.gameBarUIExtension` = widget host contract
  - `runFullTrust` / `coreAppActivation` = packaged app execution 성격
  - `GbftFactory / IWindowManagerFT` restricted helper 실사용 =
    그보다 더 안쪽의 **Game Bar-controlled allow-list / host state / package-specific gate**

---

## 7. 관련 파일

- 대표 스크립트
  - `scripts/gamebar/collect-gamebar-baseline.ps1`
  - `scripts/gamebar/dump-gamebar-winmd.ps1`
  - `scripts/gamebar/resolve-symbol-addresses.ps1`
  - `scripts/gamebar/search-symbols.ps1`
  - `scripts/gamebar/find-guid-cluster-xrefs.py`
  - `scripts/gamebar/trace_gamebar_frida.py`
  - `scripts/gamebar/probe-gamebar-broker-win32.ps1`
  - `scripts/gamebar/probe-gamebar-broker-inspectable.ps1`
  - `scripts/gamebar/probe-gamebar-broker-service-matrix.ps1`
  - `scripts/gamebar/probe-gamebar-hidden-qi-graph.ps1`
  - `scripts/gamebar/probe-gamebar-broker-slot.ps1`
  - `scripts/gamebar/probe-hidden-state-frida.py`
  - `scripts/gamebar/probe-gamebar-ft-com.ps1`
  - `scripts/gamebar/probe-gamebar-winrt-activation.ps1`
  - `scripts/gamebar/probe_packaged_identity_frida.py`
  - `scripts/gamebar/probe_ft_default_interface_frida.py`
  - `scripts/gamebar/extract-gamebar-settings-signals.ps1`
  - `scripts/gamebar/probe-twinui-direct-activation.ps1`
  - `scripts/gamebar/trace-hidden-slot-client-frida.py`
  - `scripts/gamebar/trace-hidden-slot-inproc-calls.py`
  - `scripts/gamebar/trace-final-slot-inproc-calls.py`
  - `scripts/gamebar/trace-gamebar-early-broker-calls.py`
  - `scripts/gamebar/probe_windowmanager_external_hwnd_frida.py`
  - `scripts/gamebar/trace-gamebar-region-branch.py`
  - `scripts/gamebar/run-broker-api-trace-pass.ps1`
  - `scripts/gamebar/run-broker-hidden-slot-pass.ps1`
  - `scripts/gamebar/run-broker-show-cdb-pass.ps1`
  - `scripts/gamebar/run-windowmanager-external-hwnd-pass.ps1`
  - `scripts/gamebar/run-windowmanager-shell-backtrace-pass.ps1`
  - `scripts/gamebar/run-windowmanager-shell-correlation-pass.ps1`
  - `scripts/gamebar/run-probe-window-shell-control-pass.ps1`
  - `scripts/gamebar/inspect-ftserver-fullscreen-rizin.ps1`
  - `scripts/gamebar/trace-running-ftserver-cdb.ps1`
- 대표 산출물
  - `docs/artifacts/gamebar-package-summary-20260314-202125.json`
  - `docs/artifacts/gamebar-binaries-summary-20260314-202125.json`
  - `docs/artifacts/gamebar-etl-history-summary-20260314.json`
  - `docs/artifacts/gamebar-logman-launch-summary-20260315-100620.json`
  - `docs/artifacts/gamebar-logman-diff-20260315-100620.json`
  - `docs/artifacts/gamebar-xaml-elements-20260315-100620.json`
  - `docs/artifacts/gamebar-running-ftserver-cdb-20260315-123016/`
  - `docs/artifacts/gamebar-ftserver-rizin-fullscreen-20260315-124955.txt`
  - `docs/artifacts/winmdidl/`
  - `docs/artifacts/gamebar-winmd-summary-20260315-131200.json`
  - `docs/artifacts/gamebar-widget-host-summary-20260315-142946.json`
  - `docs/artifacts/gamebar-broker-win32-no-ui-20260315-135040.json`
  - `docs/artifacts/gamebar-broker-win32-with-ui-20260315-135040.json`
  - `docs/artifacts/gamebar-winrt-activation-no-ui-20260315-v3.json`
  - `docs/artifacts/gamebar-winrt-activation-with-ui-20260315-v3.json`
  - `docs/artifacts/gamebar-packaged-identity-gamebar-20260315-v2.json`
  - `docs/artifacts/gamebar-packaged-identity-explorer-20260315-v1.json`
  - `docs/artifacts/gamebar-packaged-identity-gamebarftserver-20260315-154809.json`
  - `docs/artifacts/gamebar-ft-com-no-ui-20260315-160135.json`
  - `docs/artifacts/gamebar-ft-com-with-ui-20260315-160136.json`
  - `docs/artifacts/gamebar-twinui-direct-activation-20260315.json`
  - `docs/artifacts/gamebar-broker-inspectable-no-ui-20260315.json`
  - `docs/artifacts/gamebar-broker-service-matrix-20260316.json`
  - `docs/artifacts/gamebar-broker-chain-qi-20260316.json`
  - `docs/artifacts/gamebar-actxprxy-broker-metadata-20260316.json`
  - `docs/artifacts/gamebar-guid-cluster-xrefs-20260316.json`
  - `docs/artifacts/gamebar-hidden-qi-graph-20260316.json`
  - `docs/artifacts/gamebar-hidden-state-20260316.json`
  - `docs/artifacts/gamebar-hidden1-slot7-client-trace-20260316.json`
  - `docs/artifacts/gamebar-hidden-slot-inproc-calls-20260316.json`
  - `docs/artifacts/gamebar-final-slot-inproc-calls-20260316.json`
  - `docs/artifacts/gamebar-early-broker-calls-20260316.json`
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-094943/summary.json`
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-095616/summary.json`
  - `docs/artifacts/gamebar-hidden-slot-pass-20260316-100644/summary.json`
  - `docs/artifacts/gamebar-hidden1-slot7-inproc-20260316-v5.json`
  - `docs/artifacts/gamebar-gameconfigstore-20260315-161212.json`
  - `docs/artifacts/gamebar-inputfocus-20260315-161212.json`
  - `docs/artifacts/gamebar-ftserver-windowmanager-20260315-161212.json`
  - `docs/artifacts/gamebar-ftserver-apptarget-20260315-161520.json`
  - `docs/artifacts/gamebar-broker-api-trace-20260315-164531/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260315-171701/summary.json`
  - `docs/artifacts/gamebar-windowmanager-shell-backtrace-20260315-175205/summary.json`
  - `docs/artifacts/gamebar-probe-window-shell-control-20260315-175846/summary.json`
  - `docs/artifacts/gamebar-windowmanager-shell-correlation-20260315-175939/summary.json`
  - `docs/artifacts/gamebar-broker-show-cdb-20260315-185338/`
  - `docs/artifacts/gamebar-broker-show-frida-bt-20260315-185855.json`
  - `docs/artifacts/gamebar-broker-hide-show-frida-bt-20260315-185959.json`
  - `docs/artifacts/gamebar-shell-symbol-resolution-20260315.json`
  - `docs/artifacts/gamebar-twinui-setcombinedwindowregion-20260315.txt`
  - `docs/artifacts/gamebar-region-branch-20260316-115207/summary.json`
  - `docs/artifacts/gamebar-updatewindowregion-disasm-20260316.txt`
  - `docs/artifacts/gamebar-gbftfactorycreate-disasm-20260316.txt`
  - `docs/artifacts/gamebar-ftserver-setwindowregion-disasm-20260316.txt`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121139/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121213/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121435/summary.json`
  - `docs/artifacts/gamebar-windowmanager-external-hwnd-20260316-121457/summary.json`
  - `docs/artifacts/calculator-packaged-identity-20260316.json`
  - `docs/artifacts/notepad-packaged-identity-20260316.json`
  - `docs/artifacts/windows-terminal-packaged-identity-20260316.json`
  - `docs/artifacts/notepad-ft-defaultinterface-20260316.json`
  - `docs/artifacts/edge-gameassist-launcher-packaged-identity-20260316.json`
  - `docs/artifacts/edge-gameassist-ui-packaged-identity-20260316.json`
  - `docs/artifacts/gamebar-package-signal-scan-20260316.json`
  - `docs/artifacts/gamebar-settings-signals-20260316.json`
- 나머지 exploratory raw run은 정리 대상이다
