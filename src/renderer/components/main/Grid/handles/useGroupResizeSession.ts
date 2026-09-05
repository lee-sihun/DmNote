import {
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { isMac } from '@utils/core/platform';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { lockCustomCursor, unlockCustomCursor } from '@utils/grid/cursorUtils';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  calculateGroupResizePlan,
  calculateMinGroupSize,
  GROUP_RESIZE_MIN_SIZE,
  type GroupResizeGuidePlan,
  type GroupResizeHandle,
  type GroupResizeResult,
} from './groupResizePlan';
import {
  elementBoundsChanged,
  isElementResizable,
  type Bounds,
  type ElementBounds,
  type SelectedElement,
} from './groupResizeUtils';

interface GroupResizeData extends Bounds {
  elementBounds: ElementBounds[];
}

interface ResizeState {
  isResizing: boolean;
  handleId: string | null;
  startMouseX: number;
  startMouseY: number;
  startGroupBounds: Bounds | null;
  startElementBounds: ElementBounds[];
  nonResizableElementBounds?: ElementBounds[];
  minGroupWidth: number;
  minGroupHeight: number;
  handle?: GroupResizeHandle;
}

interface UseGroupResizeSessionOptions {
  groupData: GroupResizeData | null;
  selectedElements: SelectedElement[];
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  selectedKeyType: string;
  pluginElements: PluginDisplayElementInternal[];
  zoom: number;
  onGroupResizeStart?: (handle: GroupResizeHandle) => void;
  onGroupResize?: (result: GroupResizeResult) => void;
  onGroupResizeEnd?: () => void;
  getOtherElements?: (excludeIds: string[]) => SmartGuideElementBounds[];
  continuousInputStrategy: ContinuousInputStrategy;
}

const applyGuidePlan = (
  smartGuidesStore: ReturnType<typeof useSmartGuidesStore.getState>,
  guides: GroupResizeGuidePlan,
) => {
  if (guides.type === 'clear') {
    smartGuidesStore.clearGuides();
    return;
  }
  if (guides.type === 'unchanged') return;

  smartGuidesStore.setDraggedBounds(guides.draggedBounds);
  smartGuidesStore.setActiveGuides(guides.activeGuides);
  smartGuidesStore.setSpacingGuides(guides.spacingGuides);
  smartGuidesStore.setSizeMatchGuides(guides.sizeMatchGuides);
};

export const useGroupResizeSession = ({
  groupData,
  selectedElements,
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedKeyType,
  pluginElements,
  zoom,
  onGroupResizeStart,
  onGroupResize,
  onGroupResizeEnd,
  getOtherElements,
  continuousInputStrategy,
}: UseGroupResizeSessionOptions) => {
  const resizeRef = useRef<ResizeState>({
    isResizing: false,
    handleId: null,
    startMouseX: 0,
    startMouseY: 0,
    startGroupBounds: null,
    startElementBounds: [],
    minGroupWidth: 0,
    minGroupHeight: 0,
  });
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    return () => activeResizeCleanupRef.current?.();
  }, []);

  const handleMouseDown = (
    event: ReactMouseEvent,
    handle: GroupResizeHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    lockCustomCursor(handle.cursor, event.nativeEvent);

    if (!groupData) return;

    const resizableElementBounds = groupData.elementBounds.filter(
      ({ element }) =>
        isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          selectedKeyType,
          pluginElements,
        ),
    );
    const nonResizableElementBounds = groupData.elementBounds.filter(
      ({ element }) =>
        !isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          selectedKeyType,
          pluginElements,
        ),
    );

    resizeRef.current = {
      isResizing: true,
      handleId: handle.id,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startGroupBounds: {
        x: groupData.x,
        y: groupData.y,
        width: groupData.width,
        height: groupData.height,
      },
      startElementBounds: resizableElementBounds,
      nonResizableElementBounds,
      minGroupWidth: calculateMinGroupSize(
        resizableElementBounds,
        groupData.width,
        'x',
        GROUP_RESIZE_MIN_SIZE,
      ),
      minGroupHeight: calculateMinGroupSize(
        resizableElementBounds,
        groupData.height,
        'y',
        GROUP_RESIZE_MIN_SIZE,
      ),
      handle,
    };

    let resizeStarted = false;
    let resizeFinished = false;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;
      const {
        handle: activeHandle,
        startMouseX,
        startMouseY,
        startGroupBounds,
        startElementBounds,
        nonResizableElementBounds,
        minGroupWidth,
        minGroupHeight,
      } = resizeRef.current;
      if (!activeHandle || !startGroupBounds) return;

      const snapSize =
        useSettingsStore.getState().gridSettings?.gridSnapSize ?? 5;
      const smartGuidesStore = useSmartGuidesStore.getState();
      const gridSettings = useSettingsStore.getState().gridSettings;
      const suppressSmartSnap = isMac() ? moveEvent.metaKey : moveEvent.ctrlKey;
      const alignmentGuidesEnabled =
        gridSettings?.alignmentGuides !== false && !suppressSmartSnap;
      const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;
      const sizeMatchGuidesEnabled = gridSettings?.sizeMatchGuides !== false;
      const selectedIds = selectedElements.map((element) => element.id);

      const smartSnap = suppressSmartSnap
        ? ({ type: 'suppressed' } as const)
        : getOtherElements && alignmentGuidesEnabled
        ? ({
            type: 'enabled',
            otherElements: getOtherElements(selectedIds),
            spacingGuidesEnabled,
            sizeMatchGuidesEnabled,
          } as const)
        : ({ type: 'unchanged' } as const);
      const plan = calculateGroupResizePlan({
        handle: activeHandle,
        startMouseX,
        startMouseY,
        pointerX: moveEvent.clientX,
        pointerY: moveEvent.clientY,
        zoom,
        snapSize,
        startGroupBounds,
        startElementBounds,
        nonResizableElementBounds,
        minGroupWidth,
        minGroupHeight,
        smartSnap,
      });

      applyGuidePlan(smartGuidesStore, plan.guides);

      const changed = elementBoundsChanged(
        startElementBounds,
        plan.result.elementBounds,
      );
      if (!resizeStarted && changed) {
        resizeStarted = true;
        onGroupResizeStart?.(activeHandle);
      }
      if (resizeStarted) onGroupResize?.(plan.result);
    };
    const moveScheduler = createRafLatestScheduler(
      applyMouseMove,
      continuousInputStrategy,
    );
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveScheduler.push(moveEvent);
    };

    const handleMouseUp = () => {
      if (resizeFinished) return;
      moveScheduler.flush();
      resizeFinished = true;
      resizeRef.current.isResizing = false;
      activeResizeCleanupRef.current = null;
      useSmartGuidesStore.getState().clearGuides();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
      unlockCustomCursor();
      if (resizeStarted) onGroupResizeEnd?.();
      moveScheduler.cancel();
    };

    activeResizeCleanupRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
  };

  return handleMouseDown;
};
