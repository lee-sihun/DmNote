import React, { useEffect, useRef } from 'react';
import { PropertyRow, NumberInput } from '../index';

const SPACING_COMMIT_DEBOUNCE_MS = 80;
const SPACING_COMMIT_EPSILON = 0.0001;

interface BatchGeometrySectionProps {
  // 분배 게이트·개수 판정은 native+plugin 합산 기준
  totalCount: number;
  handleBatchAlign: (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => void;
  handleBatchDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBatchSpacing: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  handleBatchSpacingCommit?: (
    spacing: number,
    options?: { gestureId?: string },
  ) => void;
  batchSpacing: { isMixed: boolean; value: number };
  t: (key: string) => string | undefined;
}

// 배치 기하 공통 섹션 (정렬·분배·간격) - 배치 스타일 탭과 plugin 전용
// 경량 패널이 공유. 크기 일괄은 native 전용이라 여기서 제외
const BatchGeometrySection: React.FC<BatchGeometrySectionProps> = ({
  totalCount,
  handleBatchAlign,
  handleBatchDistribute,
  handleBatchSpacing,
  handleBatchSpacingCommit,
  batchSpacing,
  t,
}) => {
  // 간격 입력 세션의 debounce 커밋들을 같은 gestureId로 묶어 백엔드가 한 entry로 병합
  const lastSpacingRef = useRef<number | null>(null);
  const lastCommittedSpacingRef = useRef<number | null>(null);
  const spacingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const spacingGestureIdRef = useRef<string | null>(null);

  const isSameSpacingValue = (a: number | null, b: number | null): boolean => {
    if (a === null || b === null) return false;
    return Math.abs(a - b) < SPACING_COMMIT_EPSILON;
  };

  const commitSpacing = (spacing: number) => {
    spacingGestureIdRef.current ??= crypto.randomUUID();
    const options = { gestureId: spacingGestureIdRef.current };

    if (handleBatchSpacingCommit) {
      handleBatchSpacingCommit(spacing, options);
    } else {
      handleBatchSpacing(spacing, options);
    }

    lastCommittedSpacingRef.current = spacing;
  };

  const onSpacingChange = (value: number) => {
    lastSpacingRef.current = value;
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
    }
    spacingDebounceTimerRef.current = setTimeout(() => {
      spacingDebounceTimerRef.current = null;
      const spacing = lastSpacingRef.current;
      if (spacing === null) return;
      if (isSameSpacingValue(lastCommittedSpacingRef.current, spacing)) return;
      commitSpacing(spacing);
    }, SPACING_COMMIT_DEBOUNCE_MS);
  };

  const onSpacingBlur = () => {
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
      spacingDebounceTimerRef.current = null;
    }
    if (
      !isSameSpacingValue(
        lastCommittedSpacingRef.current,
        lastSpacingRef.current,
      )
    ) {
      const spacing = lastSpacingRef.current;
      if (spacing !== null) {
        commitSpacing(spacing);
      }
    }

    lastSpacingRef.current = null;
    lastCommittedSpacingRef.current = null;
    spacingGestureIdRef.current = null;
  };

  // Escape는 onBlur를 타지 않는다. 예약만 되고 아직 안 나간 커밋을 걷지 않으면
  // 취소한 값이 80ms 뒤에 그대로 적용된다. 이미 나간 커밋은 되돌리지 않는다 -
  // 항목별 원래 간격은 이 컴포넌트가 갖고 있지 않다
  const onSpacingCancel = () => {
    if (spacingDebounceTimerRef.current) {
      clearTimeout(spacingDebounceTimerRef.current);
      spacingDebounceTimerRef.current = null;
    }
    lastSpacingRef.current = null;
    lastCommittedSpacingRef.current = null;
    spacingGestureIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (spacingDebounceTimerRef.current) {
        clearTimeout(spacingDebounceTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* 정렬 */}
      <PropertyRow label={t('propertiesPanel.alignment') || '정렬'}>
        <div className="flex gap-[4px]">
          {/* 수평 정렬 */}
          <div className="flex">
            <button
              type="button"
              onClick={() => handleBatchAlign('left')}
              className="w-[24px] h-[23px] bg-inset rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignLeft') || '왼쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1V9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="2.5"
                  width="6"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="2.5"
                  y="6"
                  width="4"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('centerH')}
              className="w-[24px] h-[23px] bg-inset border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignCenterH') || '수평 중앙 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 1V9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="1.5"
                  y="2.5"
                  width="7"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="2.5"
                  y="6"
                  width="5"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('right')}
              className="w-[24px] h-[23px] bg-inset rounded-r-[7px] flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignRight') || '오른쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M9 1V9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="1.5"
                  y="2.5"
                  width="6"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="3.5"
                  y="6"
                  width="4"
                  height="1.5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
          {/* 수직 정렬 */}
          <div className="flex">
            <button
              type="button"
              onClick={() => handleBatchAlign('top')}
              className="w-[24px] h-[23px] bg-inset rounded-l-[7px] border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignTop') || '위쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1H9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="2.5"
                  width="1.5"
                  height="6"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="6"
                  y="2.5"
                  width="1.5"
                  height="4"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('centerV')}
              className="w-[24px] h-[23px] bg-inset border-r-0 flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignCenterV') || '수직 중앙 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 5H9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="1.5"
                  width="1.5"
                  height="7"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="6"
                  y="2.5"
                  width="1.5"
                  height="5"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleBatchAlign('bottom')}
              className="w-[24px] h-[23px] bg-inset rounded-r-[7px] flex items-center justify-center hover:bg-surface-hover transition-colors"
              title={t('propertiesPanel.alignBottom') || '아래쪽 정렬'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 9H9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2.5"
                  y="1.5"
                  width="1.5"
                  height="6"
                  rx="0.5"
                  fill="currentColor"
                />
                <rect
                  x="6"
                  y="3.5"
                  width="1.5"
                  height="4"
                  rx="0.5"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
      </PropertyRow>

      {/* 분배 */}
      <PropertyRow label={t('propertiesPanel.distribution') || '분배'}>
        <div className="flex gap-[4px]">
          <button
            type="button"
            onClick={() => handleBatchDistribute('horizontal')}
            disabled={totalCount < 3}
            className={`w-[24px] h-[23px] bg-inset rounded-md flex items-center justify-center transition-colors ${
              totalCount < 3
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-surface-hover'
            }`}
            title={t('propertiesPanel.distributeH') || '수평 분배'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="0.5"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="currentColor"
              />
              <rect
                x="4.25"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="currentColor"
              />
              <rect
                x="8"
                y="2.5"
                width="1.5"
                height="5"
                rx="0.5"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleBatchDistribute('vertical')}
            disabled={totalCount < 3}
            className={`w-[24px] h-[23px] bg-inset rounded-md flex items-center justify-center transition-colors ${
              totalCount < 3
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-surface-hover'
            }`}
            title={t('propertiesPanel.distributeV') || '수직 분배'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="2.5"
                y="0.5"
                width="5"
                height="1.5"
                rx="0.5"
                fill="currentColor"
              />
              <rect
                x="2.5"
                y="4.25"
                width="5"
                height="1.5"
                rx="0.5"
                fill="currentColor"
              />
              <rect
                x="2.5"
                y="8"
                width="5"
                height="1.5"
                rx="0.5"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </PropertyRow>

      {/* 간격 */}
      <PropertyRow label={t('propertiesPanel.spacing') || '간격'}>
        <NumberInput
          value={batchSpacing.value}
          onChange={onSpacingChange}
          onBlur={onSpacingBlur}
          onCancel={onSpacingCancel}
          suffix="px"
          min={0}
          max={500}
          allowDecimal
          decimalScale={1}
          isMixed={batchSpacing.isMixed}
        />
      </PropertyRow>
    </>
  );
};

export default BatchGeometrySection;
