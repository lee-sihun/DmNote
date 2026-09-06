import { EditorProtocolError } from '@src/types/editor';
import type {
  CanonicalEditorDocumentV1,
  EditorField,
  EditorOpV1,
  EditorOpResultV1,
  EditorCommitResult,
} from '@src/types/editor';
import { applySemanticOps } from '../projection/semanticOpsProjection';
import {
  getChangedEditorFields,
  unresolvedLocalFields,
  fieldsOverlap,
  rebaseEditorDocument,
} from './editorRebaseModel';

export const planEditorRebase = (
  canonical: CanonicalEditorDocumentV1,
  pending: CanonicalEditorDocumentV1,
  localFields: readonly EditorField[],
  remoteFields: readonly EditorField[],
) => {
  const remainingLocalFields = unresolvedLocalFields(
    localFields,
    pending,
    canonical,
  );
  return {
    remainingLocalFields,
    overlappingFields: fieldsOverlap(remainingLocalFields, remoteFields),
    rebased: rebaseEditorDocument(canonical, pending, remainingLocalFields),
  };
};

export const assertSemanticChangedFields = (
  base: CanonicalEditorDocumentV1,
  ops: readonly EditorOpV1[],
  opResults: readonly EditorOpResultV1[],
  result: EditorCommitResult,
): void => {
  const expected = getChangedEditorFields(
    base,
    applySemanticOps(base, ops, opResults),
  );
  if (
    expected.length !== result.changedFields.length ||
    expected.some((field) => !result.changedFields.includes(field))
  ) {
    throw new EditorProtocolError(
      'editor ops changedFields does not match canonical projection',
    );
  }
};
