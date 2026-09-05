/**
 * 레이어 패널 액션 훅
 * 가시성 토글, 이름 변경, 컨텍스트 메뉴, 삭제, 그룹 연산 등
 */

import {
  useLayerContextMenuRuntime,
  type UseLayerContextMenuRuntimeParams,
} from './useLayerContextMenuRuntime';

export function useLayerActions(params: UseLayerContextMenuRuntimeParams) {
  return useLayerContextMenuRuntime(params);
}
