import React from 'react';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import CounterPreviewBody, {
  type CounterPreviewPosition,
} from './CounterPreviewBody';

export type { CounterPreviewPosition } from './CounterPreviewBody';

type CounterPreviewKind = 'key' | 'stat';

interface CounterPreviewFaceProps {
  kind: CounterPreviewKind;
  position: CounterPreviewPosition;
  value: number;
  isInBatchSelection: boolean;
}

interface CounterPreviewLayerProps {
  kind: CounterPreviewKind;
  positions: CounterPreviewPosition[];
  value: number;
  selectedElements: SelectedElement[];
}

// 프리뷰 합성은 바뀐 position만 새 객체로 만든다. leaf memo 경계에서 나머지
// 항목의 설정 정규화·스타일 합성·DOM 조정을 차단하고, 편집 세션은 leaf가 직접
// 구독해 상태 전환을 놓치지 않는다.
const CounterPreviewFace = React.memo(function CounterPreviewFace({
  kind,
  position,
  value,
  isInBatchSelection,
}: CounterPreviewFaceProps) {
  const counterSettings = useCounterSettings(position?.counter);
  // 편집 세션 일시 페인트 - 다른 표면을 편집해도 같은 대기/입력 상태 유지
  const previewSession = useGradientPreviewSession(
    kind,
    position.id,
    isInBatchSelection,
  );
  // 상태 프리뷰는 전용 스토어가 유일한 원천 (세션은 spec 페인트 전용)
  const previewActive = useEditStatePreviewActive(
    kind,
    position.id,
    isInBatchSelection,
  );

  if (!counterSettings.enabled || counterSettings.placement !== 'outside') {
    return null;
  }

  return (
    <CounterPreviewBody
      position={position}
      value={value}
      counterSettings={counterSettings}
      previewSession={previewSession}
      previewActive={previewActive}
    />
  );
});

const CounterPreviewLayer = ({
  kind,
  positions,
  value,
  selectedElements,
}: CounterPreviewLayerProps) => {
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
          <CounterPreviewFace
            key={position.id}
            kind={kind}
            position={position}
            value={value}
            isInBatchSelection={selectedElements.some(
              (element) => element.type === kind && element.id === position.id,
            )}
          />
        );
      })}
    </div>
  );
};

export default CounterPreviewLayer;
