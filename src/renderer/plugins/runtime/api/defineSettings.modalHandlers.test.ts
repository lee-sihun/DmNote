// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckbox } from '@utils/plugin/pluginComponents';
import { clearComponentHandlers } from '@utils/plugin/pluginUtils';
import { handlerRegistry } from '../handlers';
import { createDefineSettings } from './defineSettings';

const pluginHandlerKeys = () =>
  Object.keys(window).filter(
    (key) =>
      key.startsWith('__dmn_handler_plugin-a_') ||
      key.startsWith('__dmn_component_handler_'),
  );

describe('defineSettings modal handler lifecycle', () => {
  beforeEach(() => {
    window.__dmn_current_plugin_id = 'plugin-a';
    window.__dmn_window_type = 'main';
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
  });

  afterEach(() => {
    handlerRegistry.clear();
    clearComponentHandlers('plugin-a');
    delete window.__dmn_current_plugin_id;
  });

  it('반복 open/close 뒤 transient registry와 window key를 남기지 않는다', async () => {
    const persistentId = handlerRegistry.register('plugin-a', () => undefined);
    const custom = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('dialog failed'));
    const defineSettings = createDefineSettings({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'ko' }) },
        ui: {
          dialog: { custom },
          components: { checkbox: createCheckbox },
        },
      },
      namespacedStorage: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      registerCleanup: vi.fn(),
    } as never);
    const settings = defineSettings({
      settingsUI: 'modal',
      settings: {
        enabled: { type: 'boolean', default: false, label: 'Enabled' },
        color: { type: 'color', default: '#fff', label: 'Color' },
      },
    });

    await settings.open();
    await settings.open();

    expect(custom).toHaveBeenCalledTimes(2);
    expect(pluginHandlerKeys()).toEqual([persistentId]);
    expect(handlerRegistry.get(persistentId)).toBeTypeOf('function');

    await expect(settings.open()).rejects.toThrow('dialog failed');
    expect(pluginHandlerKeys()).toEqual([persistentId]);
  });
});
