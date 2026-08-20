# PR 초안: 분리 패널을 동일 JS 컨텍스트 자식 창으로 전환

> 이 파일로 PR 생성: `gh pr create -F .claude/pr-shared-context-panel.md --title "feat: 분리 패널을 동일 JS 컨텍스트 자식 창으로 전환 (OBS식 드래그 분리/도킹)"`
> 생성 후 이 파일은 삭제 커밋. 남은 [ ] 항목은 실기가 없어 미확인인 것들.

## 개요

프로퍼티 패널의 분리 창을 "별도 웹뷰 엔트리 + IPC 동기화"에서 **"메인 웹뷰가 `window.open`으로 여는 opener 자식 창 + 메인 React 트리의 portal 호스트를 `adoptNode`로 문서 간 이동"** 구조로 교체.

- 패널 서브트리는 하나뿐이고 리마운트 없이 창 사이를 오간다 — 스토어·편집 상태·리스너가 그대로 유지되어 분리/도킹이 즉각적
- 창은 프로세스당 1회 생성(자식 웹뷰 파괴 시 공유 WKUserContentController에서 메인 IPC까지 제거됨 — 실측), 도킹=hide
- 헤더 드래그로 OBS식 즉시 tear-off: 6px 끌면 실제 창이 따라오고, 잡은 지점 근처(48px)에서 놓으면 자석 복귀. 분리 창을 도크 존에 끌어다 놓으면 도킹
- 레거시(패널 엔트리·RemoteSheet층·plugin RPC 라우터·선택 세션 동기화·`isPanelWindow()` 분기 ~100곳) 일괄 삭제: **−22.8k줄**

## 주요 커밋 (시간순)

| 커밋 | 내용 |
|---|---|
| `b2ad8843`~`c5114ae6` | Rust: 메인 창 from_config + on_new_window(arm 토큰), present/dock 수명주기 |
| `9f859b1c`~`88abed25` | 스타일 미러·자식 창 핸들·호스트 스토어·PropertiesPanelHost(adoptNode 이동), 레거시 1차 삭제 |
| `4f79a8d9` | 팝업·포커스·리스너를 호스트 창 기준으로 (realm-safe 판정 포함) |
| `905364d8`, `c41343d8` | 헤더 드래그 분리/도킹, OBS식 즉시 tear-off + 자석 복귀 |
| `e90c13c4` | 레거시 일괄 삭제 (plugin RPC·selection session·미러층) |
| `763b998c` | 리뷰 반영: 메인 리로드 도킹 blocking lock 제거(데드락), 데드코드 정리 |
| `40d3675a` | Windows 초기 지원: 프레임리스 인셋 보정·content 원점 실측·패널 zoom 보상 |
| `299b9f39` | 자식 창 quirks mode 수정(document.write로 표준 모드) — 스크롤 짤림/사망 해결 |
| `caf08a33`, `1b401867` | #136 병합 + 창-기준 정리 연결(커밋 훅 컨텍스트 기본값·drain·스케줄러 창 주입) |

## 검증

- cargo check/clippy/fmt · tsc · eslint 0 error · vitest 2,486 통과
  (`tests/docs-code-blocks.test.ts` 11건 실패는 master에서 넘어온 기존 실패 — 이 브랜치는 docs 무변경)
- macOS 실기: 분리/도킹 반복, 드래그 tear-off·자석 복귀·도크 인디케이터, 자식 창 스크롤(표준 모드), 드롭 창 좌표 픽셀 일치, 메인 IPC 생존, 기동 복원(분리 상태로 종료 → 재기동 시 복원)
- 독립 서브에이전트 적대적 리뷰 2회(Rust/프론트) + 스코프 리뷰 1회 — 지적 사항 전부 반영

## Windows 실기 검증 결과

Windows 11 Pro(26200) 실기. 아래 두 건을 제외하면 전 항목 정상.

- [x] 부팅·패널 토글·분리/도킹 기본 동작
- [x] 자식 창 `document.write` 크래시 여부 (WebView2Feedback#3491) — 크래시 없음, 폴백 불필요
- [x] 헤더 드래그: 창 밖 mousemove 캡처 정상. 포커스 탈취는 없었으나 **z-order가 메인 뒤** — 아래 수정
- [ ] prod 빌드에서 자식 창 스타일 `<link href=tauri://…>` 로딩 (tauri#14852) — dev 기준 검증, prod 미확인
- [ ] 접근성 텍스트 배율 >100%에서 패널 zoom (`[zoom-guard] panel window` 로그) — 미확인
- [ ] #136 토글 강등 마우스 체감 — 미확인
- [ ] Windows 10(빌드 < 22000) — 실기 없음. DWM 라운딩·보더 속성이 없어 사각 창 + CSS 링 경로로 떨어지도록 코드상 처리

### 검증에서 나온 수정 (2건)

| | 증상 | 원인 | 수정 |
|---|---|---|---|
| 1 | tear-off한 창이 메인 뒤에 나타남 | `.focused(false)`가 남긴 tao `MARKER_DONT_FOCUS`를 내리는 코드가 값 복사본만 바꿔 창 수명 내내 살아 있음 → `show()`가 매번 `SW_SHOWNOACTIVATE`(z-order 미변경) | `SetWindowPos(HWND_TOP, SWP_NOACTIVATE)` — 포커스는 그대로, 순서만 올림 |
| 2 | 모서리에 투명 초승달 + 리사이즈 시 아래쪽 빈 공간 | DWM 라운딩(≈8dip)과 CSS 12px이 같은 사각형 위 두 원호 / `transparent(true)`면 wry가 WebView2 배경을 (0,0,0,0)으로 못박아 새로 드러난 띠가 비침 | 실루엣·1px 라인을 DWM에 넘기고 웹은 사각으로 채움 + `transparent(false)`·`background_color`로 띠를 같은 색으로 메움 (`windows_window_corners.rs`) |

2번은 `fix/panel-window-windows-deadlock` 브랜치(커밋 `a54b12b9`)에 구 아키텍처 기준으로 있던 구현을
현재의 opener-자식 창 구조로 이식한 것이다. 그 브랜치의 나머지(`panel_window_ready`·reveal 타임아웃,
동기 커맨드 교착 수정)는 새 구조가 이미 대체했으므로 **흡수 후 close 대상**.
이식하면서 커맨드 반환을 `bool` → `{webRadius, webRing}`으로 바꿔 원본의 Windows 10 결함
(창이 불투명해져 면은 사각인데 CSS 링만 둥글게 뜨던 것)을 함께 고쳤다.

Windows 모서리 반경은 macOS의 12px과 달리 DWM 고정값(≈8dip)이다 — DWM은 반경 지정이 불가능하고
(`ROUND`/`ROUNDSMALL` 두 프리셋뿐) 플랫폼 관례에도 맞아 그대로 둔다.

## 알려진 한계 / 후속 작업

- usePanelHeaderDrag 단위 테스트 부재
- NumberInput·OptionalNumberInput의 after-paint 커밋 창 주입 (#136에서 제외된 useFrameCoalescer·useDigitPop 포함)
- 메인 최소화 시 분리 패널 rAF 스로틀 가능성 (재현 시 최소화 동행 숨김 검토)
- detached-origin 드래그를 drag-context IPC 왕복보다 빨리 도크 존에 드롭하면 도킹 1회 미스 (재시도로 해소, LOW)
- mixed-DPI 모니터 간 좌표 직결 (초기 버전 스코프 밖)
- Linux: wry#1663(GTK 팝업 패닉) 미해결 — 분리 기능 미지원
- capabilities의 `panel` windows/webviews 항목은 현재 미사용 (자식 창은 IPC 없음) — 정리 선택
- dev HMR full reload 시 패널이 hide되고 분리 기록이 지워짐 (dev 한정)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
