import { Key } from "@components/Key";
import React, { useState, useEffect } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMappings, setKeyMappings] = useState([]);
  const [keyStates, setKeyStates] = useState({});
  const [positions, setPositions] = useState({});
  const [backgroundColor, setBackgroundColor] = useState('');

  // 키매핑 업데이트
  useEffect(() => { 
    const updateKeyMappings = (e, keys) => {
      setKeyMappings(keys);
      setKeyStates(keys.reduce((acc, key) => ({ ...acc, [key]: false }), {}));
    };

    ipcRenderer.on('updateKeyMappings', updateKeyMappings);
    ipcRenderer.send('getKeyMappings');

    return () => {
      ipcRenderer.removeListener('updateKeyMappings', updateKeyMappings);
    }
  }, []);

  // 키 위치 업데이트
  useEffect(() => {
    const updateKeyPositions = (e, pos) => {
      setPositions(pos);
    };

    ipcRenderer.on('updateKeyPositions', updateKeyPositions);
    ipcRenderer.send('getKeyPositions');

    return () => {
      ipcRenderer.removeListener('updateKeyPositions', updateKeyPositions);
    }
  }, []);

  // 배경색 업데이트
  useEffect(() => {
    const updateBackgroundColor = (e, color) => {
      setBackgroundColor(color);
    };

    ipcRenderer.on('updateBackgroundColor', updateBackgroundColor);
    ipcRenderer.send('getBackgroundColor');

    return () => {
      ipcRenderer.removeListener('updateBackgroundColor', updateBackgroundColor);
    }
  }, []);


  // 키 상태 업데이트
  useEffect(() => {
    const listener = (event, { key, state }) => {
      setKeyStates(prev => ({
        ...prev,
        [key]: state === 'DOWN'
      }));
    };
    ipcRenderer.on('keyState', listener);

    return () => {
      ipcRenderer.removeListener('keyState', listener);
    };
  }, []);

  return (
    <div 
      className="relative w-full h-screen m-0 overflow-hidden [app-region:drag]"
      style={{ backgroundColor: backgroundColor === "transparent" ? "transparent" : backgroundColor }}
    >
      {keyMappings.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const position = positions["4key"]?.[index] || { dx: 0, dy: 0, width: 60 };
        
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