// 피커 리스트 행 규격 — 패널 페이지의 인셋 웰 테이블 행

// 인셋 웰(테이블) 내부의 필 행 — 30 컨트롤 스케일, 웰과 동심 라운딩
export const pickerRowClass =
  'w-full h-[30px] px-[8px] rounded-md text-label transition-colors flex items-center gap-[4px] group';

// 행 트레일링 ⋮ 버튼 — 28px(30 행 스케일)
// 숨김 상태는 폭까지 접어(w-0) 이름이 조기 잘리지 않게 함
export const pickerMoreButtonClass =
  'h-[28px] rounded-md transition-[color,opacity] flex items-center justify-center shrink-0 overflow-hidden';

// 보이는 상태 — -mr-8: 버튼을 행 패딩 안쪽까지 확장해 아이콘 시각 인셋을 텍스트(8px)와 대칭으로
export const pickerMoreButtonVisibleClass = 'w-[28px] -mr-[8px] opacity-100';

// 숨김 상태 — 행 호버 또는 버튼 자체 키보드 포커스에서만 등장
// (group-focus-within 금지: 행 자체가 tabindex를 가져 클릭 포커스만으로 계속 떠 있게 됨)
export const pickerMoreButtonHiddenClass =
  'w-0 mr-0 opacity-0 group-hover:w-[28px] group-hover:-mr-[8px] group-hover:opacity-100 focus-visible:w-[28px] focus-visible:-mr-[8px] focus-visible:opacity-100';
