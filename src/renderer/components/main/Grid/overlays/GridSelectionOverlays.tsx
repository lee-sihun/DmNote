import type { ComponentProps, ReactNode } from 'react';
import ResizeHandles from '../handles/ResizeHandles';
import GroupResizeHandles from '../handles/GroupResizeHandles';
import GradientAxisOverlay from '../handles/GradientAxisHandle';
import {
  getElementBounds,
  isElementResizable,
  type Bounds,
} from '../handles/groupResizeUtils';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

type ResizeHandlesProps = ComponentProps<typeof ResizeHandles>;
type GroupResizeHandlesProps = ComponentProps<typeof GroupResizeHandles>;

interface GridSelectionOverlaysProps {
  selectedElements: SelectedElement[];
  positions: CanonicalEditorDocumentV1['keyPositions'];
  statPositions: CanonicalEditorDocumentV1['statPositions'];
  graphPositions: CanonicalEditorDocumentV1['graphPositions'];
  knobPositions: CanonicalEditorDocumentV1['knobPositions'];
  mode: string;
  pluginElements: PluginDisplayElementInternal[];
  zoom: number;
  panX: number;
  panY: number;
  hasGradientEditSession: boolean;
  previewBounds: Bounds | null;
  previewGroupBounds: Bounds | null;
  previewElementBounds: readonly unknown[] | null;
  onResizeStart: NonNullable<ResizeHandlesProps['onResizeStart']>;
  onResize: NonNullable<ResizeHandlesProps['onResize']>;
  onResizeEnd: NonNullable<ResizeHandlesProps['onResizeEnd']>;
  onGroupResize: NonNullable<GroupResizeHandlesProps['onGroupResize']>;
  onGroupResizeEnd: NonNullable<GroupResizeHandlesProps['onGroupResizeEnd']>;
  getOtherElements: NonNullable<ResizeHandlesProps['getOtherElements']>;
}

const GridSelectionOverlays = ({
  selectedElements,
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  mode,
  pluginElements,
  zoom,
  panX,
  panY,
  hasGradientEditSession,
  previewBounds,
  previewGroupBounds,
  previewElementBounds,
  onResizeStart,
  onResize,
  onResizeEnd,
  onGroupResize,
  onGroupResizeEnd,
  getOtherElements,
}: GridSelectionOverlaysProps) => {
  const selectionOutlines: ReactNode[] = [];
  const hideOutlinesForGroupPreview =
    selectedElements.length > 1 && previewElementBounds !== null;
  if (!hasGradientEditSession && !hideOutlinesForGroupPreview) {
    selectedElements.forEach((element) => {
      if (
        selectedElements.length > 1 &&
        !isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          knobPositions,
          mode,
          pluginElements,
        )
      ) {
        return;
      }

      const bounds = getElementBounds(
        element,
        positions,
        statPositions,
        graphPositions,
        knobPositions,
        mode,
        pluginElements,
      );
      if (!bounds) return;
      const displayBounds =
        selectedElements.length === 1 && previewBounds ? previewBounds : bounds;
      selectionOutlines.push(
        <div
          key={element.id}
          data-grid-selection-outline=""
          style={{
            position: 'absolute',
            left: displayBounds.x * zoom + panX - 2,
            top: displayBounds.y * zoom + panY - 2,
            width: displayBounds.width * zoom + 4,
            height: displayBounds.height * zoom + 4,
            border: '2px solid var(--ui-selection-border)',
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: 'var(--z-canvas-selection-outline)',
          }}
        />,
      );
    });
  }

  const singleElement =
    selectedElements.length === 1 ? selectedElements[0] : null;
  const singleBounds = singleElement
    ? getElementBounds(
        singleElement,
        positions,
        statPositions,
        graphPositions,
        knobPositions,
        mode,
        pluginElements,
      )
    : null;
  const showSingleResizeHandles = Boolean(
    singleElement &&
      singleBounds &&
      !hasGradientEditSession &&
      isElementResizable(
        singleElement,
        positions,
        statPositions,
        graphPositions,
        knobPositions,
        mode,
        pluginElements,
      ),
  );

  return (
    <>
      {selectionOutlines}
      {showSingleResizeHandles && singleElement && singleBounds && (
        <ResizeHandles
          bounds={singleBounds}
          previewBounds={previewBounds}
          zoom={zoom}
          panX={panX}
          panY={panY}
          onResizeStart={onResizeStart}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
          elementId={singleElement.id}
          getOtherElements={getOtherElements}
        />
      )}
      {selectedElements.length > 1 && !hasGradientEditSession && (
        <GroupResizeHandles
          selectedElements={selectedElements}
          positions={positions}
          statPositions={statPositions}
          graphPositions={graphPositions}
          knobPositions={knobPositions}
          selectedKeyType={mode}
          pluginElements={pluginElements}
          zoom={zoom}
          panX={panX}
          panY={panY}
          previewGroupBounds={previewGroupBounds}
          onGroupResizeStart={onResizeStart}
          onGroupResize={onGroupResize}
          onGroupResizeEnd={onGroupResizeEnd}
          getOtherElements={getOtherElements}
        />
      )}
      <GradientAxisOverlay
        positions={positions}
        statPositions={statPositions}
        graphPositions={graphPositions}
        knobPositions={knobPositions}
        selectedElements={selectedElements}
        selectedKeyType={mode}
        zoom={zoom}
        panX={panX}
        panY={panY}
      />
    </>
  );
};

export default GridSelectionOverlays;
