import { Key } from "@components/Key";
import React, { useState, useEffect } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState('4key');
  const [keyMappings, setKeyMappings] = useState([]);
  const [keyStates, setKeyStates] = useState({});
  const [positions, setPositions] = useState({});
  const [backgroundColor, setBackgroundColor] = useState('');

  useEffect(() => {
    // 초기 데이터 요청
    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');
    ipcRenderer.send('getCurrentMode');
    ipcRenderer.send('getBackgroundColor');

    // 이벤트 리스너 설정
    const keyStateListener = (e, { key, state, mode }) => {
      setKeyStates(prev => ({
        ...prev,
        [key]: state === 'DOWN'
      }));
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

    // 이벤트 리스너 등록
    ipcRenderer.on('keyState', keyStateListener);
    ipcRenderer.on('keyModeChanged', keyModeListener);
    ipcRenderer.on('updateKeyMappings', keyMappingsListener);
    ipcRenderer.on('updateKeyPositions', positionsListener);
    ipcRenderer.on('updateBackgroundColor', backgroundColorListener);

    return () => {
      ipcRenderer.removeAllListeners('keyState');
      ipcRenderer.removeAllListeners('keyModeChanged');
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
      ipcRenderer.removeAllListeners('updateBackgroundColor');
    };
  }, []);

  return (
    <div 
      className="relative w-full h-screen m-0 overflow-hidden [app-region:drag]"
      style={{ backgroundColor: backgroundColor === "transparent" ? "transparent" : backgroundColor }}
    >
      {keyMappings[keyMode]?.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const position = positions[keyMode]?.[index] || { dx: 0, dy: 0, width: 60 };
        
        return (
          <Key 
            key={index}
            keyName={displayName}
            active={keyStates[key]}
            position={position}
          />
        );
      })}
    </div>
  );
}