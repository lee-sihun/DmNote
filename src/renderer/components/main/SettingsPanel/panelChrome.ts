// 설정 페인 상세 전용 크롬
// 페인 표면(bg-fill-faint) 위에서 한 단계 가라앉는 inset 웰로 섹션을 구분
// 밀도는 설정 표면 공용(SETTINGS_CARD와 동일 패딩), 배경만 inset
export const PANEL_SECTION_CLASS =
  'bg-inset rounded-surface px-[14px] py-[8px] flex flex-col';

// 설정 페인 목록 행 - 토글 카드와 같은 밀도 (min-h-36, 인셋은 카드 px-14가 담당)
// 행 전체가 항목 메뉴 트리거 - group으로 이름 밝기 호버를 묶음
export const PANEL_LIST_ROW_CLASS =
  'group w-full min-h-[36px] flex items-center gap-[8px] text-label cursor-pointer rounded-md outline-none focus-visible:shadow-focus-ring';

// 채움 상태 2단 - 알약·푸터 버튼이 공유하는 인터랙티브/비활성 배경
export const FILL_INTERACTIVE_CLASS =
  'bg-fill text-fg hover:bg-fill-hover active:bg-fill-active';
export const FILL_DISABLED_CLASS =
  'bg-fill-faint text-fg-disabled cursor-not-allowed';

// 꺼짐 알약 - 면을 빼서 상태를 가른다. 켜짐(bg-fill 7.2%)과 면 있는 꺼짐
// (bg-fill-faint 3.5%)은 알파 3.7%p 차이라 긴 목록에서 구분되지 않는다.
// 면의 유무는 밝기 단계가 아니라 범주 차이라 스캔 한 번에 잡힌다.
// 글자는 조작 가능한 컨트롤이라 muted 아래로 못 내린다 - 목록 배경에서
// faint와 disabled 모두 본문 기준 4.5:1에 미달한다.
// 호버에서 면이 깔리면 배경이 밝아지므로 글자도 fg까지 올려야 기준을 지킨다
export const FILL_QUIET_CLASS =
  'text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover';

// 조작 불가 행 알약 - 면 없이 글자만. 여기서 면을 주면 '적용됨' 칩과
// 같은 문법이 돼 '지금 적용 중'으로 오인된다.
// 푸터 버튼용 FILL_DISABLED_CLASS와 달리 행 안에서는 면이 상태를 뜻한다.
// 실제 비활성이라 대비 기준 예외 대상
export const FILL_QUIET_DISABLED_CLASS = 'text-fg-disabled cursor-not-allowed';

// 행 트레일링 23px 알약 버튼 (상태는 FILL_* 조합).
// global.css가 기본 outline을 걷어내므로 포커스 링은 여기서 되살린다
export const PANEL_PILL_CLASS =
  'shrink-0 px-[8px] h-[23px] rounded-md flex items-center justify-center text-body transition-colors duration-fast outline-none focus-visible:shadow-focus-ring';

// 인셋 리스트 웰 + 내부 스크롤 + 빈 상태 + 행 이름
export const PANEL_LIST_WELL_CLASS =
  'mx-[12px] mb-[12px] bg-inset rounded-surface flex-1 min-h-0 flex flex-col';
// 마스터 스위치가 꺼져도 목록은 가라앉히지 않는다. 그룹 opacity는 켜짐 알약의
// 면과 항목 이름까지 같이 깎아, 정작 읽어야 할 '무엇이 켜져 있나'를 지운다.
// 마스터 상태는 바로 위 토글이 이미 말하고 있다
export const PANEL_LIST_SCROLL_CLASS =
  'flex-1 min-h-0 overflow-y-auto modal-content-scroll dmn-scroll-mask-inset px-[14px]';
export const PANEL_LIST_EMPTY_CLASS =
  'h-full flex items-center justify-center text-fg-faint text-body';
export const PANEL_ROW_NAME_CLASS =
  'min-w-0 flex-1 truncate text-left transition-colors duration-fast';

// 행 이름 밝기 - 평소 한 단계 낮추고 행 호버에서 올려 메뉴가 있음을 알림.
// 켜짐을 fg로 올리면 호버에서 더 갈 데가 없어 반응이 사라진다
export const PANEL_ROW_NAME_ACTIVE_CLASS = 'text-fg-muted group-hover:text-fg';
// 꺼짐 행 이름 - disabled까지 내린다. faint는 켜짐(muted)과 10%밖에 안 갈려
// 긴 목록에서 켜짐·꺼짐이 이름만으로는 안 읽힌다.
// 목록 웰 위 대비는 약 2.9:1로 본문 기준 미달이지만 의도된 값 -
// 상태 신호는 트레일링 알약의 면이 소유하고 이름은 밝기를 낮춰 거드는 역할이며,
// 행 호버에서 faint로 한 칸 올려 읽기와 메뉴 존재를 같이 보장한다
export const PANEL_ROW_NAME_INACTIVE_CLASS =
  'text-fg-disabled group-hover:text-fg-faint';

// 히스토리 행 트레일링 표식 - 현재 항목 라벨과 상태 배지.
// 면이 있는 쪽이 '지금 적용 중'이다. 플러그인 목록의 켜짐 알약과 같은 규칙 -
// 두 목록을 같은 눈으로 훑는데 면의 뜻이 반대면 읽는 규칙이 깨진다
export const PANEL_APPLIED_LABEL_CLASS =
  'shrink-0 px-[8px] h-[23px] flex items-center rounded-md bg-fill text-body text-fg';
export const PANEL_STATUS_BADGE_CLASS = 'shrink-0 text-caption text-danger-fg';

// 하단 도구 바 + 30px 버튼 (상태는 FILL_* 조합, 폭은 flex-[2]/flex-1로 지정)
export const PANEL_FOOTER_CLASS = 'flex gap-[8px] px-[12px] pb-[12px] shrink-0';
export const PANEL_FOOTER_BUTTON_CLASS =
  'flex items-center justify-center h-[30px] rounded-surface text-label transition-colors duration-fast';
