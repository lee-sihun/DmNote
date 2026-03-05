import { useState, useEffect } from 'react';
import { useSettingsStore } from '@stores/useSettingsStore';

export function usePalette() {
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
    setColor(newColor);
    setBackgroundColor(newColor);
    window.api.settings.update({ backgroundColor: newColor }).catch((error) => {
      console.error('Failed to update background color', error);
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
