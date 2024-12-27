import Key from "@components/Key";
import React, { useState, useEffect } from "react";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyStates, setKeyStates] = useState({
    'Z': false,
    'X': false,
    'DOT': false,
    'FORWARD SLASH': false
  });

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
      <Key keyName="Z" active={keyStates['Z']} />
      <Key keyName="X" active={keyStates['X']} />
      <Key keyName="." active={keyStates['DOT']} />
      <Key keyName="/" active={keyStates['FORWARD SLASH']} />
    </div>
  );
}