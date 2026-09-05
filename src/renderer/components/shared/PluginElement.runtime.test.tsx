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
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { HostGlobalApi } from '@src/renderer/api/hostGlobalApi';
import type {
  PluginDefinitionHookContext,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

const mocks = vi.hoisted(() => ({
  bridgeSend: vi.fn(),
  clearExposedActions: vi.fn(),
  keyListener: null as null | ((payload: unknown) => void),
  keySubscribe: vi.fn(),
  keyUnsubscribe: vi.fn(),
  localeListener: null as null | ((locale: string) => void),
  localeSubscribe: vi.fn(),
  localeUnsubscribe: vi.fn(),
  obsListener: null as null | (() => void),
  obsSubscribe: vi.fn(),
  obsUnsubscribe: vi.fn(),
  rawKeyListener: null as null | ((payload: unknown) => void),
  rawKeySubscribe: vi.fn(),
  rawKeyUnsubscribe: vi.fn(),
  registerExposedActions: vi.fn(),
}));

vi.mock('@utils/displayElementActions', () => ({
  clearExposedActions: mocks.clearExposedActions,
  registerExposedActions: mocks.registerExposedActions,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.bridgeSend,
}));

vi.mock('@api/modules/obsApi', () => ({
  obsApi: {
    onResync: mocks.obsSubscribe,
  },
}));

vi.mock('@utils/input/keyEventBus', () => ({
  keyEventBus: {
    subscribe: mocks.keySubscribe,
  },
}));

vi.mock('@utils/input/rawKeyEventBus', () => ({
  rawKeyEventBus: {
    subscribe: mocks.rawKeySubscribe,
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DEFINITION_ID = 'runtime-plugin';
const NEXT_DEFINITION_ID = 'runtime-plugin-next';
const FULL_ID = `${DEFINITION_ID}::11111111-1111-4111-8111-111111111111`;

const originalApi = window.api;
const originalPluginStore = usePluginDisplayElementStore.getState();

const makeElement = (
  updates: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal =>
  ({
    id: FULL_ID.split('::')[1],
    fullId: FULL_ID,
    pluginId: DEFINITION_ID,
    definitionId: DEFINITION_ID,
    position: { x: 10, y: 10 },
    resizeAnchor: 'top-left',
    settings: { theme: 'light' },
    state: { menu: 'closed', stable: 7, ignored: 0 },
    tabId: '4key',
    ...updates,
  } as PluginDisplayElementInternal);

const makeDefinition = (
  updates: Partial<PluginDefinitionInternal> = {},
): PluginDefinitionInternal => ({
  id: DEFINITION_ID,
  pluginId: DEFINITION_ID,
  name: 'Runtime Plugin',
  template: () => '<span>plugin body</span>',
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
};

let container: HTMLDivElement;
let root: Root;
let isMounted: boolean;

const renderElement = (
  element: PluginDisplayElementInternal,
  definitions: PluginDefinitionInternal[],
  windowType: 'main' | 'overlay' = 'overlay',
) => {
  usePluginDisplayElementStore.setState({
    elements: [element],
    definitions: new Map(
      definitions.map((definition) => [definition.id, definition]),
    ),
  });
  act(() => {
    root.render(
      <I18nContext.Provider
        value={{ locale: 'ko', setLocale: () => {}, t: (key) => key }}
      >
        <PluginElement element={element} windowType={windowType} />
      </I18nContext.Provider>,
    );
  });
  isMounted = true;
};

const unmountRoot = () => {
  if (!isMounted) return;
  act(() => {
    root.unmount();
  });
  isMounted = false;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keyListener = null;
  mocks.localeListener = null;
  mocks.obsListener = null;
  mocks.rawKeyListener = null;
  mocks.keySubscribe.mockImplementation(
    (listener: (payload: unknown) => void) => {
      mocks.keyListener = listener;
      return mocks.keyUnsubscribe;
    },
  );
  mocks.rawKeySubscribe.mockImplementation(
    async (listener: (payload: unknown) => void) => {
      mocks.rawKeyListener = listener;
      return mocks.rawKeyUnsubscribe;
    },
  );
  mocks.obsSubscribe.mockImplementation((listener: () => void) => {
    mocks.obsListener = listener;
    return mocks.obsUnsubscribe;
  });
  mocks.localeSubscribe.mockImplementation(
    (listener: (locale: string) => void) => {
      mocks.localeListener = listener;
      return mocks.localeUnsubscribe;
    },
  );

  window.__dmn_window_type = 'overlay';
  window.api = {
    i18n: {
      getLocale: vi.fn(async () => 'ko'),
      onLocaleChange: mocks.localeSubscribe,
    },
  } as unknown as HostGlobalApi;
  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    },
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  usePluginDisplayElementStore.setState({
    elements: [],
    definitions: new Map(),
    updateElement: originalPluginStore.updateElement,
    updateElementBatched: originalPluginStore.updateElementBatched,
  });
  seedBaseStores();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  isMounted = false;
});

afterEach(() => {
  unmountRoot();
  container.remove();
  usePluginDisplayElementStore.setState({
    elements: [],
    definitions: new Map(),
    updateElement: originalPluginStore.updateElement,
    updateElementBatched: originalPluginStore.updateElementBatched,
  });
  window.api = originalApi;
  delete window.__dmn_window_type;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PluginElement overlay runtime 계약', () => {
  it('일반 DOM에서 shadow DOM으로 전환한 뒤에도 클릭은 한 번만 전달되고 unmount에서 해제된다', () => {
    window.__dmn_window_type = 'main';
    const click = vi.fn();
    vi.stubGlobal('__dmn_recheck_click', click);
    const definition = makeDefinition({
      template: () =>
        '<button data-plugin-handler="__dmn_recheck_click">run</button>',
    });
    renderElement(makeElement({ scoped: false }), [definition], 'main');
    const lightButton = container.querySelector<HTMLButtonElement>(
      '[data-plugin-handler]',
    )!;
    act(() => lightButton.click());
    expect(click).toHaveBeenCalledTimes(1);

    renderElement(makeElement({ scoped: true }), [definition], 'main');
    const element = container.querySelector<HTMLElement>(
      '[data-plugin-element]',
    )!;
    const shadowButton = element.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-plugin-handler]',
    )!;
    act(() => shadowButton.click());
    expect(click).toHaveBeenCalledTimes(2);

    unmountRoot();
    act(() => shadowButton.click());
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('노출 액션을 등록하고 언마운트에서 액션과 onMount 자원을 정리한다', () => {
    const play = vi.fn();
    const mountCleanup = vi.fn();
    const definition = makeDefinition({
      onMount: (context) => {
        context.expose({
          play,
          ignored: 'not-a-function' as unknown as () => void,
        });
        return mountCleanup;
      },
    });

    renderElement(makeElement(), [definition]);

    expect(mocks.clearExposedActions).toHaveBeenCalledTimes(1);
    expect(mocks.clearExposedActions).toHaveBeenCalledWith(FULL_ID);
    expect(mocks.registerExposedActions).toHaveBeenCalledWith(FULL_ID, {
      play,
    });

    unmountRoot();

    expect(mountCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.clearExposedActions).toHaveBeenCalledTimes(2);
    expect(mocks.clearExposedActions).toHaveBeenLastCalledWith(FULL_ID);
  });

  it('getSettings와 getAnchor는 최신 스토어를 읽고 setAnchor는 로컬과 main을 함께 갱신한다', () => {
    let context: PluginDefinitionHookContext | null = null;
    const definition = makeDefinition({
      resizeAnchor: 'center',
      onMount: (mountContext) => {
        context = mountContext;
      },
    });
    const element = makeElement();
    renderElement(element, [definition]);

    const latestElement = makeElement({
      settings: { theme: 'dark', density: 'compact' },
      resizeAnchor: 'bottom-right',
    });
    usePluginDisplayElementStore.setState({ elements: [latestElement] });

    expect(context?.getSettings()).toEqual({
      theme: 'dark',
      density: 'compact',
    });
    expect(context?.getAnchor()).toBe('bottom-right');

    act(() => {
      context?.setAnchor('top-center');
    });

    expect(
      usePluginDisplayElementStore.getState().elements[0].resizeAnchor,
    ).toBe('top-center');
    expect(mocks.bridgeSend).toHaveBeenCalledWith(
      'main',
      'plugin:displayElement:updateAnchor',
      { fullId: FULL_ID, resizeAnchor: 'top-center' },
    );
  });

  it('설정 리스너 오류를 격리하고 runtime 재마운트에서 이전 리스너를 해제한다', () => {
    const listenerError = new Error('settings listener failure');
    const failingListener = vi.fn(() => {
      throw listenerError;
    });
    const firstHealthyListener = vi.fn();
    const nextListener = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const firstDefinition = makeDefinition({
      onMount: (context) => {
        context.onSettingsChange(failingListener);
        context.onSettingsChange(firstHealthyListener);
      },
    });
    const nextDefinition = makeDefinition({
      id: NEXT_DEFINITION_ID,
      onMount: (context) => {
        context.onSettingsChange(nextListener);
      },
    });
    const initialElement = makeElement();
    renderElement(initialElement, [firstDefinition, nextDefinition]);

    const changedElement = makeElement({ settings: { theme: 'dark' } });
    renderElement(changedElement, [firstDefinition, nextDefinition]);

    expect(failingListener).toHaveBeenCalledWith(
      { theme: 'dark' },
      { theme: 'light' },
    );
    expect(firstHealthyListener).toHaveBeenCalledWith(
      { theme: 'dark' },
      { theme: 'light' },
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[PluginElement] onSettingsChange listener error:',
      listenerError,
    );

    const nextRuntimeElement = makeElement({
      definitionId: NEXT_DEFINITION_ID,
      settings: { theme: 'dark' },
    });
    renderElement(nextRuntimeElement, [firstDefinition, nextDefinition]);
    const nextSettingsElement = makeElement({
      definitionId: NEXT_DEFINITION_ID,
      settings: { theme: 'contrast' },
    });
    renderElement(nextSettingsElement, [firstDefinition, nextDefinition]);

    expect(failingListener).toHaveBeenCalledTimes(1);
    expect(firstHealthyListener).toHaveBeenCalledTimes(1);
    expect(nextListener).toHaveBeenCalledWith(
      { theme: 'contrast' },
      { theme: 'dark' },
    );
  });

  it('locale 구독 해제 함수를 onMount cleanup으로 반환할 수 있다', () => {
    const onLocale = vi.fn();
    const definition = makeDefinition({
      onMount: (context) => context.onLocaleChange(onLocale),
    });
    renderElement(makeElement(), [definition]);

    expect(mocks.localeSubscribe).toHaveBeenCalledWith(onLocale);
    act(() => {
      mocks.localeListener?.('en');
    });
    expect(onLocale).toHaveBeenCalledWith('en');

    unmountRoot();

    expect(mocks.localeUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('선언된 메뉴 상태만 diff 송신하고 OBS resync에는 최신 전체 상태를 재송신한다', () => {
    let context: PluginDefinitionHookContext | null = null;
    const definition = makeDefinition({
      contextMenuStateKeys: ['menu', 'stable'],
      onMount: (mountContext) => {
        context = mountContext;
      },
    });
    renderElement(makeElement(), [definition]);

    expect(mocks.bridgeSend).toHaveBeenCalledWith(
      'main',
      'plugin:displayElement:syncMenuState',
      { fullId: FULL_ID, state: { menu: 'closed', stable: 7 } },
    );
    mocks.bridgeSend.mockClear();

    act(() => {
      context?.setState({ menu: 'open' });
      context?.setState({ menu: 'open', ignored: 1 });
    });

    expect(mocks.bridgeSend).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeSend).toHaveBeenCalledWith(
      'main',
      'plugin:displayElement:syncMenuState',
      { fullId: FULL_ID, state: { menu: 'open' } },
    );
    mocks.bridgeSend.mockClear();

    act(() => {
      mocks.obsListener?.();
    });

    expect(mocks.bridgeSend).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeSend).toHaveBeenCalledWith(
      'main',
      'plugin:displayElement:syncMenuState',
      { fullId: FULL_ID, state: { menu: 'open', stable: 7 } },
    );

    unmountRoot();
    expect(mocks.obsUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('완료된 key와 rawKey 비동기 구독을 언마운트에서 해제한다', async () => {
    const onKey = vi.fn();
    const onRawKey = vi.fn();
    const definition = makeDefinition({
      onMount: (context) => {
        context.onHook('key', onKey);
        context.onHook('rawKey', onRawKey);
      },
    });
    renderElement(makeElement(), [definition]);

    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(mocks.keySubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.rawKeySubscribe).toHaveBeenCalledTimes(1);
    act(() => {
      mocks.keyListener?.({ key: 'A' });
      mocks.rawKeyListener?.({ label: 'Mouse Left' });
    });
    expect(onKey).toHaveBeenCalledWith({ key: 'A' });
    expect(onRawKey).toHaveBeenCalledWith({ label: 'Mouse Left' });

    unmountRoot();

    expect(mocks.keyUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.rawKeyUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
