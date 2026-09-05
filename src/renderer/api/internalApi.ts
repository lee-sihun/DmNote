import { appApi, windowApi } from './modules/app/appApi';
import { settingsApi } from './modules/app/settingsApi';
import { keysApi } from './modules/editor/keysApi';
import {
  statItemsApi,
  graphItemsApi,
  knobItemsApi,
  layerGroupsApi,
} from './modules/editor/itemsApi';
import { overlayApi } from './modules/window/overlayApi';
import { cssApi } from './modules/resources/cssApi';
import { noteTabApi } from './modules/editor/noteTabApi';
import {
  fontApi,
  imageApi,
  soundApi,
  counterAnimationApi,
} from './modules/resources/resourceApi';
import { jsApi } from './modules/plugin/jsApi';
import { presetsApi } from './modules/resources/presetsApi';
import { bridgeApi } from './modules/plugin/bridgeApi';
import { i18nApi } from './modules/app/i18nApi';
import { statsApi } from './modules/app/statsApi';
import { pluginApi } from './modules/plugin/pluginApi';
import { uiApi } from './modules/window/uiApi';
import { editorApi } from './modules/editor/editorApi';

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
