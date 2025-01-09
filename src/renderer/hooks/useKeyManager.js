import { useState, useEffect } from 'react';
import { useDebounce } from '@hooks/useDebounce';

export function useKeyManager() {
  const [selectedKey, setSelectedKey] = useState(null);
  const [keyMappings, setKeyMappings] = useState([]);
  const [positions, setPositions] = useState({});
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    if (!ipcRenderer) return;
    
    const handleKeyMappings = (e, keys) => setKeyMappings(keys);
    const handleKeyPositions = (e, pos) => setPositions(pos);

    ipcRenderer.send('getKeyMappings');
    ipcRenderer.send('getKeyPositions');

    ipcRenderer.on('updateKeyMappings', handleKeyMappings);
    ipcRenderer.on('updateKeyPositions', handleKeyPositions);

    return () => {
      ipcRenderer.removeAllListeners('updateKeyMappings');
      ipcRenderer.removeAllListeners('updateKeyPositions');
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

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send('reset-keys');
    } else {
      console.error('ipcRenderer not available');
    }
  };

  const handleKeyUpdate = (newKey) => {
    const updatedKeys = [...keyMappings];
    updatedKeys[selectedKey.index] = newKey;
    setKeyMappings(updatedKeys);
    ipcRenderer.send('update-key-mapping', updatedKeys);
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