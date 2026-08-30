import React from 'react';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import CounterPreviewBody, {
  type CounterPreviewPosition,
} from './CounterPreviewBody';

interface KeyCounterPreviewProps {
  position: CounterPreviewPosition;
  previewValue?: number;
  isInBatchSelection?: boolean;
}

interface KeyCounterPreviewLayerProps {
  positions: CounterPreviewPosition[];
  previewValue?: number;
  selectedElements?: SelectedElement[];
}

// 프리뷰로 위치 하나가 바뀌면 컴파일러가 map 전체를 한 단위로 캐시하고 있어
// 목록이 통째로 다시 돈다. leaf를 memo로 격리해 안 바뀐 항목의 리렌더 자체를
// 걸러낸다 (설정 정규화는 useCounterSettings의 identity 캐시가 재사용하지만
// 스타일 합성·DOM 재조정은 memo 없이는 매번 돈다).
// 위치 객체는 프리뷰 합성에서 바뀐 대상만 새로 만들어지므로 얕은 비교로 충분하다.
// 그라디언트 편집 세션은 leaf가 직접 구독하므로 memo가 막지 않는다
const KeyCounterPreview = React.memo(function KeyCounterPreview({
  position,
  previewValue = 0,
  isInBatchSelection = false,
}: KeyCounterPreviewProps) {
  const counterSettings = useCounterSettings(position?.counter);
  // 편집 세션 일시 페인트 - 다른 표면을 편집해도 같은 대기/입력 상태 유지
  const previewSession = useGradientPreviewSession(
    'key',
    position.id,
    isInBatchSelection,
  );
  // 상태 프리뷰는 전용 스토어가 유일한 원천 (세션은 spec 페인트 전용)
  const previewActive = useEditStatePreviewActive(
    'key',
    position.id,
    isInBatchSelection,
  );

  // 개별 키의 카운터가 비활성화되었거나 outside가 아니면 렌더링하지 않음
  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  return (
    <CounterPreviewBody
      position={position}
      value={previewValue}
      counterSettings={counterSettings}
      previewSession={previewSession}
      previewActive={previewActive}
    />
  );
});

const KeyCounterPreviewLayer = ({
  positions,
  previewValue = 0,
  selectedElements = [],
}: KeyCounterPreviewLayerProps) => {
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
          <KeyCounterPreview
            key={position.id}
            position={position}
            previewValue={previewValue}
            isInBatchSelection={selectedElements.some(
              (element) => element.type === 'key' && element.id === position.id,
            )}
          />
        );
      })}
    </div>
  );
};

export default KeyCounterPreviewLayer;
