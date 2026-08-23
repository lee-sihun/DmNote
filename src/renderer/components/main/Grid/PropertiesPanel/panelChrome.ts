// 사이드 패널 공통 크롬 — 재질/레이아웃 변경은 여기 한 곳에서
// 프레임이 글래스 재질을 소유하고, 페이지 전환 시 콘텐츠 레이어만 슬라이드
// 상주 풀하이트 표면의 라이브 블러 — 캔버스 damage마다 재필터되므로
// Windows에서 키 연타 프레임 실측이 유지 조건 (미달 시 bg-glass-panel-solid로 복귀)
export const SIDE_PANEL_FRAME_CLASS =
  'absolute right-0 top-0 bottom-0 w-[240px] bg-glass-panel backdrop-glass-popup backdrop-glass-canvas shadow-elevation-panel z-[var(--z-chrome-panel)]';

// 구상 패널 루트 — 프레임을 꽉 채우는 투명 레이어
export const PANEL_ROOT_CLASS = 'absolute inset-0 flex flex-col';

// 패널 헤더 — 48px 고정: 버튼 중심이 우상단 (24, 24) 앵커에 와서
// PanelToggleButton(48px 컨테이너 센터링)의 아이콘 중심과 같은 지점에 고정
// 헤더 높이 - 클래스와 창 드래그 영역이 같은 값을 봐야 한다.
// 클래스는 반드시 리터럴로 둔다 - Tailwind는 소스 텍스트를 훑어 유틸을 뽑으므로
// 템플릿 리터럴로 조립한 h-[..]는 CSS가 생성되지 않는다.
// 둘이 어긋나지 않는지는 panelChrome.test.ts가 지킨다
export const PANEL_HEADER_HEIGHT = 48;
export const PANEL_HEADER_CLASS =
  'dmn-panel-header flex items-center justify-between h-[48px] px-[12px] shrink-0';

// 분리 창 전용 프레임, 창 자체가 240px라 inset 채움, OS 그림자가 깊이 담당
// 글래스 대신 같은 색상의 불투명 표면 (분리 창은 뒤 비침이 무의미)
// 도킹된 사이드 패널과 같은 L*에 서도록 솔리드 토큰을 쓴다 - 리터럴을 박으면
// 램프를 옮길 때 분리 창만 옛 색으로 남는다
// 반경은 분리 창 루트가 --dmn-panel-window-radius로 내려준다 - 네이티브가 실루엣을 소유하는
// 플랫폼(Windows)에서는 0이 되어야 하고, 여기서 12px을 고정하면 원호가 둘이 되어 간극이 생긴다
export const WINDOW_PANEL_FRAME_CLASS =
  'absolute inset-0 bg-panel-detached z-[var(--z-chrome-panel)] rounded-[var(--dmn-panel-window-radius,12px)] overflow-hidden';
