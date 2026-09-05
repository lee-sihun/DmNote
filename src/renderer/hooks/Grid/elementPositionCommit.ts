import { commitElementGeometryById } from '@src/renderer/editor/runtime/operations/elementOps';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  reportElementOpError,
  reportElementOpSkipped,
} from '@src/renderer/editor/runtime/intent/elementIntent';

import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';

// 드래그 완료를 시작 시점에 동결한 안정 ID로 결합
export const commitElementPosition = (
  type: NativeElementType,
  elementId: string,
  dx: number,
  dy: number,
): void => {
  if (!isNativeElementId(elementId)) {
    reportElementOpSkipped('element position commit (invalid native id)');
    return;
  }
  void commitElementGeometryById(type, elementId, { dx, dy }).catch(
    reportElementOpError,
  );
};
