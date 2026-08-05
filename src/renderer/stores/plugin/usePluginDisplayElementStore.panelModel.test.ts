import { afterEach, describe, expect, it } from 'vitest';

import type {
  PluginDisplayElementInternal,
  PluginPanelElementView,
} from '@src/types/plugin/api';
import {
  selectPropertyPanelPluginElements,
  usePluginDisplayElementStore,
} from './usePluginDisplayElementStore';

const authorityElement: PluginDisplayElementInternal = {
  id: 'authority-element',
  fullId: 'plugin-a:authority-element',
  pluginId: 'plugin-a',
  definitionId: 'definition-a',
  html: '<div>authority</div>',
  position: { x: 1, y: 2 },
};

const panelElement: PluginPanelElementView = {
  id: 'panel-element',
  fullId: 'plugin-a:panel-element',
  pluginId: 'plugin-a',
  definitionId: 'definition-a',
  position: { x: 3, y: 4 },
};

describe('plugin panel read-model store separation', () => {
  afterEach(() => {
    window.__dmn_window_type = 'main';
    usePluginDisplayElementStore.setState({
      elements: [],
      panelElements: [],
      definitionViews: new Map(),
      elementVisibilityViews: new Map(),
    });
  });

  it('panel projection이 authority elements를 덮어쓰지 않는다', () => {
    usePluginDisplayElementStore.setState({ elements: [authorityElement] });

    usePluginDisplayElementStore
      .getState()
      .applyPanelModel([panelElement], [], {});

    expect(usePluginDisplayElementStore.getState().elements).toEqual([
      authorityElement,
    ]);
    expect(usePluginDisplayElementStore.getState().panelElements).toEqual([
      panelElement,
    ]);
  });

  it('창 역할에 맞는 요소 모델만 PropertiesPanel에 제공한다', () => {
    usePluginDisplayElementStore.setState({
      elements: [authorityElement],
      panelElements: [panelElement],
    });

    window.__dmn_window_type = 'panel';
    expect(
      selectPropertyPanelPluginElements(
        usePluginDisplayElementStore.getState(),
      ),
    ).toEqual([panelElement]);

    window.__dmn_window_type = 'main';
    expect(
      selectPropertyPanelPluginElements(
        usePluginDisplayElementStore.getState(),
      ),
    ).toEqual([authorityElement]);
  });
});
