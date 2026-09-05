import { useEffect } from 'react';

import { isMac } from '@utils/core/platform';
import { usePanelChildWindow } from '@hooks/panel/usePanelChildWindow';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';
import { isModalLayerActive } from '@components/main/Modal/popupLayer';

interface UseHistoryShortcutsParams {
  onUndo?: () => void;
  onRedo?: () => void;
}

export const useHistoryShortcuts = ({
  onUndo,
  onRedo,
}: UseHistoryShortcutsParams): void => {
  const macOS = isMac();
  // 분리 패널 창의 키 입력은 그 창의 window로만 온다 - 같은 핸들러를 함께 건다
  const childWindow = usePanelChildWindow();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (isModalLayerActive()) return;
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

    const targets = childWindow ? [window, childWindow] : [window];
    targets.forEach((target) =>
      target.addEventListener('keydown', handleKeyDown),
    );
    return () =>
      targets.forEach((target) =>
        target.removeEventListener('keydown', handleKeyDown),
      );
  }, [macOS, onUndo, onRedo, childWindow]);
};
