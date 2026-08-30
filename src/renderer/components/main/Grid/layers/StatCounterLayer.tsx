import React from 'react';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import CounterPreviewBody, {
  type CounterPreviewPosition,
} from './CounterPreviewBody';

interface StatCounterProps {
  position: CounterPreviewPosition;
  previewValue?: number;
  isInBatchSelection?: boolean;
}

interface StatCounterLayerProps {
  positions: CounterPreviewPosition[];
  selectedElements?: SelectedElement[];
}

// 프리뷰로 위치 하나가 바뀌면 컴파일러가 map 전체를 한 단위로 캐시하고 있어
// 목록이 통째로 다시 돈다. 이때 leaf를 memo로 격리하지 않으면 안 바뀐 항목까지
// Zod 정규화를 다시 돌린다 - useCounterSettings는 use 접두사라 컴파일러가
// 훅으로 보고 절대 메모하지 않는다.
// 위치 객체는 프리뷰 합성에서 바뀐 대상만 새로 만들어지므로 얕은 비교로 충분하다.
// 그라디언트 편집 세션은 leaf가 직접 구독하므로 memo가 막지 않는다
const StatCounter = React.memo(function StatCounter({
  position,
  previewValue = 0,
  isInBatchSelection = false,
}: StatCounterProps) {
  const counterSettings = useCounterSettings(position?.counter);
  // 편집 세션 일시 페인트 - 다른 표면을 편집해도 같은 대기/입력 상태 유지
  const previewSession = useGradientPreviewSession(
    'stat',
    position.id,
    isInBatchSelection,
  );
  // 상태 프리뷰는 전용 스토어가 유일한 원천 (세션은 spec 페인트 전용)
  const previewActive = useEditStatePreviewActive(
    'stat',
    position.id,
    isInBatchSelection,
  );

  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  return (
    <CounterPreviewBody
      position={position}
      value={(previewValue ?? 0) | 0}
      counterSettings={counterSettings}
      previewSession={previewSession}
      previewActive={previewActive}
    />
  );
});

const StatCounterLayer = ({
  positions,
  selectedElements = [],
}: StatCounterLayerProps) => {
  if (!positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 'var(--z-canvas-counter-preview)' }}
    >
      {positions.map((position) => {
        if (!position) return null;
        if (position.hidden) return null;
        return (
          <StatCounter
            key={position.id}
            position={position}
            previewValue={0}
            isInBatchSelection={selectedElements.some(
              (element) =>
                element.type === 'stat' && element.id === position.id,
            )}
          />
        );
      })}
    </div>
  );
};

export default StatCounterLayer;
