# PR 초안: 분리 패널을 동일 JS 컨텍스트 자식 창으로 전환

> Windows 실기 검증 후 이 파일로 PR 생성: `gh pr create -F .claude/pr-shared-context-panel.md --title "feat: 분리 패널을 동일 JS 컨텍스트 자식 창으로 전환 (OBS식 드래그 분리/도킹)"`
> 생성 후 이 파일은 삭제 커밋. 아래 [ ] 항목은 Windows 검증 결과로 채울 것.

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

- cargo check/clippy/fmt · tsc · eslint 0 error · vitest 2,495 통과
- macOS 실기: 분리/도킹 반복, 드래그 tear-off·자석 복귀·도크 인디케이터, 자식 창 스크롤(표준 모드), 드롭 창 좌표 픽셀 일치, 메인 IPC 생존, 기동 복원(분리 상태로 종료 → 재기동 시 복원)
- 독립 서브에이전트 적대적 리뷰 2회(Rust/프론트) + 스코프 리뷰 1회 — 지적 사항 전부 반영

## Windows 실기 검증 결과 (여기 채우기)

- [ ] 부팅·패널 토글·분리/도킹 기본 동작
- [ ] 자식 창 `document.write` 크래시 여부 (WebView2Feedback#3491) — 크래시 시: write를 readyState 안정 후로 지연하는 폴백 적용
- [ ] prod 빌드에서 자식 창 스타일 `<link href=tauri://…>` 로딩 (tauri#14852) — 거부 시: cssRules 인라인 `<style>` 미러 폴백 적용
- [ ] 헤더 드래그: 창 밖 mousemove 캡처, tear-off 시 포커스 탈취 여부
- [ ] 접근성 텍스트 배율 >100%에서 패널 zoom (`[zoom-guard] panel window` 로그)
- [ ] #136 토글 강등 마우스 체감

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
