export {
  pushCurrentStateToHistory,
  restorePluginElements,
  applyRestoredStateToStores,
  applyRestoredPluginElements,
  persistRestoredState,
} from './editorSnapshot';

export {
  persistPositionsWithSync,
  persistMappingsAndPositions,
  persistPositions,
  persistPositionsWithFlag,
} from './persistState';

export {
  EditorSaveCoordinator,
  applyEditorPatch,
  createEditorCoordinator,
  createEditorPatch,
  getChangedEditorFields,
  rebaseEditorDocument,
} from './editorCoordinator';

export type {
  EditorApplyReason,
  EditorConflictResolution,
  EditorConflictState,
  EditorCoordinatorOptions,
  EditorCoordinatorPhase,
  EditorCoordinatorState,
  EditorCoordinatorTransport,
} from './editorCoordinator';

export {
  applyEditorDocument,
  captureEditorDocument,
  editorCoordinator,
} from './editorStateCoordinator';
