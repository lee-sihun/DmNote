// 피커 리스트 행 규격 — 팝업(콤팩트 필)과 패널 페이지(인셋 웰 테이블 행)
export type PickerRenderMode = 'popup' | 'page';

// 페이지 행: 인셋 웰(테이블) 내부의 필 행 — 30 컨트롤 스케일, 웰과 동심 라운딩
export const pickerRowClass = (mode: PickerRenderMode): string =>
  mode === 'page'
    ? 'w-full h-[30px] px-[8px] rounded-md text-style-4 transition-colors flex items-center gap-[4px] group'
    : 'w-full h-[24px] px-[8px] rounded-md text-style-4 transition-colors flex items-center gap-[4px] group';

// 행 트레일링 ⋮ 버튼 — 페이지는 28px(30 행 스케일), 팝업은 18px 옵티컬 정렬
export const pickerMoreButtonClass = (mode: PickerRenderMode): string =>
  mode === 'page'
    ? 'w-[28px] h-[28px] rounded-md transition-all flex items-center justify-center shrink-0'
    : 'w-[18px] h-[18px] -mr-[8px] rounded-md transition-all flex items-center justify-center shrink-0';
