// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckbox } from '@utils/plugin/pluginComponents';
import { clearComponentHandlers } from '@utils/plugin/pluginUtils';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { handlerRegistry } from '../handlers';
import { createDefineElement } from './defineElement';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const pluginHandlerKeys = () =>
  Object.keys(window).filter(
    (key) =>
      key.startsWith('__dmn_handler_plugin-a_') ||
      key.startsWith('__dmn_component_handler_'),
  );

describe('defineElement modal handler lifecycle', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    window.__dmn_current_plugin_id = 'plugin-a';
    window.__dmn_window_type = 'main';
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
    delete window.__dmn_current_plugin_id;
    delete window.__dmn_window_type;
  });

  it('instance modal close와 reject 뒤 transient handler만 정리한다', async () => {
    const custom = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('dialog failed'));
    const element = {
      fullId: 'plugin-a::one',
      definitionId: 'plugin-a',
      pluginId: 'plugin-a',
      settings: { enabled: false, color: '#fff' },
      state: {},
      position: { x: 0, y: 0 },
      html: '',
    } as unknown as PluginDisplayElementInternal;
    usePluginDisplayElementStore.setState({ elements: [element] });

    let menuItem:
      | { onClick: (context: unknown) => unknown | Promise<unknown> }
      | undefined;
    const addElement = vi.fn();
    createDefineElement({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'ko' }) },
        ui: {
          dialog: { custom },
          components: { checkbox: createCheckbox },
          displayElement: { update: vi.fn(), add: addElement },
          contextMenu: {
            addGridMenuItem: vi.fn(
              (item: { onClick: (context: unknown) => unknown }) => {
                menuItem = item;
                return 'menu-1';
              },
            ),
            removeMenuItem: vi.fn(),
          },
        },
      },
      namespacedStorage: { get: vi.fn().mockResolvedValue(null) },
      registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
      wrapFunctionWithContext: (fn) => fn,
      isReloading: () => false,
      waitForReloadEnd: vi.fn().mockResolvedValue(undefined),
    } as never)({
      name: 'Example',
      settingsUI: 'modal',
      settings: {
        enabled: { type: 'boolean', default: false, label: 'Enabled' },
        color: { type: 'color', default: '#fff', label: 'Color' },
      },
      template: () => '',
    });

    // 생성 메뉴가 add config에 싣는 영구 onClick 핸들러를 획득해 등록
    await menuItem?.onClick({ position: { dx: 0, dy: 0 } });
    const addConfig = addElement.mock.calls[0]?.[0] as {
      onClick?: (event: Event) => unknown;
    };
    expect(addConfig?.onClick).toBeTypeOf('function');
    const persistentId = handlerRegistry.register(
      'plugin-a',
      addConfig.onClick as never,
    );
    const click = handlerRegistry.get(persistentId);
    const event = {
      currentTarget: { getAttribute: () => element.fullId },
    } as unknown as Event;

    await click?.(event);
    await click?.(event);
    expect(pluginHandlerKeys()).toEqual([persistentId]);

    await expect(click?.(event)).rejects.toThrow('dialog failed');
    expect(pluginHandlerKeys()).toEqual([persistentId]);
    expect(handlerRegistry.get(persistentId)).toBe(click);
  });
});
