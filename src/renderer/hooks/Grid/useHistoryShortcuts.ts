import { useEffect } from 'react';

import { isMac } from '@utils/core/platform';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';

interface UseHistoryShortcutsParams {
  onUndo?: () => void;
  onRedo?: () => void;
}

export const useHistoryShortcuts = ({
  onUndo,
  onRedo,
}: UseHistoryShortcutsParams): void => {
  const macOS = isMac();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (typeof window !== 'undefined' && window.__dmn_isKeyListening) {
        return;
      }

      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isPrimaryModifierPressed = macOS ? event.metaKey : event.ctrlKey;
      if (
        isPrimaryModifierPressed &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        onUndo?.();
        return;
      }

      if (
        isPrimaryModifierPressed &&
        event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        onRedo?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [macOS, onUndo, onRedo]);
};
