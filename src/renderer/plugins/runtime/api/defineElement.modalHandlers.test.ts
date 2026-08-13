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
  beforeEach(() => {
    window.__dmn_current_plugin_id = 'plugin-a';
    window.__dmn_window_type = 'overlay';
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
    window.__dmn_element_restorers = new Map();
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
  });

  afterEach(() => {
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
    delete window.__dmn_current_plugin_id;
    delete window.__dmn_element_restorers;
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

    createDefineElement({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'ko' }) },
        ui: {
          dialog: { custom },
          components: { checkbox: createCheckbox },
          displayElement: { update: vi.fn() },
        },
      },
      namespacedStorage: { get: vi.fn().mockResolvedValue(null) },
      registerCleanup: vi.fn(),
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

    const restore = window.__dmn_element_restorers?.get('plugin-a');
    const restored = restore?.(element);
    const persistentId = restored?._onClickId;
    expect(persistentId).toBeTypeOf('string');
    const click = handlerRegistry.get(persistentId!);
    const event = {
      currentTarget: { getAttribute: () => element.fullId },
    } as unknown as Event;

    await click?.(event);
    await click?.(event);
    expect(pluginHandlerKeys()).toEqual([persistentId]);

    await expect(click?.(event)).rejects.toThrow('dialog failed');
    expect(pluginHandlerKeys()).toEqual([persistentId]);
    expect(handlerRegistry.get(persistentId!)).toBe(click);
  });
});
