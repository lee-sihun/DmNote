import type { DMNoteAPI } from '@src/types/plugin/api';

export interface HostGlobalApi {
  app: Pick<DMNoteAPI['app'], 'bootstrap'>;
  window: Pick<DMNoteAPI['window'], 'type'>;
  settings: Pick<DMNoteAPI['settings'], 'get' | 'onChanged'>;
  editor: Pick<DMNoteAPI['editor'], 'get' | 'onCommitted'>;
  keys: Pick<
    DMNoteAPI['keys'],
    | 'get'
    | 'getCounters'
    | 'getPositions'
    | 'onChanged'
    | 'onPositionsChanged'
    | 'onModeChanged'
    | 'onKeyState'
    | 'onKeysReset'
    | 'onRawInput'
    | 'onCounterChanged'
    | 'onCountersChanged'
  > & {
    customTabs: Pick<DMNoteAPI['keys']['customTabs'], 'list' | 'onChanged'>;
  };
  statItems: Pick<
    DMNoteAPI['statItems'],
    'getPositions' | 'onPositionsChanged'
  >;
  graphItems: Pick<
    DMNoteAPI['graphItems'],
    'getPositions' | 'onPositionsChanged'
  >;
  knobItems: Pick<
    DMNoteAPI['knobItems'],
    'getPositions' | 'onPositionsChanged'
  >;
  layerGroups: Pick<DMNoteAPI['layerGroups'], 'get' | 'onChanged'>;
  overlay: Pick<
    DMNoteAPI['overlay'],
    'get' | 'onVisibility' | 'onLock' | 'onAnchor' | 'onResized'
  >;
  css: Pick<
    DMNoteAPI['css'],
    'get' | 'getUse' | 'historyGet' | 'onUse' | 'onContent'
  > & {
    tab: Pick<DMNoteAPI['css']['tab'], 'getAll' | 'get' | 'onChanged'>;
  };
  noteTab: Pick<
    DMNoteAPI['noteTab'],
    'getAll' | 'get' | 'onChanged' | 'onChangedAll'
  >;
  sound: Pick<DMNoteAPI['sound'], 'list' | 'loadOriginal'>;
  counterAnimation: Pick<DMNoteAPI['counterAnimation'], 'list' | 'onChanged'>;
  js: Pick<DMNoteAPI['js'], 'get' | 'getUse' | 'onUse' | 'onState'>;
  presets: Pick<DMNoteAPI['presets'], 'onSnapshot'>;
  bridge: Pick<DMNoteAPI['bridge'], 'on' | 'once' | 'onAny' | 'off'>;
  i18n: DMNoteAPI['i18n'];
  stats: Pick<DMNoteAPI['stats'], 'get' | 'subscribe'>;
  ui: DMNoteAPI['ui'];
}

export const createHostGlobalApi = (api: DMNoteAPI): HostGlobalApi => ({
  app: {
    bootstrap: api.app.bootstrap,
  },
  window: {
    type: api.window.type,
  },
  settings: {
    get: api.settings.get,
    onChanged: api.settings.onChanged,
  },
  editor: {
    get: api.editor.get,
    onCommitted: api.editor.onCommitted,
  },
  keys: {
    get: api.keys.get,
    getCounters: api.keys.getCounters,
    getPositions: api.keys.getPositions,
    onChanged: api.keys.onChanged,
    onPositionsChanged: api.keys.onPositionsChanged,
    onModeChanged: api.keys.onModeChanged,
    onKeyState: api.keys.onKeyState,
    onKeysReset: api.keys.onKeysReset,
    onRawInput: api.keys.onRawInput,
    onCounterChanged: api.keys.onCounterChanged,
    onCountersChanged: api.keys.onCountersChanged,
    customTabs: {
      list: api.keys.customTabs.list,
      onChanged: api.keys.customTabs.onChanged,
    },
  },
  statItems: {
    getPositions: api.statItems.getPositions,
    onPositionsChanged: api.statItems.onPositionsChanged,
  },
  graphItems: {
    getPositions: api.graphItems.getPositions,
    onPositionsChanged: api.graphItems.onPositionsChanged,
  },
  knobItems: {
    getPositions: api.knobItems.getPositions,
    onPositionsChanged: api.knobItems.onPositionsChanged,
  },
  layerGroups: {
    get: api.layerGroups.get,
    onChanged: api.layerGroups.onChanged,
  },
  overlay: {
    get: api.overlay.get,
    onVisibility: api.overlay.onVisibility,
    onLock: api.overlay.onLock,
    onAnchor: api.overlay.onAnchor,
    onResized: api.overlay.onResized,
  },
  css: {
    get: api.css.get,
    getUse: api.css.getUse,
    historyGet: api.css.historyGet,
    onUse: api.css.onUse,
    onContent: api.css.onContent,
    tab: {
      getAll: api.css.tab.getAll,
      get: api.css.tab.get,
      onChanged: api.css.tab.onChanged,
    },
  },
  noteTab: {
    getAll: api.noteTab.getAll,
    get: api.noteTab.get,
    onChanged: api.noteTab.onChanged,
    onChangedAll: api.noteTab.onChangedAll,
  },
  sound: {
    list: api.sound.list,
    loadOriginal: api.sound.loadOriginal,
  },
  counterAnimation: {
    list: api.counterAnimation.list,
    onChanged: api.counterAnimation.onChanged,
  },
  js: {
    get: api.js.get,
    getUse: api.js.getUse,
    onUse: api.js.onUse,
    onState: api.js.onState,
  },
  presets: {
    onSnapshot: api.presets.onSnapshot,
  },
  bridge: {
    on: api.bridge.on,
    once: api.bridge.once,
    onAny: api.bridge.onAny,
    off: api.bridge.off,
  },
  i18n: {
    getLocale: api.i18n.getLocale,
    onLocaleChange: api.i18n.onLocaleChange,
  },
  stats: {
    get: api.stats.get,
    subscribe: api.stats.subscribe,
  },
  ui: api.ui,
});
