import { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '@stores/useSettingsStore';
import { settingsApi } from '@api/modules/settingsApi';
import { useTranslation } from '@contexts/useTranslation';

export function usePalette() {
  const { t } = useTranslation();
  const writeSequence = useRef(0);
  const [palette, setPalette] = useState(false);
  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const setBackgroundColor = useSettingsStore(
    (state) => state.setBackgroundColor,
  );
  const [color, setColor] = useState(backgroundColor);

  useEffect(() => {
    setColor(backgroundColor);
  }, [backgroundColor]);

  const handleColorChange = (newColor: string) => {
    const previousColor = useSettingsStore.getState().backgroundColor;
    const sequence = ++writeSequence.current;
    setColor(newColor);
    setBackgroundColor(newColor);
    settingsApi.update({ backgroundColor: newColor }).catch(async (error) => {
      console.error('Failed to update background color', error);
      if (sequence !== writeSequence.current) return;
      let restoredColor = previousColor;
      try {
        restoredColor = (await settingsApi.get()).backgroundColor;
      } catch (syncError) {
        console.error('Failed to reload background color', syncError);
      }
      if (sequence !== writeSequence.current) return;
      if (useSettingsStore.getState().backgroundColor === newColor) {
        setBackgroundColor(restoredColor);
      }
      void window.api.ui.dialog
        .alert(t('common.saveFailed'), { confirmText: t('common.ok') })
        .catch(() => {});
    });
  };

  const handlePaletteClose = () => {
    if (palette) setPalette(false);
  };

  const handleResetColor = () => {
    handleColorChange('transparent');
  };

  return {
    color,
    palette,
    setPalette,
    handleColorChange,
    handlePaletteClose,
    handleResetColor,
  };
}
