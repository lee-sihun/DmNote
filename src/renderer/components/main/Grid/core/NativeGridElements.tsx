import { useState, type MouseEvent } from 'react';
import DraggableKey from '@components/shared/Key';
import GraphItem from '../layers/GraphItem';
import KnobItem from '../layers/KnobItem';
import SpriteItem from '../layers/SpriteItem';
import { commitElementPosition } from '@hooks/Grid/elementPositionCommit';
import { useStableHandlerSlots } from '@hooks/shared/useStableHandlerSlots';
import { deleteElementById } from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';
import type {
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalReactiveSpritePosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { slotDisplayName } from '@utils/keySlot';
import {
  collectElementsInKeyRange,
  getKeySelectionBounds,
  type KeySelectionBounds,
} from '@utils/grid/rangeSelection';
import { getLooseStatTypeLabel } from '@utils/grid/statTypeLabel';
import {
  updateNativeElementReference,
  type NativeElementReferenceRegistry,
} from './nativeElementReferenceRegistry';

interface NativeGridElementsProps {
  mode: string;
  keyPositions: readonly CanonicalKeyPosition[] | undefined;
  keyMappings: readonly KeySlot[] | undefined;
  statPositions: readonly CanonicalStatItemPosition[];
  graphPositions: readonly CanonicalGraphItemPosition[];
  knobPositions: readonly CanonicalKnobItemPosition[];
  spritePositions: readonly CanonicalReactiveSpritePosition[];
  pluginElements: readonly PluginDisplayElementInternal[];
  selectedElements: SelectedElement[];
  activeTool: string;
  zoom: number;
  panX: number;
  panY: number;
  isViewportTransforming: boolean;
  keyCounterEnabled: boolean;
  lastSelectedKeyBounds: KeySelectionBounds | null;
  onSelectElement: (type: NativeElementType, index: number) => void;
  onToggleElement: (type: NativeElementType, index: number) => void;
  onClearSelection: () => void;
  onSetSelectedElements: (elements: SelectedElement[]) => void;
  onSetLastSelectedKeyBounds: (bounds: KeySelectionBounds | null) => void;
  onMoveSelection: (deltaX: number, deltaY: number) => void;
  onMultiDragStart: () => void | (() => void);
  onMultiDragEnd: () => void;
  onOpenElementEditor: (type: NativeElementType, index: number) => void;
  onOpenElementContextMenu: (
    type: NativeElementType,
    index: number,
    clientX: number,
    clientY: number,
    referenceElement: HTMLElement | null,
  ) => void;
}

const NativeGridElements = ({
  mode,
  keyPositions,
  keyMappings,
  statPositions,
  graphPositions,
  knobPositions,
  spritePositions,
  pluginElements,
  selectedElements,
  activeTool,
  zoom,
  panX,
  panY,
  isViewportTransforming,
  keyCounterEnabled,
  lastSelectedKeyBounds,
  onSelectElement,
  onToggleElement,
  onClearSelection,
  onSetSelectedElements,
  onSetLastSelectedKeyBounds,
  onMoveSelection,
  onMultiDragStart,
  onMultiDragEnd,
  onOpenElementEditor,
  onOpenElementContextMenu,
}: NativeGridElementsProps) => {
  const [referenceElements] = useState<NativeElementReferenceRegistry>(
    () => new Map(),
  );
  const stableHandlers = useStableHandlerSlots();

  const createCommonHandlers = (
    type: NativeElementType,
    index: number,
    elementId: string,
  ) => {
    const referenceKey = `${type}:${elementId}`;
    return {
      onPositionChange: (
        _targetIndex: number,
        dx: number,
        dy: number,
        stableElementId: string,
      ) => commitElementPosition(type, stableElementId, dx, dy),
      onClick: () => onSelectElement(type, index),
      onDoubleClick: () => onOpenElementEditor(type, index),
      onCtrlClick: () => onToggleElement(type, index),
      onShiftClick: () => onToggleElement(type, index),
      onMultiDrag: onMoveSelection,
      onMultiDragStart,
      onMultiDragEnd,
      onEraserClick: () => {
        void deleteElementById(type, elementId).catch(reportElementOpError);
      },
      onContextMenu: (event: MouseEvent) => {
        onOpenElementContextMenu(
          type,
          index,
          event.clientX,
          event.clientY,
          referenceElements.get(referenceKey) || null,
        );
      },
      setReferenceRef: (node: HTMLElement | null) => {
        updateNativeElementReference(referenceElements, referenceKey, node);
      },
    };
  };

  const keyElements =
    keyPositions?.map((position, index) => {
      const saveLastSelectedBounds = () => {
        const current = keyPositions[index];
        if (current) {
          onSetLastSelectedKeyBounds(getKeySelectionBounds(current));
        }
      };
      const handlers = stableHandlers(position.id, {
        ...createCommonHandlers('key', index, position.id),
        onClick: () => {
          onSelectElement('key', index);
          saveLastSelectedBounds();
        },
        onCtrlClick: () => {
          onToggleElement('key', index);
          saveLastSelectedBounds();
        },
        onShiftClick: () => {
          if (!lastSelectedKeyBounds) {
            onClearSelection();
            onToggleElement('key', index);
            saveLastSelectedBounds();
            return;
          }

          const clickedPosition = keyPositions[index];
          if (!clickedPosition) return;
          onSetSelectedElements(
            collectElementsInKeyRange(lastSelectedKeyBounds, clickedPosition, {
              mode,
              keyPositions,
              pluginElements,
              statPositions,
              graphPositions,
              knobPositions,
              spritePositions,
            }),
          );
        },
      });

      return (
        <DraggableKey
          key={position.id}
          index={index}
          elementId={position.id}
          position={position}
          keyName={slotDisplayName(keyMappings?.[index] ?? '')}
          zIndex={position.zIndex ?? index}
          isSelected={selectedElements.some(
            (element) => element.type === 'key' && element.id === position.id,
          )}
          selectedElements={selectedElements}
          activeTool={activeTool}
          zoom={zoom}
          panX={panX}
          panY={panY}
          isViewportTransforming={isViewportTransforming}
          counterEnabled={keyCounterEnabled}
          counterPreviewValue={0}
          {...handlers}
        />
      );
    }) ?? null;

  const statElements = statPositions.map((position, index) => (
    <DraggableKey
      key={position.id}
      index={index}
      elementId={position.id}
      anchorKind="stat"
      position={position}
      keyName={getLooseStatTypeLabel(position.statType)}
      zIndex={position.zIndex ?? index}
      isSelected={selectedElements.some(
        (element) => element.type === 'stat' && element.id === position.id,
      )}
      selectedElements={selectedElements}
      activeTool={activeTool}
      zoom={zoom}
      panX={panX}
      panY={panY}
      isViewportTransforming={isViewportTransforming}
      counterEnabled={true}
      counterPreviewValue={0}
      {...stableHandlers(
        position.id,
        createCommonHandlers('stat', index, position.id),
      )}
    />
  ));

  const graphElements = graphPositions.map((position, index) => (
    <GraphItem
      key={position.id}
      index={index}
      elementId={position.id}
      position={position}
      zIndex={position.zIndex ?? index}
      isSelected={selectedElements.some(
        (element) => element.type === 'graph' && element.id === position.id,
      )}
      selectedElements={selectedElements}
      activeTool={activeTool}
      zoom={zoom}
      panX={panX}
      panY={panY}
      isViewportTransforming={isViewportTransforming}
      {...stableHandlers(
        position.id,
        createCommonHandlers('graph', index, position.id),
      )}
    />
  ));

  const knobElements = knobPositions.map((position, index) => (
    <KnobItem
      key={position.id}
      index={index}
      elementId={position.id}
      position={position}
      zIndex={position.zIndex ?? index}
      isSelected={selectedElements.some(
        (element) => element.type === 'knob' && element.id === position.id,
      )}
      selectedElements={selectedElements}
      activeTool={activeTool}
      zoom={zoom}
      panX={panX}
      panY={panY}
      isViewportTransforming={isViewportTransforming}
      {...stableHandlers(
        position.id,
        createCommonHandlers('knob', index, position.id),
      )}
    />
  ));

  const spriteElements = spritePositions.map((position, index) => (
    <SpriteItem
      key={position.id}
      index={index}
      elementId={position.id}
      position={position}
      zIndex={position.zIndex ?? index}
      isSelected={selectedElements.some(
        (element) => element.type === 'sprite' && element.id === position.id,
      )}
      selectedElements={selectedElements}
      activeTool={activeTool}
      zoom={zoom}
      panX={panX}
      panY={panY}
      isViewportTransforming={isViewportTransforming}
      {...stableHandlers(
        position.id,
        createCommonHandlers('sprite', index, position.id),
      )}
    />
  ));

  return (
    <>
      {keyElements}
      {statElements}
      {graphElements}
      {knobElements}
      {spriteElements}
    </>
  );
};

export default NativeGridElements;
