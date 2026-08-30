// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckbox,
  createDropdown,
  createInput,
} from '@utils/plugin/pluginComponents';
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
    delete window.__dmn_getColorPickerState;
    delete window.__dmn_showColorPicker;
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

  it('설정 타입별 preview·commit과 visibility·picker·cancel 계약을 보존한다', async () => {
    const flush = vi.fn();
    cleanups.push(registerPluginInstancesEditSessionFlush('plugin-a', flush));
    const element = {
      fullId: 'plugin-a::one',
      definitionId: 'plugin-a',
      pluginId: 'plugin-a',
      settings: {
        enabled: false,
        nickname: 'short',
        amount: 2,
        mode: 'one',
        color: '#111111',
      },
      state: {},
      position: { x: 0, y: 0 },
      html: '',
    } as unknown as PluginDisplayElementInternal;
    usePluginDisplayElementStore.setState({ elements: [element] });

    let menuItem:
      | { onClick: (context: unknown) => unknown | Promise<unknown> }
      | undefined;
    let settleDialog: ((confirmed: boolean) => void) | undefined;
    const dialogRoot = document.createElement('div');
    document.body.appendChild(dialogRoot);
    cleanups.push(() => dialogRoot.remove());
    const custom = vi.fn(
      (html: string) =>
        new Promise<boolean>((resolve) => {
          dialogRoot.innerHTML = html;
          settleDialog = resolve;
        }),
    );
    const addElement = vi.fn();
    const update = vi.fn();
    const pickColor = vi.fn();
    const normalizationError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    createDefineElement({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'en' }) },
        ui: {
          dialog: { custom },
          components: {
            checkbox: createCheckbox,
            input: createInput,
            dropdown: createDropdown,
          },
          pickColor,
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
      registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
      wrapFunctionWithContext: (fn) => fn,
      isReloading: () => false,
      waitForReloadEnd: vi.fn().mockResolvedValue(undefined),
    } as never)({
      name: 'Example',
      settingsUI: 'modal',
      settings: {
        appearance: { type: 'section', label: 'Appearance' },
        enabled: { type: 'boolean', default: false, label: 'Enabled' },
        nickname: {
          type: 'string',
          default: '',
          label: 'Nickname',
          visible: (settings) => settings.enabled === true,
        },
        amount: {
          type: 'number',
          default: 0,
          label: 'Amount',
          min: 0,
          max: 10,
          step: 1,
        },
        mode: {
          type: 'select',
          default: 'one',
          label: 'Mode',
          options: [
            { label: 'One', value: 'one' },
            { label: 'Two', value: 'two' },
          ],
        },
        color: { type: 'color', default: '#000000', label: 'Color' },
        broken: {
          type: 'string',
          default: 'broken',
          label: 'Broken',
          visible: () => {
            throw new Error('visibility failed');
          },
        },
      },
      template: () => '',
    });

    await menuItem?.onClick({ position: { dx: 0, dy: 0 } });
    const addConfig = addElement.mock.calls[0]?.[0] as {
      onClick?: (event: Event) => unknown;
    };
    update.mockClear();
    flush.mockClear();
    const opening = addConfig.onClick?.({
      currentTarget: { getAttribute: () => element.fullId },
    } as unknown as Event) as Promise<void>;
    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());

    expect(custom).toHaveBeenCalledWith(
      expect.stringContaining(
        'data-settings-section="plugin-element-plugin-a-plugin-a%3A%3Aone-0"',
      ),
      {
        showCancel: true,
        confirmText: 'Apply',
        cancelText: 'Cancel',
      },
    );
    const entries = Array.from(
      dialogRoot.querySelectorAll<HTMLElement>('[data-settings-entry]'),
    );
    expect(entries).toHaveLength(6);
    expect(entries[1]?.style.display).toBe('none');
    expect(entries[5]?.style.display).toBe('none');

    const querySelectorAll = vi.spyOn(document, 'querySelectorAll');
    const checkbox = entries[0]?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const checkboxHandler = entries[0]
      ?.querySelector<HTMLElement>('[data-plugin-handler-change]')
      ?.getAttribute('data-plugin-handler-change');
    window[checkboxHandler as `__dmn_handler_${string}`]?.({
      target: { checked: true },
    } as unknown as Event);

    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: expect.objectContaining({ enabled: true }),
    });
    expect(entries[1]?.style.display).toBe('');
    expect(querySelectorAll.mock.calls.map(([selector]) => selector)).toEqual([
      '[data-settings-section]',
      '[data-settings-entry]',
      '[data-settings-entry]',
      '[data-settings-entry]',
      '[data-settings-entry]',
      '[data-settings-entry]',
      '[data-settings-entry]',
      '[data-settings-empty]',
    ]);
    expect(checkbox).not.toBeNull();
    querySelectorAll.mockRestore();

    const textInput =
      entries[1]?.querySelector<HTMLInputElement>('input[type="text"]');
    const textHandler = textInput?.getAttribute('data-plugin-handler-change');
    window[textHandler as `__dmn_handler_${string}`]?.({
      target: { value: 'expanded' },
    } as unknown as Event);
    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: expect.objectContaining({ nickname: 'expanded' }),
    });

    const numberInput = entries[2]?.querySelector<HTMLInputElement>(
      'input[type="number"]',
    );
    const numberHandler = numberInput?.getAttribute(
      'data-plugin-handler-change',
    );
    window[numberHandler as `__dmn_handler_${string}`]?.({
      target: { value: '99' },
    } as unknown as Event);
    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: expect.objectContaining({ amount: 10 }),
    });

    const dropdown = entries[3]?.querySelector<HTMLElement>(
      '[data-plugin-handler-change]',
    );
    const dropdownHandler = dropdown?.getAttribute(
      'data-plugin-handler-change',
    );
    window[dropdownHandler as `__dmn_handler_${string}`]?.({
      target: {
        getAttribute: (name: string) =>
          name === 'data-selected' ? 'two' : null,
      },
    } as unknown as Event);
    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: expect.objectContaining({ mode: 'two' }),
    });

    const colorButton = entries[4]?.querySelector<HTMLButtonElement>(
      '[data-plugin-handler]',
    );
    const colorHandler = colorButton?.getAttribute('data-plugin-handler');
    handlerRegistry.get(colorHandler || '')?.({
      target: colorButton,
    } as unknown as Event);
    expect(pickColor).toHaveBeenCalledWith(
      expect.objectContaining({
        initialColor: '#111111',
        id: 'plugin-plugin-a-plugin-a::one-color',
        referenceElement: colorButton,
      }),
    );
    const pickerOptions = pickColor.mock.calls[0]?.[0] as {
      onColorChange: (color: string) => void;
      onColorChangeComplete: (color: string) => void;
      onClose: () => void;
    };
    const updateCountBeforePreview = update.mock.calls.length;
    pickerOptions.onColorChange('#222222');
    expect(
      colorButton?.style.getPropertyValue('--dmn-color-swatch-color'),
    ).toBe('#222222');
    expect(update).toHaveBeenCalledTimes(updateCountBeforePreview);
    pickerOptions.onColorChangeComplete('#333333');
    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: expect.objectContaining({ color: '#333333' }),
    });
    expect(colorButton?.classList.contains('shadow-focus-ring')).toBe(true);
    pickerOptions.onClose();
    expect(colorButton?.classList.contains('shadow-focus-ring')).toBe(false);

    const showColorPicker = vi.fn();
    window.__dmn_getColorPickerState = () => ({
      isOpen: true,
      id: 'plugin-plugin-a-plugin-a::one-color',
      color: '#444444',
    });
    window.__dmn_showColorPicker = showColorPicker;
    handlerRegistry.get(colorHandler || '')?.({
      target: colorButton,
    } as unknown as Event);
    expect(showColorPicker).toHaveBeenCalledWith({
      initialColor: '#444444',
      id: 'plugin-plugin-a-plugin-a::one-color',
    });
    expect(pickColor).toHaveBeenCalledOnce();

    expect(normalizationError).toHaveBeenCalledTimes(1);
    settleDialog?.(false);
    await opening;

    expect(update).toHaveBeenLastCalledWith(element.fullId, {
      settings: {
        enabled: false,
        nickname: 'short',
        amount: 2,
        mode: 'one',
        color: '#111111',
        broken: 'broken',
      },
    });
    expect(flush).toHaveBeenCalledOnce();
  });
});
