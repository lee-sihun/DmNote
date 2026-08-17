/**
 * 플러그인 디스플레이 요소 API
 *
 * 이 파일은 모듈화된 구조에서 re-export를 담당합니다.
 * 실제 구현은 @plugins/runtime/displayElement 모듈에 있습니다.
 */

// 디스플레이 요소 API
export {
  displayElementApi,
  setUndoRedoInProgress,
  getUndoRedoInProgress,
} from '@plugins/runtime/displayElement';
