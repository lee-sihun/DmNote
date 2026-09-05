import { useEffect, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { useHistoryStatusStore } from '@stores/data/useHistoryStatusStore';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import type { EditorCoordinatorState } from '@src/renderer/editor/runtime/editorCoordinator';

const EditorSaveNotice = () => {
  const { t } = useTranslation();
  const [needsSave, setNeedsSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const historyBusy = useHistoryStatusStore((state) => state.busy);

  useEffect(() => {
    const update = (state: EditorCoordinatorState) => {
      if (!state.dirty) setNeedsSave(false);
      else if (state.failureKind === 'transient') setNeedsSave(true);
      setSaving(state.phase === 'saving');
    };
    const unsubscribe = editorCoordinator.subscribe(update);
    update(editorCoordinator.getState());
    return unsubscribe;
  }, []);

  const { run: retry, pending } = useSingleFlightAction(async () => {
    try {
      if (!(await flushFocusedEditor())) return;
      await editorCoordinator.flush();
    } catch (error) {
      console.error('편집 내용 다시 저장 실패', error);
    }
  });

  if (!needsSave) return null;
  const busy = pending || saving || historyBusy;

  return (
    <div
      role="status"
      className="fixed bottom-[72px] left-1/2 z-[var(--z-chrome-popup)] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-body text-fg shadow-lg"
    >
      <span>{t('editorSave.pendingFailure')}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void retry()}
        className="shrink-0 rounded px-2 py-1 text-accent disabled:opacity-50"
      >
        {t(busy ? 'editorSave.retrying' : 'editorSave.retrySave')}
      </button>
    </div>
  );
};

export default EditorSaveNotice;
