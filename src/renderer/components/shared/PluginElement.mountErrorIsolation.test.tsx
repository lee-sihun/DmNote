import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginElement } from '@components/shared/PluginElement';
import { I18nContext } from '@contexts/I18nContextDef';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DEFINITION_ID = 'mount-error-plugin';
const FULL_ID = `${DEFINITION_ID}::11111111-1111-4111-8111-111111111111`;

const element = {
  id: FULL_ID.split('::')[1],
  fullId: FULL_ID,
  pluginId: DEFINITION_ID,
  definitionId: DEFINITION_ID,
  position: { x: 10, y: 10 },
  tabId: '4key',
} as unknown as PluginDisplayElementInternal;

const seedStores = (onMount: () => void) => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  usePluginDisplayElementStore.setState({
    elements: [element],
    definitions: new Map([
      [
        DEFINITION_ID,
        {
          id: DEFINITION_ID,
          pluginId: DEFINITION_ID,
          name: 'Mount Error Plugin',
          template: () => '<span>plugin body</span>',
          onMount,
        } as PluginDefinitionInternal,
      ],
    ]),
  });
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  usePluginDisplayElementStore.setState({
    elements: [],
    definitions: new Map(),
  });
  vi.restoreAllMocks();
});

describe('플러그인 onMount 오류 격리', () => {
  it('한 플러그인의 동기 오류가 오버레이 루트를 비우지 않는다', () => {
    const mountError = new Error('intentional mount failure');
    const onMount = vi.fn(() => {
      throw mountError;
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    seedStores(onMount);

    act(() => {
      root.render(
        <I18nContext.Provider
          value={{ locale: 'ko', setLocale: async () => {}, t: (key) => key }}
        >
          <div data-testid="healthy-sibling">healthy</div>
          <PluginElement element={element} windowType="overlay" />
        </I18nContext.Provider>,
      );
    });

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="healthy-sibling"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-plugin-element="${FULL_ID}"]`),
    ).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      `[PluginElement] onMount failed for ${FULL_ID}:`,
      mountError,
    );
  });
});
