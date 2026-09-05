import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import {
  computeBatchGeometryPlan,
  computeBatchSpacingValue,
  type BatchGeometryOperation,
} from '@src/renderer/editor/runtime/geometry/batchGeometryPlan';

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

export interface PluginLayoutElement {
  fullId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  selectedKeyType: string;
  // 혼합 선택의 plugin 대상 bounds - null은 대상 미해결이라 기하 조작 전체 차단
  pluginLayoutElements?: PluginLayoutElement[] | null;
  onStableGeometryCommit: (
    operation: BatchGeometryOperation,
    options?: BatchCommitOptions,
  ) => void;
  onStableGeometryPreview: (operation: BatchGeometryOperation) => void;
}

const getLayoutElementKey = (type: KeyLikeType, id: string): string =>
  `${type}:${id}`;

const getPluginLayoutElementKey = (fullId: string): string =>
  `plugin:${fullId}`;

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedKeyType,
  pluginLayoutElements = [],
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

  const getSelectedLayoutElements = (
    options: { includePlugins?: boolean } = {},
  ) => {
    // plugin 대상 미해결(null)은 부분 조작 대신 전체 차단 (fail-closed)
    if (pluginLayoutElements === null) return null;
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
    if (elements.length !== selectedKeyLikeElements.length) return null;
    if (options.includePlugins === false) return elements;
    return [
      ...elements,
      ...pluginLayoutElements.map((element) => ({
        key: getPluginLayoutElementKey(element.fullId),
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })),
    ];
  };

  const hasGeometryPlan = (operation: BatchGeometryOperation) => {
    // 크기 일괄은 native 전용 - 게이트도 native만으로 계산
    const elements = getSelectedLayoutElements({
      includePlugins: operation.kind !== 'resize',
    });
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
