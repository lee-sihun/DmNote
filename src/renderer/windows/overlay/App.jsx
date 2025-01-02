import Key from "@components/Key";
import React, { useState, useEffect } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMappings, setKeyMappings] = useState([]);
  const [keyStates, setKeyStates] = useState({});

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
    <div className="flex items-center justify-center h-screen m-0 bg-transparent">
      {keyMappings.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        return (
          <Key 
            key={index}
            keyName={displayName}
            active={keyStates[key]}
          />
        );
      })}
    </div>
  );
}