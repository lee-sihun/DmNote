/**
 * 플러그인 컨텍스트 모듈
 */

export {
  createNamespacedStorage,
  type NamespacedStorage,
} from './storageWrapper';
export { wrapFunctionWithContext, wrapApiValue } from './functionWrapper';
