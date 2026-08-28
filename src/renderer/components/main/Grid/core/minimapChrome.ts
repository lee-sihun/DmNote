// 미니맵 표면 재질 - 캔버스 위에 상주하는 부유 칩.
// 같은 티어의 패널 접힘 토글 칩(panelChrome의 SIDE_PANEL_CHIP_MATERIAL_CLASS)과
// 같은 계열을 유지한다. 두 칩이 한 화면에 같이 떠 있어 재질이 갈리면 바로 읽힌다.
// 칩 쪽은 opacity 페이드 때문에 라이브 블러를 못 써서 -solid 쌍둥이를 쓴다.
// 라이브 블러 유지 조건은 Windows 키 연타 프레임 실측 (미달 시 -solid 토큰 복귀)
export const MINIMAP_SURFACE_CLASS =
  'bg-glass-dim backdrop-glass-popup backdrop-glass-canvas';
