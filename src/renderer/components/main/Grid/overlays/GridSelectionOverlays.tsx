import type { ComponentProps, ReactNode } from 'react';
import ResizeHandles from '../handles/ResizeHandles';
import GroupResizeHandles from '../handles/GroupResizeHandles';
import GradientAxisOverlay from '../handles/GradientAxisHandle';
import SpriteCanvasHandles from '../handles/SpriteCanvasHandles';
import { SELECTION_BORDER_WIDTH } from '../handles/selectionOutline';
import {
  getElementBounds,
  isAspectLockedElement,
  isElementResizable,
  type Bounds,
} from '../handles/groupResizeUtils';
import { matchSpriteAnchorPreset } from '@utils/sprite/spriteGeometry';
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
  spritePositions: CanonicalEditorDocumentV1['spritePositions'];
  mode: string;
  pluginElements: PluginDisplayElementInternal[];
  zoom: number;
  panX: number;
  panY: number;
  hasGradientEditSession: boolean;
  // 스프라이트 자세 편집 중 - 자세 프레임이 리사이즈 핸들을 대신한다
  hasSpritePoseSession: boolean;
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
  spritePositions,
  mode,
  pluginElements,
  zoom,
  panX,
  panY,
  hasGradientEditSession,
  hasSpritePoseSession,
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
        spritePositions,
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
            left: displayBounds.x * zoom + panX - SELECTION_BORDER_WIDTH,
            top: displayBounds.y * zoom + panY - SELECTION_BORDER_WIDTH,
            width: displayBounds.width * zoom + SELECTION_BORDER_WIDTH * 2,
            height: displayBounds.height * zoom + SELECTION_BORDER_WIDTH * 2,
            border: `${SELECTION_BORDER_WIDTH}px solid var(--ui-selection-border)`,
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
        spritePositions,
      )
    : null;
  // 자세 편집 중에는 자세 프레임이 핸들을 맡는다 - 상자 핸들과 겹치지 않게
  const showSingleResizeHandles = Boolean(
    singleElement &&
      singleBounds &&
      !hasGradientEditSession &&
      !hasSpritePoseSession &&
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

  // 기준점 표식이 프리셋 자리에 앉아 있으면 그 자리 핸들은 표식에 자리를 내준다.
  // 표식 히트 영역이 핸들을 덮어 어차피 잡히지 않고, 비율 고정이라 다른 핸들로 충분하다
  const spriteAtRest =
    singleElement?.type === 'sprite'
      ? spritePositions[mode]?.find(
          (candidate) => candidate.id === singleElement.id,
        ) ?? null
      : null;
  const occupiedHandle =
    spriteAtRest &&
    Math.abs(spriteAtRest.idleTransform.x) < 1e-6 &&
    Math.abs(spriteAtRest.idleTransform.y) < 1e-6
      ? matchSpriteAnchorPreset(spriteAtRest.pivot)
      : null;

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
          // 스프라이트는 그림 레이어라 늘리지 않는다
          lockAspect={isAspectLockedElement(singleElement)}
          occupiedHandle={occupiedHandle}
        />
      )}
      {selectedElements.length > 1 && !hasGradientEditSession && (
        <GroupResizeHandles
          selectedElements={selectedElements}
          positions={positions}
          statPositions={statPositions}
          graphPositions={graphPositions}
          knobPositions={knobPositions}
          spritePositions={spritePositions}
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
      {/* 온캔버스 스프라이트 핸들 - 선택 중엔 기준점, 자세 편집 중엔 자세 프레임 */}
      <SpriteCanvasHandles
        spritePositions={spritePositions}
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
