import React, { useState, useEffect } from "react";
import { useDraggable } from "@hooks/useDraggable";
import Palette from "./Palette";
import { ReactComponent as ResetIcon } from "@assets/svgs/reset.svg";
import { ReactComponent as PaletteIcon } from "@assets/svgs/palette.svg";
import { getKeyInfo, getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function Canvas() {
  return (
    <div className="flex flex-col w-full h-full p-[18px]">
      <Grid />
    </div>
  )
}

function Grid() {
  const [palette, setPalette] = useState(false);
  const [color, setColor] = useState("transparent");
  const [keyMappings, setKeyMappings] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);

  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;
    
    ipcRenderer.send('getKeyMappings');
    ipcRenderer.on('updateKeyMappings', (e, keys) => {
      setKeyMappings(keys);
    });

    return () => {
      ipcRenderer.removeAllListeners('updateKeyMappings');
    };
  }, []);

  const initialPositions = [
    { dx: 280, dy: 130, width: 60 },
    { dx: 360, dy: 130, width: 60 },
    { dx: 440, dy: 130, width: 60 },
    { dx: 520, dy: 130, width: 60 },
    { dx: 140, dy: 130, width: 120 },
    { dx: 600, dy: 130, width: 120 },
  ];

  const keys = initialPositions.map(({ dx, dy, width }, index) => {
    const mappedKey = keyMappings[index];
    const draggable = useDraggable({ 
      gridSize: 10, 
      initialX: dx, 
      initialY: dy,
    });
    return { 
      draggableRef: draggable.ref,
      dx: draggable.dx,
      dy: draggable.dy,
      width,
      key: mappedKey,
      index
    };
  });

  const handlePaletteClose = () => {
    if (palette) setPalette(false);
  }

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send('reset-keys');
      console.log('Sent reset-keys to main process'); // 디버깅용
    } else {
      console.error('ipcRenderer not available');
    }
  };

  // cleanup
  useEffect(() => {
    setPalette(false); 
    return () => {
      setPalette(false);
    };
  }, []); 

  return (
    <div 
      className="grid-bg relative w-full h-[320px] bg-[#393A3F] rounded-[6px]"
      style={{ backgroundColor: color === "transparent" ? "#393A3F" : color }}
      onClick={handlePaletteClose}
    >
      {keys.map(({ draggableRef, dx, dy, width, key, index }) => (
        <Key 
          key={index}
          draggableRef={draggableRef}
          dx={dx}
          dy={dy}
          width={width}
          keyName={getKeyInfoByGlobalKey(key).displayName}
          onClick={() => setSelectedKey({ index, key })}
        />
      ))}
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
      {palette && <Palette color={color} onColorChange={setColor} />}
      {selectedKey && (
        <KeySettingModal 
          keyData={selectedKey}
          onClose={() => setSelectedKey(null)}
          onSave={(newKey) => {
            const updatedKeys = [...keyMappings];
            updatedKeys[selectedKey.index] = newKey;
            setKeyMappings(updatedKeys);
            ipcRenderer.send('update-key-mapping', updatedKeys);
            setSelectedKey(null);
          }}
        />
      )}
    </div>
  );
}


function Key({ draggableRef, dx, dy, width, keyName, onClick }) {
  return (
    <div
      ref={draggableRef}
      className="absolute bg-white rounded-[6px] h-[60px] cursor-pointer"
      style={{
        transform: `translate(${dx}px, ${dy}px)`,
        width: `${width}px`,
      }}
      onClick={onClick}
    >
      <div className="flex items-center justify-center h-full">{keyName}</div>
    </div>
  );
}

function KeySettingModal({ keyData, onClose, onSave }) {
  const [key, setKey] = useState(keyData.key);
  const [displayKey, setDisplayKey] = useState(getKeyInfoByGlobalKey(key).displayName);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (isListening) {
        e.preventDefault();
        setKey(getKeyInfo(e.code, e.key).globalKey);
        setDisplayKey(getKeyInfo(e.code, e.key).displayName);
        setIsListening(false);
      }
    }

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isListening]);

  const handleSubmit = () => {
    onSave(key);
  };

  return (
    <div className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px]">
      <div className="flex flex-col items-center justify-center p-[25px] bg-[#1C1E25] border border-[#3B4049] rounded-[6px]">
        <button 
          onClick={() => setIsListening(true)}
          className="flex items-center h-[25px] px-[9px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
        >
          {isListening ? "Press any key..." : displayKey || "Click to set key"}
        </button>
        <div className="flex mt-2">
          <button 
            onClick={handleSubmit}
            className="px-4 py-2 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
          >
            저장
          </button>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}