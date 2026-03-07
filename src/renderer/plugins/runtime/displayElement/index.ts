/**
 * 디스플레이 요소 모듈
 */

export {
  displayElementApi,
  removeDisplayElementInternal,
} from './displayElementApi';
export {
  displayElementInstanceRegistry,
  registerDisplayElementInstance,
  unregisterDisplayElementInstance,
  clearInstancesByPlugin,
  clearAllInstances,
  getDisplayElementInstance,
} from './instanceRegistry';
export {
  saveToHistory,
  setUndoRedoInProgress,
  setInitialLoading,
  getUndoRedoInProgress,
  getUndoRedoChangedAt,
  getInitialLoading,
} from './historyUtils';
export {
  resolveFullId,
  resolveInstance,
  createNoopDisplayElementInstance,
  type DisplayElementTarget,
} from './targetResolver';
export {
  buildDisplayElementTemplate,
  displayElementTemplateHelpers,
} from './templateBuilder';
