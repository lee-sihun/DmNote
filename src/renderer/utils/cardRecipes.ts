// 카드 그룹 시스템 단일 소스 — 패널(PropertyInputs)과 플러그인 문자열 빌더
// (defineSettings/defineElement/pluginComponents)가 같은 클래스를 공유한다.
// 주의: Tailwind가 클래스를 감지하도록 항상 완전한 클래스 문자열로 유지할 것

// 섹션 래퍼 — 라벨 + 카드를 6px 간격으로 묶음
export const SECTION_WRAPPER_CLASS = 'flex flex-col gap-[6px]';

// 섹션 라벨 — 카드 위 faint 서브헤더
export const SECTION_LABEL_CLASS = 'text-fg-faint text-body text-left px-[2px]';

// 그룹 카드 — 관련 행을 하나의 면으로 묶는 컨테이너
export const SECTION_CARD_CLASS =
  'bg-fill-faint rounded-surface px-[10px] py-[4px] flex flex-col';

// 폼 행 — 행이 수직 공간을 소유 (고정 min-h + 센터 정렬)
export const FORM_ROW_CLASS =
  'flex justify-between items-center w-full min-h-[32px]';

// 행 라벨
export const FORM_LABEL_CLASS = 'text-fg-muted text-label';

// 설정 표면 밀도 - 설정 페이지와 설정 페인 공용 (2026-07-20 개편)
// compact(위)는 도킹 패널·다이얼로그·플러그인 표면 전용, 이 둘 외 제3 밀도 추가 금지
// 행 36px: 컨트롤(스위치 18, 드롭다운 23)에 상하 숨통을 주는 중간 밀도
export const SETTINGS_CARD_CLASS =
  'bg-fill-faint rounded-surface px-[14px] py-[8px] flex flex-col';

export const SETTINGS_ROW_CLASS =
  'flex justify-between items-center w-full min-h-[36px]';

// 설정 표면 라벨 - 목적지 페이지라 property 편집기(muted)보다 한 단계 밝게
export const SETTINGS_LABEL_CLASS = 'text-label text-fg';
