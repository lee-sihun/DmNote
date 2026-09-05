import { enqueueEditorCompatibilityOperation } from '../lifecycle/editorCompatibilityQueue';
import { editorCoordinator } from '../coordinator/editorStateCoordinator';

import type { EditorOpV1 } from '@src/types/editor';
import type {
  EditorSemanticCommitMeta,
  EditorSemanticCommitOutcome,
  EditorSemanticOpsGenerator,
} from '../coordinator/editorCoordinator';

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

export const commitGeneratedSemanticOps = (
  generate: EditorSemanticOpsGenerator,
  meta?: EditorSemanticCommitMeta,
): Promise<EditorSemanticCommitOutcome | null> => {
  let enrolled = false;
  const run = enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.commitGeneratedSemanticOpsInternal(generate, {
      ...meta,
      onEnrolled: () => {
        enrolled = true;
        meta?.onEnrolled?.();
      },
    }),
  );
  if (!meta?.gestureId) return run;
  return run
    .then((result) => {
      if (!result && !enrolled) {
        editorCoordinator.discardSemanticGesture(meta.gestureId!);
      }
      return result;
    })
    .catch((error) => {
      if (!enrolled) {
        editorCoordinator.discardSemanticGesture(meta.gestureId!);
      }
      throw error;
    });
};
