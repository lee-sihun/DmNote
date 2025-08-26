import { useState, useEffect } from "react";
import { useKeyStore } from "@stores/useKeyStore";
import { useSettingsStore } from "@stores/useSettingsStore";

export function useKeyManager() {
  const { selectedKeyType } = useKeyStore();
  const [selectedKey, setSelectedKey] = useState(null);
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const ipcRenderer = window.electron.ipcRenderer;
  // settings store (for early CSS sync before visiting SettingTab)
  const { setUseCustomCSS, setCustomCSSContent, setCustomCSSPath } =
    useSettingsStore();

  useEffect(() => {
    if (!ipcRenderer) return;

    const handleKeyMappings = (e, keys) => setKeyMappings(keys);
    const handleKeyPositions = (e, pos) => setPositions(pos);
    // const handleKeyModeChanged = (e, mode) => setCurrentMode(mode);
    const handleReset = (e, data) => {
      setKeyMappings(data.keys);
      setPositions(data.positions);
      // CSS 관련 상태도 초기화 (SettingTab 방문 전이라도 UI 일관성 유지)
      setUseCustomCSS(false);
      setCustomCSSContent("");
      setCustomCSSPath("");
    };

    ipcRenderer.send("getKeyMappings");
    ipcRenderer.send("getKeyPositions");
    // --- Early custom CSS sync: KeySettingModal / Grid 등이 먼저 뜰 때 반영되도록 ---
    ipcRenderer
      .invoke("get-use-custom-css")
      .then((enabled) => {
        if (typeof enabled === "boolean") setUseCustomCSS(enabled);
      })
      .catch(() => {});
    ipcRenderer
      .invoke("get-custom-css")
      .then((data) => {
        if (data) {
          if (data.content) setCustomCSSContent(data.content);
          if (data.path) setCustomCSSPath(data.path);
        }
      })
      .catch(() => {});
    // ipcRenderer.send('getCurrentMode');

    ipcRenderer.on("updateKeyMappings", handleKeyMappings);
    ipcRenderer.on("updateKeyPositions", handleKeyPositions);
    // ipcRenderer.on('keyModeChanged', handleKeyModeChanged);
    ipcRenderer.on("resetComplete", handleReset);

    return () => {
      ipcRenderer.removeAllListeners("updateKeyMappings");
      ipcRenderer.removeAllListeners("updateKeyPositions");
      // ipcRenderer.removeAllListeners('keyModeChanged');
      ipcRenderer.removeAllListeners("resetComplete");
    };
  }, []);

  const handlePositionChange = (index, dx, dy) => {
    setPositions((prevPositions) => {
      const newPositions = {
        ...prevPositions,
        [selectedKeyType]: prevPositions[selectedKeyType].map((pos, i) => {
          if (i === index) {
            return { ...pos, dx, dy };
          }
          return pos;
        }),
      };

      ipcRenderer.send("update-key-positions", newPositions);
      return newPositions;
    });
  };

  // const handleModeChange = (mode) => {
  //   ipcRenderer.send('setKeyMode', mode);
  // };

  const handleReset = () => {
    if (ipcRenderer) {
      ipcRenderer.send("reset-keys");
    } else {
      console.error("ipcRenderer not available");
    }
  };

  const handleKeyUpdate = (keyData) => {
    const {
      key,
      activeImage,
      inactiveImage,
      width,
      height,
      noteColor,
      noteOpacity,
      classNameActive,
      classNameInactive,
    } = keyData;
    const updatedMappings = { ...keyMappings };
    const updatedPositions = { ...positions };

    if (selectedKey) {
      updatedMappings[selectedKeyType][selectedKey.index] = key;
      updatedPositions[selectedKeyType][selectedKey.index] = {
        ...updatedPositions[selectedKeyType][selectedKey.index],
        activeImage,
        inactiveImage,
        width,
        height,
        noteColor,
        noteOpacity,
        classNameActive:
          classNameActive ||
          updatedPositions[selectedKeyType][selectedKey.index]
            .classNameActive ||
          "",
        classNameInactive:
          classNameInactive ||
          updatedPositions[selectedKeyType][selectedKey.index]
            .classNameInactive ||
          "",
      };
    }

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    ipcRenderer.send("update-key-mapping", updatedMappings);
    ipcRenderer.send("update-key-positions", updatedPositions);
    setSelectedKey(null);
  };

  const handleAddKey = () => {
    const newKeyName = "";
    const newKeyPosition = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      activeImage: "",
      inactiveImage: "",
      count: 0,
      noteColor: "#FFFFFF",
      noteOpacity: 80,
    };

    const updatedMappings = {
      ...keyMappings,
      [selectedKeyType]: [...keyMappings[selectedKeyType], newKeyName],
    };

    const updatedPositions = {
      ...positions,
      [selectedKeyType]: [...positions[selectedKeyType], newKeyPosition],
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    ipcRenderer.send("update-key-mapping", updatedMappings);
    ipcRenderer.send("update-key-positions", updatedPositions);
  };

  const handleDeleteKey = (indexToDelete) => {
    const updatedMappings = {
      ...keyMappings,
      [selectedKeyType]: keyMappings[selectedKeyType].filter(
        (_, index) => index !== indexToDelete
      ),
    };

    const updatedPositions = {
      ...positions,
      [selectedKeyType]: positions[selectedKeyType].filter(
        (_, index) => index !== indexToDelete
      ),
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    ipcRenderer.send("update-key-mapping", updatedMappings);
    ipcRenderer.send("update-key-positions", updatedPositions);
    setSelectedKey(null); // 모달 닫기
  };

  return {
    selectedKey,
    keyMappings,
    positions,
    setSelectedKey,
    handlePositionChange,
    handleReset,
    handleKeyUpdate,
    handleAddKey,
    handleDeleteKey,
  };
}
