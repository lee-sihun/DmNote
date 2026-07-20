// 설정 페인 상세 전용 크롬
// 페인 표면(bg-fill-faint) 위에서 한 단계 가라앉는 inset 웰로 섹션을 구분
// 밀도는 설정 표면 공용(SETTINGS_CARD와 동일 패딩), 배경만 inset
export const PANEL_SECTION_CLASS =
  'bg-inset rounded-surface px-[14px] py-[8px] flex flex-col';

// 설정 페인 목록 행 - 토글 카드와 같은 밀도 (min-h-36, 인셋은 카드 px-14가 담당)
export const PANEL_LIST_ROW_CLASS =
  'w-full min-h-[36px] flex items-center gap-[8px] text-label';

// 채움 상태 2단 - 알약·푸터 버튼이 공유하는 인터랙티브/비활성 배경
export const FILL_INTERACTIVE_CLASS =
  'bg-fill text-fg hover:bg-fill-hover active:bg-fill-active';
export const FILL_DISABLED_CLASS =
  'bg-fill-faint text-fg-disabled cursor-not-allowed';

// 행 트레일링 23px 알약 버튼 (상태는 FILL_* 조합)
export const PANEL_PILL_CLASS =
  'shrink-0 px-[8px] h-[23px] rounded-md flex items-center justify-center text-body transition-colors duration-fast';

// 인셋 리스트 웰 + 내부 스크롤 + 빈 상태 + 행 이름
export const PANEL_LIST_WELL_CLASS =
  'mx-[12px] mb-[12px] bg-inset rounded-surface flex-1 min-h-0 flex flex-col';
export const PANEL_LIST_SCROLL_CLASS =
  'flex-1 min-h-0 overflow-y-auto modal-content-scroll dmn-scroll-mask-inset px-[14px]';
export const PANEL_LIST_EMPTY_CLASS =
  'h-full flex items-center justify-center text-fg-faint text-body';
export const PANEL_ROW_NAME_CLASS =
  'min-w-0 flex-1 truncate text-left transition-colors duration-fast';

// 하단 도구 바 + 30px 버튼 (상태는 FILL_* 조합, 폭은 flex-[2]/flex-1로 지정)
export const PANEL_FOOTER_CLASS = 'flex gap-[8px] px-[12px] pb-[12px] shrink-0';
export const PANEL_FOOTER_BUTTON_CLASS =
  'flex items-center justify-center h-[30px] rounded-surface text-label transition-colors duration-fast';
