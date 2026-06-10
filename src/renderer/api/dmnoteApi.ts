import { appApi, windowApi } from './modules/appApi';
import { settingsApi } from './modules/settingsApi';
import { keysApi } from './modules/keysApi';
import {
  statItemsApi,
  graphItemsApi,
  dialItemsApi,
  layerGroupsApi,
} from './modules/itemsApi';
import { overlayApi } from './modules/overlayApi';
import { cssApi } from './modules/cssApi';
import { noteTabApi } from './modules/noteTabApi';
import {
  fontApi,
  imageApi,
  soundApi,
  counterAnimationApi,
} from './modules/resourceApi';
import { jsApi } from './modules/jsApi';
import { presetsApi } from './modules/presetsApi';
import { bridgeApi } from './modules/bridgeApi';
import { i18nApi } from './modules/i18nApi';
import { statsApi } from './modules/statsApi';
import { pluginApi } from './modules/pluginApi';
import { uiApi } from './modules/uiApi';

// shared.ts is imported for its side-effects (locale init + settings listener)
import './modules/shared';

import type { DMNoteAPI } from '@src/types/plugin/api';

const api: DMNoteAPI = {
  app: appApi,
  window: windowApi,
  settings: settingsApi,
  keys: keysApi,
  statItems: statItemsApi,
  graphItems: graphItemsApi,
  dialItems: dialItemsApi,
  layerGroups: layerGroupsApi,
  overlay: overlayApi,
  css: cssApi,
  noteTab: noteTabApi,
  font: fontApi,
  image: imageApi,
  sound: soundApi,
  counterAnimation: counterAnimationApi,
  js: jsApi,
  presets: presetsApi,
  bridge: bridgeApi,
  i18n: i18nApi,
  stats: statsApi,
  plugin: pluginApi,
  ui: uiApi as unknown as DMNoteAPI['ui'],
};

if (typeof window !== 'undefined') {
  window.api = api;
  // dmn 별칭 추가 (window. 없이 바로 접근 가능)
  (window as unknown as { dmn: DMNoteAPI }).dmn = api;
  (globalThis as unknown as { dmn: DMNoteAPI }).dmn = api;
}

export {
  handlerRegistry,
  displayElementInstanceRegistry,
} from './pluginDisplayElements';

export default api;
