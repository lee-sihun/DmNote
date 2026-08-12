import { describe, expect, it, vi } from 'vitest';

import { createHostGlobalApi } from './hostGlobalApi';
import { internalApi } from './internalApi';

const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return [prefix];
  }
  if (typeof value === 'function') return [prefix];

  return Object.keys(value as Record<string, unknown>).flatMap((key) =>
    collectLeafPaths(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ),
  );
};

describe('host global API', () => {
  it('노출 namespace와 leaf를 읽기·구독·UI 계약으로 고정한다', () => {
    const api = createHostGlobalApi(internalApi);

    expect(collectLeafPaths(api).sort()).toMatchInlineSnapshot(`
      [
        "app.bootstrap",
        "bridge.off",
        "bridge.on",
        "bridge.onAny",
        "bridge.once",
        "counterAnimation.list",
        "counterAnimation.onChanged",
        "css.get",
        "css.getUse",
        "css.historyGet",
        "css.onContent",
        "css.onUse",
        "css.tab.get",
        "css.tab.getAll",
        "css.tab.onChanged",
        "editor.get",
        "editor.onCommitted",
        "graphItems.getPositions",
        "graphItems.onPositionsChanged",
        "i18n.getLocale",
        "i18n.onLocaleChange",
        "js.get",
        "js.getUse",
        "js.onState",
        "js.onUse",
        "keys.customTabs.list",
        "keys.customTabs.onChanged",
        "keys.get",
        "keys.getCounters",
        "keys.getPositions",
        "keys.onChanged",
        "keys.onCounterChanged",
        "keys.onCountersChanged",
        "keys.onKeyState",
        "keys.onKeysReset",
        "keys.onModeChanged",
        "keys.onPositionsChanged",
        "keys.onRawInput",
        "knobItems.getPositions",
        "knobItems.onPositionsChanged",
        "layerGroups.get",
        "layerGroups.onChanged",
        "noteTab.get",
        "noteTab.getAll",
        "noteTab.onChanged",
        "noteTab.onChangedAll",
        "overlay.get",
        "overlay.onAnchor",
        "overlay.onLock",
        "overlay.onResized",
        "overlay.onVisibility",
        "presets.onSnapshot",
        "settings.get",
        "settings.onChanged",
        "sound.list",
        "sound.loadOriginal",
        "statItems.getPositions",
        "statItems.onPositionsChanged",
        "stats.get",
        "stats.subscribe",
        "ui.components.button",
        "ui.components.checkbox",
        "ui.components.dropdown",
        "ui.components.formRow",
        "ui.components.input",
        "ui.components.panel",
        "ui.contextMenu.addGridMenuItem",
        "ui.contextMenu.addKeyMenuItem",
        "ui.contextMenu.clearMyMenuItems",
        "ui.contextMenu.removeMenuItem",
        "ui.contextMenu.updateMenuItem",
        "ui.dialog.alert",
        "ui.dialog.confirm",
        "ui.dialog.custom",
        "ui.displayElement.add",
        "ui.displayElement.addClass",
        "ui.displayElement.clearMyElements",
        "ui.displayElement.get",
        "ui.displayElement.html",
        "ui.displayElement.query",
        "ui.displayElement.remove",
        "ui.displayElement.removeClass",
        "ui.displayElement.setData",
        "ui.displayElement.setHTML",
        "ui.displayElement.setState",
        "ui.displayElement.setStyle",
        "ui.displayElement.setText",
        "ui.displayElement.template",
        "ui.displayElement.toggleClass",
        "ui.displayElement.update",
        "ui.pickColor",
        "window.type",
      ]
    `);
  });

  it('저장·상태 변경 leaf를 전역에 노출하지 않는다', () => {
    const api = createHostGlobalApi(internalApi) as unknown as Record<
      string,
      Record<string, unknown>
    >;

    const forbidden = [
      ['app', 'autoUpdate'],
      ['settings', 'update'],
      ['editor', 'commit'],
      ['keys', 'update'],
      ['keys', 'updateWithPositions'],
      ['keys', 'updatePositions'],
      ['statItems', 'updatePositions'],
      ['graphItems', 'updatePositions'],
      ['knobItems', 'updatePositions'],
      ['layerGroups', 'update'],
      ['overlay', 'setVisible'],
      ['css', 'toggle'],
      ['noteTab', 'set'],
      ['sound', 'remove'],
      ['counterAnimation', 'update'],
      ['js', 'load'],
      ['presets', 'load'],
      ['bridge', 'send'],
      ['stats', 'reset'],
      ['plugin', 'storage'],
    ] as const;

    for (const [namespace, leaf] of forbidden) {
      expect(api[namespace]?.[leaf], `${namespace}.${leaf}`).toBeUndefined();
    }
  });

  it('실제 설치는 root에 projection만 두고 dmn 별칭은 만들지 않는다', async () => {
    const root = globalThis as typeof globalThis & {
      api?: unknown;
      dmn?: unknown;
    };
    const apiDescriptor = Object.getOwnPropertyDescriptor(root, 'api');
    const dmnDescriptor = Object.getOwnPropertyDescriptor(root, 'dmn');

    try {
      Reflect.deleteProperty(root, 'api');
      Reflect.deleteProperty(root, 'dmn');
      vi.resetModules();
      vi.doMock('./internalApi', () => ({ internalApi }));

      const module = await import('./dmnoteApi');

      expect(window.api).toBe(root.api);
      expect(window.api).not.toBe(module.default);
      expect(collectLeafPaths(window.api).sort()).toEqual(
        collectLeafPaths(createHostGlobalApi(module.default)).sort(),
      );
      expect(Object.prototype.hasOwnProperty.call(window, 'dmn')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(root, 'dmn')).toBe(false);
    } finally {
      if (apiDescriptor) {
        Object.defineProperty(root, 'api', apiDescriptor);
      } else {
        Reflect.deleteProperty(root, 'api');
      }
      if (dmnDescriptor) {
        Object.defineProperty(root, 'dmn', dmnDescriptor);
      } else {
        Reflect.deleteProperty(root, 'dmn');
      }
      vi.doUnmock('./internalApi');
      vi.resetModules();
    }
  });
});
