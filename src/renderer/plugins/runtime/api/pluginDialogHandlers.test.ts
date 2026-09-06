// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearComponentHandlers,
  registerComponentHandler,
} from '@utils/plugin/components/pluginUtils';
import {
  createButton,
  createCheckbox,
  createDropdown,
  createInput,
} from '@utils/plugin/components/pluginComponents';
import { createPluginDialogHandlerScope } from './pluginDialogHandlers';

describe('plugin dialog handler scope', () => {
  afterEach(() => clearComponentHandlers('plugin-a'));

  it('button, input, checkbox, dropdown factory 등록을 모두 추적해 정리한다', () => {
    const scope = createPluginDialogHandlerScope();
    window.__dmn_current_plugin_id = 'plugin-a';
    const persistent = registerComponentHandler('plugin-a', () => undefined);
    scope.capture(() => createButton('Button', { onClick: () => undefined }));
    scope.capture(() => createInput({ onInput: () => undefined }));
    scope.capture(() => createCheckbox({ onChange: () => undefined }));
    scope.capture(() =>
      createDropdown({
        options: [{ label: 'One', value: 'one' }],
        onChange: () => undefined,
      }),
    );
    const ids = Object.keys(window).filter(
      (key) => key.startsWith('__dmn_component_handler_') && key !== persistent,
    );

    scope.dispose();

    ids.forEach((id) => expect(window[id as never]).toBeUndefined());
    expect(window[persistent as never]).toBeTypeOf('function');
    delete window.__dmn_current_plugin_id;
  });

  it('factory가 등록 뒤 throw해도 handler를 추적한다', () => {
    const scope = createPluginDialogHandlerScope();
    let handlerId = '';

    expect(() =>
      scope.capture(() => {
        handlerId = registerComponentHandler('plugin-a', () => undefined);
        throw new Error('factory failed');
      }),
    ).toThrow('factory failed');
    scope.dispose();

    expect(window[handlerId as never]).toBeUndefined();
  });
});
