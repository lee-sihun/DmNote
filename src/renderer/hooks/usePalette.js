import { useState, useEffect } from 'react';

export function usePalette() {
  const [palette, setPalette] = useState(false);
  const [color, setColor] = useState("transparent");
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;

    const handleColor = (e, color) => setColor(color);

    ipcRenderer.send('getBackgroundColor');
    ipcRenderer.on('updateBackgroundColor', handleColor);

    return () => {
      ipcRenderer.removeAllListeners('updateBackgroundColor');
    };
  }, []);

  const handleColorChange = (newColor) => {
    setColor(newColor);
    ipcRenderer.send('update-background-color', newColor);
  };

  const handlePaletteClose = () => {
    if (palette) setPalette(false);
  }

  const handleResetColor = () => {
    setColor("transparent");
  }

  return {
    color,
    palette,
    setPalette,
    handleColorChange,
    handlePaletteClose,
    handleResetColor
  };
}