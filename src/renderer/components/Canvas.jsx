import React, { useState, useEffect } from "react";
import { useDraggable } from "@hooks/useDraggable";
import { useDebounce } from "@hooks/useDebounce";
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
  const [positions, setPositions] = useState({});
  const [selectedKey, setSelectedKey] = useState(null);

  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;
    
    const handleKeyMappings = (e, keys) => {
      setKeyMappings(keys);
    };

    const handleKeyPositions = (e, pos) => {
      setPositions(pos);
    };

    const handleColor = (e, color) => {
      setColor(color);
    };

    // 초기 데이터 요청
    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');
    ipcRenderer.send('getBackgroundColor');

    // 이벤트 리스너 등록
    ipcRenderer.on('updateKeyMappings', handleKeyMappings);
    ipcRenderer.on('updateKeyPositions', handleKeyPositions);
    ipcRenderer.on('updateBackgroundColor', handleColor);

    return () => {
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
      ipcRenderer.removeAllListeners('updateBackgroundColor');
    };
  }, []);

  const debouncedPositionUpdate = useDebounce((newPositions) => {
    ipcRenderer.invoke('update-key-positions', newPositions)
      .then(() => {
        console.log('Position saved successfully');
      })
      .catch((error) => {
        console.error('Failed to save position:', error);
        // 저장 실패시 이전 positions로 롤백
        setPositions(positions);
      });
  }, 100);

  const handlePositionChange = (index, dx, dy) => {
    const newPositions = {
      ...positions,
      "4key": positions["4key"].map((pos, i) => {
        if (i === index) {
          return { ...pos, dx, dy };
        }
        return pos;
      })
    };
    setPositions(newPositions);
    debouncedPositionUpdate(newPositions);
  };

  const handleColorChange = (newColor) => {
    setColor(newColor);
    ipcRenderer.send('update-background-color', newColor);
  }

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

  const handlePaletteClose = () => {
    if (palette) setPalette(false);
  }

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send('reset-keys');
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

export const DraggableKey = ({ index, position, keyName, onPositionChange, onClick }) => {
  const { dx, dy, width } = position;
  const draggable = useDraggable({
    gridSize: 10,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx, newDy) => onPositionChange(index, newDx, newDy)
  });

  return (
    <div
      ref={draggable.ref}
      className="absolute bg-white rounded-[6px] h-[60px] cursor-pointer"
      style={{
        width: `${width}px`,
        transform: `translate(${draggable.dx}px, ${draggable.dy}px)`
      }}
      onClick={onClick}
    >
      <div className="flex items-center justify-center h-full">{keyName}</div>
    </div>
  );
};

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