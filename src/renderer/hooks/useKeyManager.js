import { useState, useEffect } from 'react';
import { useKeyStore } from '@stores/useKeyStore';

export function useKeyManager() {
  const { selectedKeyType } = useKeyStore();
  const [selectedKey, setSelectedKey] = useState(null);
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;

    const handleKeyMappings = (e, keys) => setKeyMappings(keys);
    const handleKeyPositions = (e, pos) => setPositions(pos);
    const handleKeyModeChanged = (e, mode) => setCurrentMode(mode);
    const handleReset = (e, data) => {
      setKeyMappings(data.keys);
      setPositions(data.positions);
    };

    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');
    ipcRenderer.send('getCurrentMode');

    ipcRenderer.on('updateKeyMappings', handleKeyMappings);
    ipcRenderer.on('updateKeyPositions', handleKeyPositions);
    ipcRenderer.on('keyModeChanged', handleKeyModeChanged);
    ipcRenderer.on('resetComplete', handleReset); 

    return () => {
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
      ipcRenderer.removeAllListeners('keyModeChanged');
      ipcRenderer.removeAllListeners('resetComplete');
    };
  }, []);

  const handlePositionChange = (index, dx, dy) => {
    setPositions(prevPositions => {
      const newPositions = {
        ...prevPositions,
        [selectedKeyType]: prevPositions[selectedKeyType].map((pos, i) => {
          if (i === index) {
            return { ...pos, dx, dy };
          }
          return pos;
        })
      };
      
      ipcRenderer.send('update-key-positions', newPositions);
      return newPositions;
    });
  };

  const handleModeChange = (mode) => {
    ipcRenderer.send('setKeyMode', mode);
  };

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send('reset-keys');
    } else {
      console.error('ipcRenderer not available');
    }
  };

  const handleKeyUpdate = (keyData) => {
    const { key, activeImage, inactiveImage } = keyData;
    const updatedMappings = { ...keyMappings };
    const updatedPositions = { ...positions };
    
    if (selectedKey) {
      updatedMappings[selectedKeyType][selectedKey.index] = key;
      updatedPositions[selectedKeyType][selectedKey.index] = {
        ...updatedPositions[selectedKeyType][selectedKey.index],
        activeImage,
        inactiveImage
      };
    }
  
    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);
    
    ipcRenderer.send('update-key-mapping', updatedMappings);
    ipcRenderer.send('update-key-positions', updatedPositions);
    setSelectedKey(null);
  };

  return {
    selectedKey,
    keyMappings,
    positions,
    setSelectedKey,
    handlePositionChange,
    handleModeChange,
    handleReset,
    handleKeyUpdate,
  };
}