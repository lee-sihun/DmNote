/**
 * 플러그인 런타임 모듈
 *
 * 이 모듈은 DmNote의 JS 플러그인 시스템을 구성하는 모든 하위 모듈들을 re-export합니다.
 *
 * 주요 모듈:
 * - handlers: 이벤트 핸들러 레지스트리
 * - displayElement: 디스플레이 요소 관리 (인스턴스, 히스토리, API)
 * - context: 플러그인 컨텍스트 (스토리지 래퍼, 함수 래퍼)
 * - api: 플러그인 API (defineElement, defineSettings, 프록시)
 */

// 메인 런타임
export { createCustomJsRuntime, type CustomJsRuntime } from './customJsRuntime';

// 핸들러
export { handlerRegistry, type HandlerFunction } from './handlers';

// 디스플레이 요소
export {
  displayElementApi,
  displayElementInstanceRegistry,
  setUndoRedoInProgress,
  setInitialLoading,
  saveToHistory,
  resolveFullId,
  resolveInstance,
  type DisplayElementTarget,
} from './displayElement';

// 컨텍스트
export {
  createNamespacedStorage,
  wrapFunctionWithContext,
  wrapApiValue,
  type NamespacedStorage,
} from './context';

// API
export {
  createDefineElement,
  createDefineSettings,
  createPluginApiProxy,
  createPluginWindowProxy,
} from './api';
