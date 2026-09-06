// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckbox,
  createDropdown,
  createInput,
} from '@utils/plugin/components/pluginComponents';
import { clearComponentHandlers } from '@utils/plugin/components/pluginUtils';
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
    delete window.__dmn_window_type;
    delete window.__dmn_getColorPickerState;
    delete window.__dmn_showColorPicker;
    document.body.replaceChildren();
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

  it('설정 타입별 preview·visibility·picker·cancel 계약을 보존한다', async () => {
    let settleDialog: ((confirmed: boolean) => void) | undefined;
    const dialogRoot = document.createElement('div');
    document.body.appendChild(dialogRoot);
    const custom = vi.fn(
      (html: string) =>
        new Promise<boolean>((resolve) => {
          dialogRoot.innerHTML = html;
          settleDialog = resolve;
        }),
    );
    const pickColor = vi.fn();
    const normalizationError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const onChange = vi.fn();
    const subscriber = vi.fn();
    const defineSettings = createDefineSettings({
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
        },
      },
      namespacedStorage: {
        get: vi.fn().mockResolvedValue({
          enabled: false,
          nickname: 'short',
          amount: 2,
          mode: 'one',
          color: '#111111',
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      registerCleanup: vi.fn(),
    } as never);
    const settings = defineSettings({
      settingsUI: 'modal',
      settings: {
        appearance: { type: 'section', label: 'Appearance' },
        enabled: { type: 'boolean', default: false, label: 'Enabled' },
        nickname: {
          type: 'string',
          default: '',
          label: 'Nickname',
          visible: (values) => values.enabled === true,
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
      onChange,
    });
    settings.subscribe(subscriber);

    const opening = settings.open();
    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());

    expect(custom).toHaveBeenCalledWith(
      expect.stringContaining(
        'data-settings-section="plugin-settings-plugin-a-0"',
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
    expect(dialogRoot.textContent).toContain('One');
    expect(dialogRoot.textContent).toContain('Two');

    const checkboxHandler = entries[0]
      ?.querySelector<HTMLElement>('[data-plugin-handler-change]')
      ?.getAttribute('data-plugin-handler-change');
    window.__dmn_current_plugin_id = 'outside-plugin';
    window[checkboxHandler as `__dmn_handler_${string}`]?.({
      target: { checked: true },
    } as unknown as Event);
    expect(window.__dmn_current_plugin_id).toBe('outside-plugin');
    expect(settings.get()).toEqual(expect.objectContaining({ enabled: true }));
    expect(entries[1]?.style.display).toBe('');

    const textInput =
      entries[1]?.querySelector<HTMLInputElement>('input[type="text"]');
    const textHandler = textInput?.getAttribute('data-plugin-handler-change');
    window[textHandler as `__dmn_handler_${string}`]?.({
      target: { value: 'expanded' },
    } as unknown as Event);
    expect(settings.get()).toEqual(
      expect.objectContaining({ nickname: 'expanded' }),
    );

    const numberInput = entries[2]?.querySelector<HTMLInputElement>(
      'input[type="number"]',
    );
    const numberHandler = numberInput?.getAttribute(
      'data-plugin-handler-change',
    );
    window[numberHandler as `__dmn_handler_${string}`]?.({
      target: { value: '99' },
    } as unknown as Event);
    expect(settings.get()).toEqual(expect.objectContaining({ amount: 10 }));

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
    expect(settings.get()).toEqual(expect.objectContaining({ mode: 'two' }));

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
        id: 'plugin-settings-plugin-a-color',
        referenceElement: colorButton,
      }),
    );
    const pickerOptions = pickColor.mock.calls[0]?.[0] as {
      onColorChange: (color: string) => void;
      onColorChangeComplete: (color: string) => void;
      onClose: () => void;
    };
    pickerOptions.onColorChange('#222222');
    expect(
      colorButton?.style.getPropertyValue('--dmn-color-swatch-color'),
    ).toBe('#222222');
    expect(settings.get()).toEqual(
      expect.objectContaining({ color: '#111111' }),
    );
    pickerOptions.onColorChangeComplete('#333333');
    expect(settings.get()).toEqual(
      expect.objectContaining({ color: '#333333' }),
    );
    expect(colorButton?.classList.contains('shadow-focus-ring')).toBe(true);
    pickerOptions.onClose();
    expect(colorButton?.classList.contains('shadow-focus-ring')).toBe(false);

    const showColorPicker = vi.fn();
    window.__dmn_getColorPickerState = () => ({
      isOpen: true,
      id: 'plugin-settings-plugin-a-color',
      color: '#444444',
    });
    window.__dmn_showColorPicker = showColorPicker;
    handlerRegistry.get(colorHandler || '')?.({
      target: colorButton,
    } as unknown as Event);
    expect(showColorPicker).toHaveBeenCalledWith({
      initialColor: '#444444',
      id: 'plugin-settings-plugin-a-color',
    });
    expect(pickColor).toHaveBeenCalledOnce();

    expect(normalizationError).toHaveBeenCalledTimes(1);
    settleDialog?.(false);
    await expect(opening).resolves.toBe(false);

    expect(settings.get()).toEqual({
      enabled: false,
      nickname: 'short',
      amount: 2,
      mode: 'one',
      color: '#111111',
      broken: 'broken',
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
    expect(pluginHandlerKeys()).toEqual([]);
  });

  it('확정은 저장 완료 뒤 onChange와 subscriber 순서로 정산한다', async () => {
    let settleDialog: ((confirmed: boolean) => void) | undefined;
    let finishSave: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const custom = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settleDialog = resolve;
        }),
    );
    const onChange = vi.fn();
    const subscriber = vi.fn();
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
        set: save,
      },
      registerCleanup: vi.fn(),
    } as never);
    const settings = defineSettings({
      settingsUI: 'modal',
      settings: {
        enabled: { type: 'boolean', default: false, label: 'Enabled' },
      },
      onChange,
    });
    settings.subscribe(subscriber);

    const opening = settings.open();
    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    settleDialog?.(true);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(onChange).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();

    finishSave?.();
    await expect(opening).resolves.toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledOnce();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(
      subscriber.mock.invocationCallOrder[0],
    );
  });

  it('빈 설정은 locale에 맞는 empty state와 버튼 문구를 만든다', async () => {
    const custom = vi.fn().mockResolvedValue(false);
    const defineSettings = createDefineSettings({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'en' }) },
        ui: { dialog: { custom }, components: {} },
      },
      namespacedStorage: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      registerCleanup: vi.fn(),
    } as never);

    await defineSettings({ settingsUI: 'modal', settings: {} }).open();

    expect(custom).toHaveBeenCalledWith(
      expect.stringContaining(
        'data-settings-empty="plugin-settings-plugin-a" style=""',
      ),
      {
        showCancel: true,
        confirmText: 'Apply',
        cancelText: 'Cancel',
      },
    );
    expect(custom.mock.calls[0]?.[0]).toContain('No settings available.');
  });
});
