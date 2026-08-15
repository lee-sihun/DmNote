// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckbox } from '@utils/plugin/pluginComponents';
import { clearComponentHandlers } from '@utils/plugin/pluginUtils';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { registerPluginInstancesEditSessionFlush } from '../displayElement/instancesCommitQueue';
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

  it('컨텍스트 메뉴 생성과 모달 확정·취소는 편집 세션을 즉시 flush한다', async () => {
    const flush = vi.fn();
    cleanups.push(registerPluginInstancesEditSessionFlush('plugin-a', flush));
    const custom = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const element = {
      fullId: 'plugin-a::one',
      definitionId: 'plugin-a',
      pluginId: 'plugin-a',
      settings: { enabled: true },
      state: {},
      position: { x: 0, y: 0 },
      html: '',
    } as unknown as PluginDisplayElementInternal;
    usePluginDisplayElementStore.setState({ elements: [element] });

    let menuItem:
      | { onClick: (context: unknown) => unknown | Promise<unknown> }
      | undefined;
    const addElement = vi.fn();
    const update = vi.fn();
    createDefineElement({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'ko' }) },
        ui: {
          dialog: { custom },
          components: { checkbox: createCheckbox },
          displayElement: { update, add: addElement },
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
      },
      template: () => '',
    });

    // 생성은 discrete 편집 - add 직후 즉시 커밋
    await menuItem?.onClick({ position: { dx: 0, dy: 0 } });
    expect(addElement).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledTimes(1);

    const addConfig = addElement.mock.calls[0]?.[0] as {
      onClick?: (event: Event) => unknown;
    };
    const event = {
      currentTarget: { getAttribute: () => element.fullId },
    } as unknown as Event;

    // 모달 확정 - 커밋된 설정을 즉시 저장
    await addConfig.onClick?.(event);
    expect(update).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(2);

    // 모달 취소 - revert 반영 후 flush
    await addConfig.onClick?.(event);
    expect(update).toHaveBeenCalledWith(element.fullId, {
      settings: { enabled: true },
    });
    expect(flush).toHaveBeenCalledTimes(3);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      flush.mock.invocationCallOrder[2],
    );
  });
});
