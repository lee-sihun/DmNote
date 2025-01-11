import { useState, useEffect } from 'react';

export function useKeyManager() {
  const [selectedKey, setSelectedKey] = useState(null);
  const [keyMappings, setKeyMappings] = useState([]);
  const [positions, setPositions] = useState({});
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;

    const handleKeyMappings = (e, keys) => setKeyMappings(keys);
    const handleKeyPositions = (e, pos) => setPositions(pos);
    const handleReset = (e, data) => {
      setKeyMappings(data.keys);
      setPositions(data.positions);
    };

    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');

    ipcRenderer.on('updateKeyMappings', handleKeyMappings);
    ipcRenderer.on('updateKeyPositions', handleKeyPositions);
    ipcRenderer.on('resetComplete', handleReset); 

    return () => {
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
      ipcRenderer.removeAllListeners('resetComplete');
    };
  }, []);

  const handlePositionChange = (index, dx, dy) => {
    setPositions(prevPositions => {
      const newPositions = {
        ...prevPositions,
        "4key": prevPositions["4key"].map((pos, i) => {
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

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send('reset-keys');
    } else {
      console.error('ipcRenderer not available');
    }
  };

  const handleKeyUpdate = ({ key, activeImage, inactiveImage }) => {
    const updatedKeys = [...keyMappings];
    const updatedPositions = { ...positions };
    
    updatedKeys[selectedKey.index] = key;
    updatedPositions["4key"][selectedKey.index] = {
      ...updatedPositions["4key"][selectedKey.index],
      activeImage,
      inactiveImage
    };
  
    setKeyMappings(updatedKeys);
    setPositions(updatedPositions);
    
    ipcRenderer.send('update-key-mapping', updatedKeys);
    ipcRenderer.send('update-key-positions', updatedPositions);
    
    setSelectedKey(null);
  };

  return {
    selectedKey,
    keyMappings,
    positions,
    setSelectedKey,
    handlePositionChange,
    handleReset,
    handleKeyUpdate,
  };
}