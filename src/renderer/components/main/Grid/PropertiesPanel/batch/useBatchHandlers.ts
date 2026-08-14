import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import {
  computeBatchGeometryPlan,
  computeBatchSpacingValue,
  type BatchGeometryOperation,
} from '@src/renderer/editor/runtime/batchGeometryPlan';

import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';

type KeyLikeType = 'key' | 'stat' | 'graph' | 'knob';

export interface BatchCommitOptions {
  gestureId?: string;
}

interface SelectedElement {
  type: KeyLikeType;
  id: string;
}

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  selectedKeyType: string;
  onStableGeometryCommit: (
    operation: BatchGeometryOperation,
    options?: BatchCommitOptions,
  ) => void;
  onStableGeometryPreview: (operation: BatchGeometryOperation) => void;
}

const getLayoutElementKey = (type: KeyLikeType, id: string): string =>
  `${type}:${id}`;

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedKeyType,
  onStableGeometryCommit,
  onStableGeometryPreview,
}: UseBatchHandlersProps) {
  const getPosition = (type: KeyLikeType, id: string) => {
    const locator = resolveElementById(type, id);
    if (!locator || locator.mode !== selectedKeyType) return null;
    const record =
      type === 'key'
        ? keyPositions
        : type === 'stat'
        ? statPositions
        : type === 'graph'
        ? graphPositions
        : knobPositions;
    const position = record?.[selectedKeyType]?.[locator.index];
    return position?.id === id ? position : null;
  };

  const getSelectedLayoutElements = () => {
    const elements = selectedKeyLikeElements.flatMap((element) => {
      const position = getPosition(element.type, element.id);
      return position
        ? [
            {
              key: getLayoutElementKey(element.type, element.id),
              x: position.dx,
              y: position.dy,
              width: position.width,
              height: position.height,
            },
          ]
        : [];
    });
    return elements.length === selectedKeyLikeElements.length ? elements : null;
  };

  const hasGeometryPlan = (operation: BatchGeometryOperation) => {
    const elements = getSelectedLayoutElements();
    return (
      elements !== null &&
      computeBatchGeometryPlan(elements, operation) !== null
    );
  };

  const handleBatchAlign = (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => {
    const operation: BatchGeometryOperation = { kind: 'align', direction };
    if (hasGeometryPlan(operation)) onStableGeometryCommit(operation);
  };

  const handleBatchDistribute = (direction: 'horizontal' | 'vertical') => {
    const operation: BatchGeometryOperation = {
      kind: 'distribute',
      direction,
    };
    if (hasGeometryPlan(operation)) onStableGeometryCommit(operation);
  };

  const handleBatchSpacingPreview = (spacing: number) => {
    const operation: BatchGeometryOperation = { kind: 'spacing', spacing };
    if (hasGeometryPlan(operation)) onStableGeometryPreview(operation);
  };

  const handleBatchSpacingCommit = (
    spacing: number,
    options?: BatchCommitOptions,
  ) => {
    const operation: BatchGeometryOperation = { kind: 'spacing', spacing };
    if (hasGeometryPlan(operation)) {
      onStableGeometryCommit(operation, options);
    }
  };

  const handleBatchSpacing = (spacing: number, options?: BatchCommitOptions) =>
    handleBatchSpacingCommit(spacing, options);

  const getBatchSpacingValue = () => {
    const elements = getSelectedLayoutElements();
    return elements === null
      ? { isMixed: false, value: 0 }
      : computeBatchSpacingValue(elements);
  };

  const handleBatchResize = (dimension: 'width' | 'height', value: number) => {
    const operation: BatchGeometryOperation = {
      kind: 'resize',
      dimension,
      value,
    };
    if (hasGeometryPlan(operation)) onStableGeometryCommit(operation);
  };

  const handleBatchResizePreview = (
    dimension: 'width' | 'height',
    value: number,
  ) => {
    const operation: BatchGeometryOperation = {
      kind: 'resize',
      dimension,
      value,
    };
    if (hasGeometryPlan(operation)) onStableGeometryPreview(operation);
  };

  return {
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchResizePreview,
  };
}
