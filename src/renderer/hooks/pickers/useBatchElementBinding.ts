import { useEffect, useRef, useState } from 'react';

import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';
import type { ElementIdSelection } from '@src/renderer/editor/runtime/elementPatch';
import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';

// 배치 피커의 비동기 완료가 결합할 시작 시점 대상
export interface BatchElementBinding {
  binding: CompletionBinding;
  selection: ElementIdSelection;
}

export const LEGACY_BATCH_ELEMENT_BINDING: BatchElementBinding = {
  binding: 'session-mode',
  selection: {},
};

type SelectionGroups = Partial<
  Record<NativeElementType, readonly { id: string }[]>
>;

const NATIVE_ELEMENT_TYPES: readonly NativeElementType[] = [
  'key',
  'stat',
  'graph',
  'knob',
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 선택 요소의 안정 ID를 그대로 캡처한다. index는 스냅샷 한정 locator라
// 신원 재추론에 쓰지 않는다 (stale index가 다른 요소를 결합하는 오염 방지).
// 합성 폴백 ID('key-0' 등, backfill 전 구형 데이터)가 하나라도 있으면 배치
// 전체를 legacy index 경로로 보낸다 - 반쪽 적용 금지
export const captureBatchElementBinding = (
  groups: SelectionGroups,
): BatchElementBinding => {
  const selection: { [K in NativeElementType]?: string[] } = {};
  for (const type of NATIVE_ELEMENT_TYPES) {
    const elements = groups[type];
    if (!elements || elements.length === 0) continue;
    const ids: string[] = [];
    for (const element of elements) {
      if (!UUID_PATTERN.test(element.id)) return LEGACY_BATCH_ELEMENT_BINDING;
      ids.push(element.id);
    }
    selection[type] = ids;
  }
  return { binding: 'element-id', selection };
};

// 피커 open 전환 시 1회 캡처해 close까지 불변으로 유지한다.
// 배치 피커는 선택 변경에도 언마운트되지 않으므로, 렌더 스코프 계산으로는
// 시작 시점 결합을 고정할 수 없다. 이 훅의 소유자는 선택 변경 리마운트
// 경계(EditSessionBoundary) 밖에 있어야 한다 - 경계 안이면 같은 개수 선택
// 교체 시 새 인스턴스가 open 상태로 마운트되어 재캡처된다
export const useBatchElementBinding = (
  open: boolean,
  capture: () => BatchElementBinding,
): BatchElementBinding => {
  const [bound, setBound] = useState<BatchElementBinding>(
    LEGACY_BATCH_ELEMENT_BINDING,
  );
  const wasOpen = useRef(false);
  useEffect(() => {
    // open 전환에서만 1회 실행되는 의도적 동기 캡처 - 연쇄 렌더 없음
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && !wasOpen.current) setBound(capture());
    wasOpen.current = open;
  }, [open, capture]);
  return bound;
};
