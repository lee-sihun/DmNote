import { appApi, windowApi } from './modules/appApi';
import { settingsApi } from './modules/settingsApi';
import { keysApi } from './modules/keysApi';
import {
  statItemsApi,
  graphItemsApi,
  knobItemsApi,
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
import { editorApi } from './modules/editorApi';

import './modules/shared';

import type { DMNoteAPI } from '@src/types/plugin/api';
import type { HostInternalApi } from './hostGlobalApi';

export const internalApi = {
  app: appApi,
  window: windowApi,
  settings: settingsApi,
  keys: keysApi,
  statItems: statItemsApi,
  graphItems: graphItemsApi,
  knobItems: knobItemsApi,
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
  editor: editorApi,
} satisfies HostInternalApi;
