type EditorDraftFinalizer = () => void;

const activeEditorDrafts = new Map<symbol, EditorDraftFinalizer>();

export const registerEditorDraftForLifecycle = (
  finalize: EditorDraftFinalizer,
): (() => void) => {
  const token = Symbol('editor-draft');
  activeEditorDrafts.set(token, finalize);
  return () => {
    activeEditorDrafts.delete(token);
  };
};

export const finalizeEditorDraftForLifecycle = (): boolean => {
  const drafts = [...activeEditorDrafts.values()];
  activeEditorDrafts.clear();
  let succeeded = true;

  for (const finalize of drafts) {
    try {
      finalize();
    } catch (error) {
      succeeded = false;
      console.error('Failed to finalize a focused editor draft', error);
    }
  }
  return succeeded;
};
