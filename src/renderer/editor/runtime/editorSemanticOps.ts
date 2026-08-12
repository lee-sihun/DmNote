import { enqueueEditorCompatibilityOperation } from './editorCompatibilityQueue';
import { editorCoordinator } from './editorStateCoordinator';

import type { EditorOpV1 } from '@src/types/editor';
import type {
  EditorSemanticCommitMeta,
  EditorSemanticCommitOutcome,
} from './editorCoordinator';

export const commitSemanticOps = (
  ops: readonly EditorOpV1[],
  meta?: EditorSemanticCommitMeta,
): Promise<EditorSemanticCommitOutcome> => {
  let enrolled = false;
  const run = enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitSemanticOpsInternal(ops, {
      ...meta,
      onEnrolled: () => {
        enrolled = true;
        meta?.onEnrolled?.();
      },
    }),
  );
  if (!meta?.gestureId) return run;
  return run.catch((error) => {
    if (!enrolled) {
      editorCoordinator.discardSemanticGesture(meta.gestureId!);
    }
    throw error;
  });
};
