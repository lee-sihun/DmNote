import React, { useEffect } from 'react';
import { useKeyManager } from '@hooks/useKeyManager';
import { usePalette } from '@hooks/usePalette';
import DraggableKey from './Key.jsx';
import Palette from './Palette';
import KeySettingModal from './KeySettingModal';
import { ReactComponent as ResetIcon } from "@assets/svgs/reset.svg";
import { ReactComponent as PaletteIcon } from "@assets/svgs/palette.svg";

export default function Grid() {
  const { selectedKey, setSelectedKey, keyMappings, positions, handlePositionChange, handleReset, handleKeyUpdate } = useKeyManager();
  const { color, palette, setPalette, handleColorChange, handlePaletteClose } = usePalette();
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    const handleReset = (e, data) => {
      if (data.color) {
        handleColorChange(data.color);
      }
    };

    ipcRenderer.on('resetComplete', handleReset);

    return () => {
      ipcRenderer.removeAllListeners('resetComplete');
    };
  }, []);

  // cleanup
  useEffect(() => {
    setPalette(false); 
    return () => {
      setPalette(false);
    };
  }, []); 

  const renderKeys = () => {
    if (!positions["4key"]) return null;

    return positions["4key"].map((position, index) => (
      <DraggableKey
        key={index}
        index={index}
        position={position}
        keyName={keyMappings[index] || ''}
        onPositionChange={handlePositionChange}
        onClick={() => setSelectedKey({ key: keyMappings[index], index })}
      />
    ));
  }

  return (
    <div 
      className="grid-bg relative w-full h-[320px] bg-[#393A3F] rounded-[6px]"
      style={{ backgroundColor: color === "transparent" ? "#393A3F" : color }}
      onClick={handlePaletteClose}
    >
      {renderKeys()}
      <button 
        className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[57px] left-[18px]"
        onClick={() => setPalette(!palette)}
      >
        <PaletteIcon /> 
      </button>
      <button 
        className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[18px] left-[18px]"
        onClick={handleReset}
      >
        <ResetIcon /> 
      </button>
      {palette && <Palette color={color} onColorChange={handleColorChange} />}
      {selectedKey && (
        <KeySettingModal 
          keyData={selectedKey}
          onClose={() => setSelectedKey(null)}
          onSave={handleKeyUpdate}
        />
      )}
    </div>
  );
}