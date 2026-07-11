// 피커 리스트 행 규격 — 패널 페이지의 인셋 웰 테이블 행

// 인셋 웰(테이블) 내부의 필 행 — 30 컨트롤 스케일, 웰과 동심 라운딩
export const pickerRowClass =
  'w-full h-[30px] px-[8px] rounded-md text-style-4 transition-colors flex items-center gap-[4px] group';

// 행 트레일링 ⋮ 버튼 — 28px(30 행 스케일).
// -mr-8: 버튼을 행 패딩 안쪽까지 확장해 아이콘 시각 인셋을 텍스트(8px)와 대칭으로
export const pickerMoreButtonClass =
  'w-[28px] h-[28px] -mr-[8px] rounded-md transition-all flex items-center justify-center shrink-0';
