import { applyElementPatchById } from '@src/renderer/editor/runtime/elementPatch';
import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';

import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';

// 드래그 완료를 시작 시점 신원(id)으로 결합한다. 드래그 리스너의 프리즈된
// 콜백이 들고 있는 index는 대기 중 재정렬·삭제를 모르므로, id가 있으면
// applier가 완료 시점 (mode, index)를 다시 찾아 적용하고 삭제면 조용히
// 중단한다. 무ID(합성 id) 요소만 기존 index 폴백을 쓴다
export const commitElementPosition = (
  type: NativeElementType,
  elementId: string | undefined,
  dx: number,
  dy: number,
  fallback: () => void,
): void => {
  if (elementId && !isSyntheticElementId(elementId)) {
    void applyElementPatchById(type, elementId, () => ({ dx, dy }));
    return;
  }
  fallback();
};
