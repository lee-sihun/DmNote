import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginElement } from '@components/shared/PluginElement';
import { I18nContext } from '@contexts/I18nContextDef';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const measurementMocks = vi.hoisted(() => ({
  attachInteractions: vi.fn(),
  detachInteractions: [] as Array<ReturnType<typeof vi.fn>>,
  measure: vi.fn(),
  updateElement: vi.fn(),
}));

vi.mock('@utils/plugin/pluginElementMeasurement', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@utils/plugin/pluginElementMeasurement')
  >()),
  measureConnectedPluginElement: measurementMocks.measure,
}));

vi.mock('@utils/plugin/pluginDomInteractions', () => ({
  attachPluginDomInteractions: measurementMocks.attachInteractions,
}));

const DEFINITION_ID = 'measurement-plugin';
const FULL_ID = `${DEFINITION_ID}::11111111-1111-4111-8111-111111111111`;
const originalPluginStore = usePluginDisplayElementStore.getState();

const makeElement = (
  updates: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal =>
  ({
    id: FULL_ID.split('::')[1],
    fullId: FULL_ID,
    pluginId: DEFINITION_ID,
    definitionId: DEFINITION_ID,
    position: { x: 10, y: 20 },
    resizeAnchor: 'top-left',
    settings: { mode: 'a' },
    state: { label: 'a' },
    tabId: '4key',
    ...updates,
  } as PluginDisplayElementInternal);

const makeDefinition = (
  updates: Partial<PluginDefinitionInternal> = {},
): PluginDefinitionInternal => ({
  id: DEFINITION_ID,
  pluginId: DEFINITION_ID,
  name: 'Measurement Plugin',
  template: (state) => `<span>${String(state.label)}</span>`,
  ...updates,
});

const seedBaseStores = () => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    lastSelectedKeyBounds: null,
  });
};

describe('PluginElement 측정·설정 크기 수명주기', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frameId: number;
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

  const renderElement = (
    element: PluginDisplayElementInternal,
    definition: PluginDefinitionInternal,
    zoom = 1,
  ): HTMLDivElement => {
    act(() => {
      usePluginDisplayElementStore.setState({
        elements: [element],
        definitions: new Map([[definition.id, definition]]),
        updateElement: measurementMocks.updateElement,
      });
      root.render(
        <I18nContext.Provider
          value={{ locale: 'ko', setLocale: () => {}, t: (key) => key }}
        >
          <PluginElement element={element} windowType="main" zoom={zoom} />
        </I18nContext.Provider>,
      );
    });
    const node = container.querySelector<HTMLDivElement>(
      `[data-plugin-element="${FULL_ID}"]`,
    );
    expect(node).not.toBeNull();
    return node!;
  };

  const runLatestFrame = () => {
    const id = [...frameCallbacks.keys()].at(-1);
    expect(id).toBeDefined();
    const callback = frameCallbacks.get(id!);
    frameCallbacks.delete(id!);
    act(() => callback?.(performance.now()));
    return id!;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    measurementMocks.detachInteractions.length = 0;
    measurementMocks.attachInteractions.mockImplementation(() => {
      const detach = vi.fn();
      measurementMocks.detachInteractions.push(detach);
      return detach;
    });
    measurementMocks.measure.mockReturnValue({ width: 100, height: 50 });
    frameId = 0;
    frameCallbacks = new Map();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = ++frameId;
        frameCallbacks.set(id, callback);
        return id;
      }),
    );
    cancelAnimationFrameMock = vi.fn((id: number) => {
      frameCallbacks.delete(id);
    });
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    window.__dmn_window_type = 'main';
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
      updateElement: measurementMocks.updateElement,
      updateElementBatched: originalPluginStore.updateElementBatched,
    });
    seedBaseStores();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
      updateElement: originalPluginStore.updateElement,
      updateElementBatched: originalPluginStore.updateElementBatched,
    });
    delete window.__dmn_window_type;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('첫 측정은 저장하고 동일 크기 재측정은 update를 생략한다', () => {
    const definition = makeDefinition();
    const initial = makeElement();
    renderElement(initial, definition);
    runLatestFrame();

    expect(measurementMocks.updateElement).toHaveBeenCalledWith(FULL_ID, {
      measuredSize: { width: 100, height: 50 },
    });

    measurementMocks.updateElement.mockClear();
    renderElement(
      makeElement({ measuredSize: { width: 100, height: 50 } }),
      definition,
    );
    runLatestFrame();

    expect(measurementMocks.measure).toHaveBeenCalledTimes(2);
    expect(measurementMocks.updateElement).not.toHaveBeenCalled();
  });

  it('settings A→B→A에서 각 설정의 마지막 크기를 복원한다', () => {
    const definition = makeDefinition({
      resizable: true,
      preserveAxis: 'none',
    });
    renderElement(
      makeElement({ measuredSize: { width: 100, height: 50 } }),
      definition,
    );

    measurementMocks.measure.mockReturnValueOnce({ width: 140, height: 80 });
    renderElement(
      makeElement({
        settings: { mode: 'b' },
        measuredSize: { width: 100, height: 50 },
      }),
      definition,
    );
    runLatestFrame();

    renderElement(
      makeElement({
        settings: { mode: 'b' },
        measuredSize: { width: 140, height: 80 },
      }),
      definition,
    );
    measurementMocks.updateElement.mockClear();
    renderElement(
      makeElement({
        settings: { mode: 'a' },
        measuredSize: { width: 140, height: 80 },
      }),
      definition,
    );

    expect(measurementMocks.updateElement).toHaveBeenCalledOnce();
    expect(measurementMocks.updateElement).toHaveBeenCalledWith(FULL_ID, {
      measuredSize: { width: 100, height: 50 },
      width: 100,
      height: 50,
      position: { x: 10, y: 20 },
    });
  });

  it.each([
    ['none', 'auto', 'auto', 140, 80, true],
    ['width', '100px', 'auto', 100, 80, true],
    ['height', 'auto', '50px', 140, 50, true],
    ['both', '100px', '50px', 100, 50, false],
  ] as const)(
    'preserveAxis=%s는 측정 제약과 최종 축 크기를 보존한다',
    (
      preserveAxis,
      measuredWidthStyle,
      measuredHeightStyle,
      width,
      height,
      shouldUpdate,
    ) => {
      const definition = makeDefinition({ resizable: true, preserveAxis });
      const node = renderElement(
        makeElement({ measuredSize: { width: 100, height: 50 } }),
        definition,
      );
      let widthDuringMeasure = '';
      let heightDuringMeasure = '';
      measurementMocks.measure.mockImplementationOnce((target: HTMLElement) => {
        widthDuringMeasure = target.style.width;
        heightDuringMeasure = target.style.height;
        return { width: 140, height: 80 };
      });

      renderElement(
        makeElement({
          settings: { mode: 'b' },
          measuredSize: { width: 100, height: 50 },
        }),
        definition,
      );
      runLatestFrame();

      expect(widthDuringMeasure).toBe(measuredWidthStyle);
      expect(heightDuringMeasure).toBe(measuredHeightStyle);
      expect(node.style.width).toBe('100px');
      expect(node.style.height).toBe('50px');
      if (shouldUpdate) {
        expect(measurementMocks.updateElement).toHaveBeenLastCalledWith(
          FULL_ID,
          { measuredSize: { width, height } },
        );
      } else {
        expect(measurementMocks.updateElement).not.toHaveBeenCalled();
      }
    },
  );

  it('콘텐츠 크기 변경은 resize anchor offset과 크기를 한 update에 반영한다', () => {
    const definition = makeDefinition({
      resizable: true,
      preserveAxis: 'none',
      resizeAnchor: 'bottom-right',
    });
    renderElement(
      makeElement({
        resizeAnchor: 'bottom-right',
        measuredSize: { width: 100, height: 50 },
      }),
      definition,
    );
    measurementMocks.measure.mockReturnValueOnce({ width: 140, height: 80 });

    renderElement(
      makeElement({
        resizeAnchor: 'bottom-right',
        settings: { mode: 'b' },
        measuredSize: { width: 100, height: 50 },
      }),
      definition,
    );
    runLatestFrame();

    expect(measurementMocks.updateElement).toHaveBeenLastCalledWith(FULL_ID, {
      position: { x: -30, y: -10 },
      measuredSize: { width: 140, height: 80 },
    });
  });

  it('zoom만 바뀐 측정은 anchor 위치 보정을 생략한다', () => {
    const definition = makeDefinition({ resizeAnchor: 'bottom-right' });
    const element = makeElement({
      resizeAnchor: 'bottom-right',
      measuredSize: { width: 100, height: 50 },
    });
    renderElement(element, definition, 1);
    runLatestFrame();
    measurementMocks.updateElement.mockClear();
    measurementMocks.measure.mockReturnValueOnce({ width: 140, height: 80 });

    renderElement(element, definition, 2);
    runLatestFrame();

    expect(measurementMocks.updateElement).toHaveBeenCalledWith(FULL_ID, {
      measuredSize: { width: 140, height: 80 },
    });
  });

  it('renderedContent 변경은 동일 target을 다시 측정한다', () => {
    const definition = makeDefinition();
    const initial = makeElement({ measuredSize: { width: 100, height: 50 } });
    renderElement(initial, definition);
    runLatestFrame();
    measurementMocks.updateElement.mockClear();
    measurementMocks.measure.mockReturnValueOnce({ width: 120, height: 60 });

    renderElement(
      makeElement({
        measuredSize: initial.measuredSize,
        state: { label: 'b' },
      }),
      definition,
    );
    runLatestFrame();

    expect(measurementMocks.measure).toHaveBeenCalledTimes(2);
    expect(measurementMocks.updateElement).toHaveBeenCalledWith(FULL_ID, {
      measuredSize: { width: 120, height: 60 },
    });
  });

  it('scoped 전환은 container interaction을 detach하고 shadow root에 다시 attach한다', () => {
    const definition = makeDefinition({ resizable: true });
    const node = renderElement(
      makeElement({ measuredSize: { width: 100, height: 50 } }),
      definition,
    );
    const containerDetach = measurementMocks.detachInteractions[0];
    expect(measurementMocks.attachInteractions).toHaveBeenLastCalledWith(node);

    renderElement(
      makeElement({
        scoped: true,
        measuredSize: { width: 100, height: 50 },
      }),
      definition,
    );

    expect(containerDetach).toHaveBeenCalledOnce();
    expect(node.shadowRoot).not.toBeNull();
    expect(measurementMocks.attachInteractions).toHaveBeenLastCalledWith(
      node.shadowRoot,
    );
  });

  it('pending 측정 cleanup은 RAF cancel→interaction detach→새 attach 순서를 유지한다', () => {
    const definition = makeDefinition();
    const initial = makeElement();
    renderElement(initial, definition);
    const pendingFrame = [...frameCallbacks.keys()].at(-1)!;
    const firstDetach = measurementMocks.detachInteractions[0];

    renderElement(makeElement({ state: { label: 'b' } }), definition, 2);

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrame);
    expect(cancelAnimationFrameMock.mock.invocationCallOrder[0]).toBeLessThan(
      firstDetach.mock.invocationCallOrder[0],
    );
    expect(firstDetach.mock.invocationCallOrder[0]).toBeLessThan(
      measurementMocks.attachInteractions.mock.invocationCallOrder[1],
    );
  });
});
