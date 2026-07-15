// 사이드 패널 공통 크롬 — 재질/레이아웃 변경은 여기 한 곳에서
// 프레임이 글래스 재질을 소유하고, 페이지 전환 시 콘텐츠 레이어만 슬라이드
// 상주 풀하이트 표면의 라이브 블러 — 캔버스 damage마다 재필터되므로
// Windows에서 키 연타 프레임 실측이 유지 조건 (미달 시 bg-glass-panel-solid로 복귀)
export const SIDE_PANEL_FRAME_CLASS =
  'absolute right-0 top-0 bottom-0 w-[240px] bg-glass-panel backdrop-glass-popup shadow-elevation-panel z-30';

// 구상 패널 루트 — 프레임을 꽉 채우는 투명 레이어
export const PANEL_ROOT_CLASS = 'absolute inset-0 flex flex-col';

// 패널 헤더 — 48px 고정: 버튼 중심이 우상단 (24, 24) 앵커에 와서
// PanelToggleButton(48px 컨테이너 센터링)의 아이콘 중심과 같은 지점에 고정
export const PANEL_HEADER_CLASS =
  'flex items-center justify-between h-[48px] px-[12px] shrink-0';
