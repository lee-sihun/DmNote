// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalReactiveSpritePosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import NativeGridElements from './NativeGridElements';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const operationMocks = vi.hoisted(() => ({
  commitPosition: vi.fn(),
  deleteElement: vi.fn(() => Promise.resolve()),
}));

vi.mock('@hooks/Grid/elementPositionCommit', () => ({
  commitElementPosition: operationMocks.commitPosition,
}));
vi.mock('@src/renderer/editor/runtime/operations/elementOps', () => ({
  deleteElementById: operationMocks.deleteElement,
}));
vi.mock('@src/renderer/editor/runtime/intent/elementIntent', () => ({
  reportElementOpError: vi.fn(),
}));
vi.mock('@hooks/shared/useStableHandlerSlots', () => ({
  useStableHandlerSlots:
    () =>
    <Handlers,>(_id: string, handlers: Handlers): Handlers =>
      handlers,
}));

async function createElementRenderer(kind: string) {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) => {
      const call = (name: string, ...args: unknown[]) =>
        (props[name] as ((...values: unknown[]) => void) | undefined)?.(
          ...args,
        );
      return createElement(
        'button',
        {
          ref: props.setReferenceRef as (node: HTMLElement | null) => void,
          'data-native-kind': kind,
          'data-element-id': props.elementId,
          'data-key-name': props.keyName,
          'data-selected': String(props.isSelected),
          onClick: (event: React.MouseEvent) => {
            if (event.shiftKey) call('onShiftClick', event);
            else if (event.ctrlKey) call('onCtrlClick', event);
            else call('onClick', event);
          },
          onDoubleClick: (event: React.MouseEvent) =>
            call('onDoubleClick', event),
          onContextMenu: (event: React.MouseEvent) =>
            call('onContextMenu', event),
          onMouseDown: () =>
            call('onPositionChange', props.index, 12, 34, props.elementId),
          onMouseUp: (event: React.MouseEvent) => {
            if (event.button === 1) call('onEraserClick');
          },
        },
        String(props.keyName ?? kind),
      );
    },
  };
}

vi.mock('@components/shared/key/Key', () => createElementRenderer('key-like'));
vi.mock('../layers/GraphItem', () => createElementRenderer('graph'));
vi.mock('../layers/KnobItem', () => createElementRenderer('knob'));
vi.mock('../layers/SpriteItem', () => createElementRenderer('sprite'));

const keyPosition = (
  id: string,
  dx: number,
  patch: Partial<CanonicalKeyPosition> = {},
): CanonicalKeyPosition =>
  ({ id, dx, dy: 0, width: 60, height: 60, ...patch } as CanonicalKeyPosition);

const KEY_ID = '00000000-0000-4000-8000-000000000101';
const STAT_ID = '00000000-0000-4000-8000-000000000102';
const GRAPH_ID = '00000000-0000-4000-8000-000000000103';
const KNOB_ID = '00000000-0000-4000-8000-000000000104';
const SPRITE_ID = '00000000-0000-4000-8000-000000000105';

describe('NativeGridElements', () => {
  let host: HTMLDivElement;
  let root: Root;
  const callbacks = {
    select: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    setSelected: vi.fn(),
    setLastBounds: vi.fn(),
    move: vi.fn(),
    dragStart: vi.fn(),
    dragEnd: vi.fn(),
    openEditor: vi.fn(),
    openContext: vi.fn(),
  };

  const renderScene = (
    lastSelectedKeyBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null,
  ) => {
    act(() => {
      root.render(
        <NativeGridElements
          mode="4key"
          keyPositions={[keyPosition(KEY_ID, 100)]}
          keyMappings={['KeyA']}
          statPositions={[
            {
              ...keyPosition(STAT_ID, 20),
              statType: 'total',
            } as CanonicalStatItemPosition,
          ]}
          graphPositions={[
            {
              ...keyPosition(GRAPH_ID, 40),
              statType: 'kpsMax',
              graphType: 'line',
              graphSpeed: 1,
              graphColor: '#fff',
            } as CanonicalGraphItemPosition,
          ]}
          knobPositions={[
            {
              ...keyPosition(KNOB_ID, 60),
              axisId: 'axis',
              sensitivity: 1,
              reverse: false,
            } as CanonicalKnobItemPosition,
          ]}
          spritePositions={[
            {
              ...keyPosition(SPRITE_ID, 80),
              poses: [],
            } as unknown as CanonicalReactiveSpritePosition,
          ]}
          pluginElements={[]}
          selectedElements={[{ type: 'graph', id: GRAPH_ID, index: 0 }]}
          activeTool="select"
          zoom={1}
          panX={0}
          panY={0}
          isViewportTransforming={false}
          keyCounterEnabled={true}
          lastSelectedKeyBounds={lastSelectedKeyBounds}
          onSelectElement={callbacks.select}
          onToggleElement={callbacks.toggle}
          onClearSelection={callbacks.clear}
          onSetSelectedElements={callbacks.setSelected}
          onSetLastSelectedKeyBounds={callbacks.setLastBounds}
          onMoveSelection={callbacks.move}
          onMultiDragStart={callbacks.dragStart}
          onMultiDragEnd={callbacks.dragEnd}
          onOpenElementEditor={callbacks.openEditor}
          onOpenElementContextMenu={callbacks.openContext}
        />,
      );
    });
  };

  const dispatchMouse = (
    node: Element,
    type: string,
    init: MouseEventInit = {},
  ) => {
    act(() => {
      node.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          ...init,
        }),
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('키·통계·그래프·노브·스프라이트를 기존 순서와 표시 모델로 렌더한다', () => {
    renderScene();

    const elements = [...host.querySelectorAll('[data-native-kind]')];
    expect(elements.map((element) => element.textContent)).toEqual([
      'KeyA',
      'Total',
      'graph',
      'knob',
      'sprite',
    ]);
    expect(
      elements.map((element) => element.getAttribute('data-selected')),
    ).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it('스프라이트도 같은 공통 핸들러로 위치 커밋·삭제·메뉴를 라우팅한다', () => {
    renderScene();
    const sprite = host.querySelector(`[data-element-id="${SPRITE_ID}"]`)!;

    dispatchMouse(sprite, 'mousedown');
    expect(operationMocks.commitPosition).toHaveBeenCalledWith(
      'sprite',
      SPRITE_ID,
      12,
      34,
    );

    dispatchMouse(sprite, 'contextmenu', { clientX: 3, clientY: 4 });
    expect(callbacks.openContext).toHaveBeenCalledWith(
      'sprite',
      0,
      3,
      4,
      sprite,
    );

    dispatchMouse(sprite, 'mouseup', { button: 1 });
    expect(operationMocks.deleteElement).toHaveBeenCalledWith(
      'sprite',
      SPRITE_ID,
    );
  });

  it('선택·범위 선택·위치 커밋·컨텍스트 메뉴 동작을 유형별로 라우팅한다', () => {
    renderScene();
    const key = host.querySelector(`[data-element-id="${KEY_ID}"]`)!;
    const stat = host.querySelector(`[data-element-id="${STAT_ID}"]`)!;
    const graph = host.querySelector(`[data-element-id="${GRAPH_ID}"]`)!;
    const knob = host.querySelector(`[data-element-id="${KNOB_ID}"]`)!;

    dispatchMouse(key, 'click');
    expect(callbacks.select).toHaveBeenCalledWith('key', 0);
    expect(callbacks.setLastBounds).toHaveBeenCalledWith({
      x: 100,
      y: 0,
      width: 60,
      height: 60,
    });

    dispatchMouse(stat, 'click', { shiftKey: true });
    expect(callbacks.toggle).toHaveBeenCalledWith('stat', 0);

    dispatchMouse(key, 'click', { shiftKey: true });
    expect(callbacks.clear).toHaveBeenCalledTimes(1);
    expect(callbacks.toggle).toHaveBeenCalledWith('key', 0);

    dispatchMouse(knob, 'mousedown');
    expect(operationMocks.commitPosition).toHaveBeenCalledWith(
      'knob',
      KNOB_ID,
      12,
      34,
    );

    dispatchMouse(graph, 'contextmenu', { clientX: 7, clientY: 9 });
    expect(callbacks.openContext).toHaveBeenCalledWith('graph', 0, 7, 9, graph);

    dispatchMouse(graph, 'mouseup', { button: 1 });
    expect(operationMocks.deleteElement).toHaveBeenCalledWith(
      'graph',
      GRAPH_ID,
    );
  });

  it('기존 키 앵커가 있으면 좌표 범위 수집 결과를 한 번에 적용한다', () => {
    renderScene({ x: 0, y: 0, width: 60, height: 60 });
    const key = host.querySelector(`[data-element-id="${KEY_ID}"]`)!;

    dispatchMouse(key, 'click', { shiftKey: true });

    expect(callbacks.clear).not.toHaveBeenCalled();
    expect(callbacks.setSelected).toHaveBeenCalledTimes(1);
    expect(
      callbacks.setSelected.mock.calls[0][0].map(
        (element: { type: string; id: string }) =>
          `${element.type}:${element.id}`,
      ),
    ).toEqual([
      `key:${KEY_ID}`,
      `stat:${STAT_ID}`,
      `graph:${GRAPH_ID}`,
      `knob:${KNOB_ID}`,
      `sprite:${SPRITE_ID}`,
    ]);
  });
});
