import { Key } from "@components/Key";
import React, { useState, useEffect } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState('4key');
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const [keyStates, setKeyStates] = useState({});
  const [backgroundColor, setBackgroundColor] = useState('');
  const showKeyCount = useSettingsStore(state => state.showKeyCount);
  const { setShowKeyCount } = useSettingsStore();

  useEffect(() => {
    // 초기 데이터 요청
    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');
    ipcRenderer.send('getCurrentMode');
    ipcRenderer.send('getBackgroundColor');
    ipcRenderer.send('get-show-key-count');

    const keyStateListener = (e, { key, state }) => {
      if (state === 'DOWN') {
        setKeyStates(prev => ({ ...prev, [key]: true }));
        setPositions(prev => {
          const newPositions = { ...prev };
          const currentMode = keyMode;
          const keyIndex = keyMappings[currentMode]?.indexOf(key);
          
          if (keyIndex !== -1 && newPositions[currentMode]) {
            newPositions[currentMode][keyIndex] = {
              ...newPositions[currentMode][keyIndex],
              count: (newPositions[currentMode][keyIndex].count || 0) + 1
            };
            ipcRenderer.send('update-key-positions', newPositions);
          }
          return newPositions;
        });
      } else {
        setKeyStates(prev => ({ ...prev, [key]: false }));
      }
    };

    const keyModeListener = (e, mode) => {
      setKeyMode(mode);
    };

    const keyMappingsListener = (e, mappings) => {
      setKeyMappings(mappings);
    };

    const positionsListener = (e, newPositions) => {
      setPositions(newPositions);
    };

    const backgroundColorListener = (e, color) => {
      setBackgroundColor(color);
    };

    const showKeyCountListener = (_, value) => {
      setShowKeyCount(value);
    };

    // 이벤트 리스너 등록
    ipcRenderer.on('keyState', keyStateListener);
    ipcRenderer.on('keyModeChanged', keyModeListener);
    ipcRenderer.on('updateKeyMappings', keyMappingsListener);
    ipcRenderer.on('updateKeyPositions', positionsListener);
    ipcRenderer.on('updateBackgroundColor', backgroundColorListener);
    ipcRenderer.on('update-show-key-count', showKeyCountListener);

    return () => {
      ipcRenderer.removeAllListeners('keyState');
      ipcRenderer.removeAllListeners('keyModeChanged');
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
      ipcRenderer.removeAllListeners('updateBackgroundColor');
      ipcRenderer.removeAllListeners('update-show-key-count');
    };
  }, [keyMode, keyMappings]);

  return (
    <div 
      className="relative w-full h-screen m-0 overflow-hidden"
      style={{ backgroundColor: backgroundColor === "transparent" ? "transparent" : backgroundColor }}
    >
      {keyMappings[keyMode]?.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const position = positions[keyMode]?.[index] || { dx: 0, dy: 0, width: 60 };
        
        return (
          <React.Fragment key={index}>
            {showKeyCount && (
              <div
                className="font-extrabold text-[16px] text-center bg-clip-text text-transparent bg-gradient-to-b from-[#FFFFFF] to-[#757575] [text-shadow:_0_0_0.2px_rgba(255,255,255,0.5)]"
                style={{
                  position: 'absolute',
                  top: position.dy - 22,
                  left: position.dx,
                  width: position.width,
                }}
              >
                {position.count || 0}
              </div>
            )}
            <Key 
              keyName={displayName}
              active={keyStates[key]}
              position={position}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}