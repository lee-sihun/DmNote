## 개요

프로퍼티 패널의 분리 창을 "별도 웹뷰 엔트리 + IPC 동기화"에서 "메인 웹뷰가 `window.open`으로 여는 opener 자식 창"으로 교체. 패널 React 서브트리는 하나뿐이고 호스트 엘리먼트를 `adoptNode`로 문서 사이에 옮기므로 분리·도킹에 리마운트가 없고 스토어·편집 상태·리스너가 그대로 유지됨. 두 웹뷰를 맞춰주던 미러 계층 전부가 불필요해져 22.7k줄 삭제

## 변경 내용

- 패널 창을 메인 웹뷰의 opener 자식으로 전환, `about:blank`로 만들고 메인이 문서를 직접 채움
- 패널 호스트 엘리먼트를 `adoptNode`로 문서 간 이동, 분리·도킹에 리마운트·상태 손실 없음
- 헤더를 6px 끌면 그 자리에서 실제 창이 커서를 따라오는 OBS식 즉시 tear-off, 잡은 지점 30px 안에서 놓으면 자석 복귀
- 분리 창을 도크 존에 끌어다 놓으면 도킹, 끄는 동안 도킹 자리 인디케이터 표시
- 창은 프로세스당 한 번만 만들고 도킹은 hide. 자식 웹뷰를 파괴하면 공유 `WKUserContentController`에서 메인 IPC 핸들러까지 함께 제거됨
- 창을 숨긴 채 만들고 문서를 채운 뒤 공개, 빈 창이 한 프레임 비치지 않게 함
- 팝업·포커스·리스너·프리뷰 프레임을 요소가 사는 창 기준으로 전환, 창 판정은 realm-safe로
- #136에서 넘긴 창 기준 정리 연결: 커밋 훅의 컨텍스트 기본값, 이동 직전 대기 낙관 커밋 drain, 스케줄러 창 주입
- 자식 문서를 `document.write`로 표준 모드 강제, quirks mode에서 스크롤 뷰포트가 창 높이로 커지던 문제 해소
- 메인 head의 스타일시트를 자식 문서로 미러링, HMR·커스텀 CSS 주입까지 추적
- 기동 복원을 메인이 복원 요청을 1회 소비해 `window.open`을 부르는 경로로 재배선, 분리 상태로 종료하면 다음 기동에 분리된 채로 뜨는 기존 동작 유지
- Windows: 프레임리스 창 인셋 보정, 도크 존 판정 기준을 메인 content 원점 실측으로, 접근성 텍스트 배율 보상
- Windows: tear-off한 창이 메인 뒤에 나타나던 문제 정정
- Windows: 모서리 투명 간극과 리사이즈 빈 공간 제거, 실루엣과 1px 라인을 DWM에 위임
- 레거시 일괄 삭제: 패널 엔트리, RemoteSheet 층, plugin RPC 라우터, 선택 세션 동기화, `isPanelWindow()` 분기 약 100곳

## 검증

- `npx tsc --noEmit` / `npm run lint` 오류 0, 경고는 base와 동일 / `npm run format`
- vitest 242 files, 2,488 tests 통과. `tests/docs-code-blocks.test.ts` 11건 실패는 base와 동일한 기존 실패로, 이 브랜치는 `docs/content`·`tests/`를 건드리지 않음
- `cargo test --lib` 693 통과, `cargo clippy` 경고 0, `cargo fmt` 클린
- 실기 macOS: 분리·도킹 반복, 드래그 tear-off·자석 복귀·도크 인디케이터, 자식 창 스크롤, 드롭 창 좌표 픽셀 일치, 메인 IPC 생존, 기동 복원
- 실기 Windows 11 Pro(26200): 부팅·패널 토글·분리·도킹, 자식 창 `document.write` 크래시 없음, 창 밖 mousemove 캡처. 아래 두 건이 여기서 나와 수정됨
- 독립 서브에이전트 적대적 리뷰 3회(Rust·프론트·Windows 수정) + 스코프 리뷰 1회, 지적 사항 전부 반영

## Windows 실기에서 나온 수정

- tear-off한 창이 메인 뒤에 깔림. `.focused(false)`가 남긴 tao `MARKER_DONT_FOCUS`를 내리는 코드가 값 복사본만 바꿔 플래그가 창 수명 내내 살아 있고, 그래서 `show()`가 매번 `SW_SHOWNOACTIVATE`로 나가 z-order를 건드리지 않음. 포커스를 뺏으면 메인의 드래그 세션이 끊기므로 `SetWindowPos(HWND_TOP, SWP_NOACTIVATE)`로 순서만 올림. 같은 결함이 남아 있던 트레이 복원 경로도 함께 정정
- 모서리에 투명 초승달과 리사이즈 시 아래쪽 빈 공간. tao는 `decorations(false)`에서도 HWND에 `WS_CAPTION|WS_SIZEBOX`를 남겨 DWM이 웹 콘텐츠와 같은 사각형 위에 자기 반경으로 모서리를 자르는데, 웹이 12px로 또 라운딩해 두 원호 사이가 창의 투명 영역으로 남음. DWM 반경은 조회도 지정도 불가하므로 실루엣과 1px 라인을 DWM에 넘기고 웹은 사각으로 채움. 리사이즈 띠는 `transparent`면 wry가 WebView2 기본 배경을 `(0,0,0,0)`으로 못박는 것이 원인이라, DWM이 실루엣을 소유하는 지금은 투명이 필요 없으므로 Windows만 불투명으로 되돌려 같은 색으로 메움

## 참고

- 자식 창 문서에 포털로 그린 요소는 이벤트가 그 창에서 끝나고 rAF도 창마다 따로 돈다. 패널 안에서 전역 `window`·`document`·`requestAnimationFrame`을 잡는 코드를 새로 추가하면 `PanelHostContext`의 창을 봐야 함
- 패널 창은 도킹돼 있어도 살아 있다. 파괴는 종료 시점뿐이며, 도킹은 hide, 분리는 show로만 오감
- 분리 창의 모서리 반경은 플랫폼마다 주인이 다르다. macOS는 CALayer 마스크가 CSS와 같은 12px, Windows는 DWM 고정값(≈8dip), 그 외는 CSS. 백엔드가 "웹이 그릴 몫"(`webRadius`·`webRing`)을 정해 내려주므로 프론트에 플랫폼 분기를 새로 만들 필요 없음
- `--ui-bg-panel-detached`를 옮길 때는 `windows_window_corners.rs`의 `SEED_FILL`도 같이 옮겨야 함. 첫 페인트 전 구간을 그 값이 메움
- Windows 크롬 구현은 `fix/panel-window-windows-deadlock`의 `a54b12b9`를 이 구조로 이식한 것. 그 브랜치의 나머지(동기 커맨드 교착 수정, `panel_window_ready`·reveal 타임아웃)는 이 PR의 구조가 이미 대체하므로 **머지 후 close 대상**
- capabilities의 `panel` windows·webviews 항목은 현재 미사용. 자식 창은 IPC를 쓰지 않음

## 리뷰 포인트

- 커밋 단위 리뷰 권장. 구조 전환이 앞, 드래그 분리·도킹이 중간, Windows 대응이 뒤
- Linux 미지원. `NewWindowFeatures`가 항상 None이고 GTK 팝업 패닉(wry#1663)이 미해결이라 분리 기능을 막아둠
- Windows 10(빌드 22000 미만) 실기 없음. DWM 라운딩·보더 속성이 둘 다 없어 사각 창 + CSS 링 경로로 떨어지도록 코드상 처리만 되어 있음
- Windows에서 prod 빌드의 자식 창 스타일 `<link href=tauri://…>` 로딩(tauri#14852), 접근성 텍스트 배율 100% 초과에서의 패널 zoom은 미확인
- 모서리 반경이 macOS 12px과 Windows ≈8dip으로 갈리는 것은 의도. DWM은 반경 지정이 불가능하고(`ROUND`/`ROUNDSMALL` 두 프리셋뿐) 플랫폼 관례에도 맞음. 12px 통일이 필요하면 `SetWindowRgn` 방식뿐인데 안티에일리어싱이 없어 계단이 보임
- detached 상태에서 시작한 드래그를 drag-context IPC 왕복보다 빨리 도크 존에 놓으면 도킹을 한 번 놓침. 재시도로 해소되어 그대로 둠
- mixed-DPI 모니터 간 좌표는 직결. 초기 버전 스코프 밖
- dev HMR full reload에서 패널이 hide되고 분리 기록이 지워짐. dev 한정
- `usePanelHeaderDrag` 단위 테스트 부재
- `NumberInput`·`OptionalNumberInput`의 after-paint 커밋 창 주입은 `useFrameCoalescer`·`useDigitPop`까지 함께 옮겨야 해서 제외
