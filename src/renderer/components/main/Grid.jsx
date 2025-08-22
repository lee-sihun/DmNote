import React, { useEffect } from "react";
import { useKeyManager } from "@hooks/useKeyManager";
import { usePalette } from "@hooks/usePalette";
import DraggableKey from "@components/Key";
import Palette from "./Palette";
import KeySettingModal from "./KeySettingModal";
import { ReactComponent as ResetIcon } from "@assets/svgs/reset.svg";
import { ReactComponent as PaletteIcon } from "@assets/svgs/palette.svg";
import { useKeyStore } from "@stores/useKeyStore.js";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function Grid() {
  const { selectedKeyType } = useKeyStore();
  const { noteEffect, setNoteEffect } = useSettingsStore();
  const {
    selectedKey,
    setSelectedKey,
    keyMappings,
    positions,
    handlePositionChange,
    handleReset,
    handleKeyUpdate,
  } = useKeyManager();
  const {
    color,
    palette,
    setPalette,
    handleColorChange,
    handlePaletteClose,
    handleResetColor,
  } = usePalette();
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    ipcRenderer.send("setKeyMode", selectedKeyType);
  }, [selectedKeyType]);

  useEffect(() => {
    ipcRenderer.send("get-note-effect");

    const noteEffectHandler = (_, value) => {
      setNoteEffect(value);
    };

    ipcRenderer.on("update-note-effect", noteEffectHandler);

    return () => {
      ipcRenderer.removeAllListeners("update-note-effect");
    };
  }, [setNoteEffect]);

  useEffect(() => {
    const handleReset = (e, data) => {
      if (data.positions) {
        setPositions(data.positions);
      }
      if (data.color) {
        handleColorChange(data.color);
      }
    };

    ipcRenderer.on("resetComplete", handleReset);

    return () => {
      ipcRenderer.removeAllListeners("resetComplete");
    };
  }, []);

  // cleanup
  useEffect(() => {
    setPalette(false);
    return () => {
      setPalette(false);
    };
  }, []);

  const renderKeys = () => {
    if (!positions[selectedKeyType]) return null;

    return positions[selectedKeyType].map((position, index) => (
      <DraggableKey
        key={index}
        index={index}
        position={position}
        keyName={keyMappings[selectedKeyType]?.[index] || ""}
        onPositionChange={handlePositionChange}
        onClick={() =>
          setSelectedKey({ key: keyMappings[selectedKeyType][index], index })
        }
      />
    ));
  };

  return (
    <div
      className="grid-bg relative w-full h-[320px] bg-[#393A3F] rounded-[6px]"
      style={{ backgroundColor: color === "transparent" ? "#393A3F" : color }}
      onClick={handlePaletteClose}
    >
      {noteEffect && (
        <>
          <p
            className="absolute leading-relaxed text-center text-white transform -translate-x-1/2 left-1/2"
            style={{ top: "60px" }}
          >
            노트 효과를 위한 충분한 영역을 확보해야합니다. <br />
            <b className="text-red-500">붉은 선</b> 아래에 키를 배치해주세요.
          </p>
          <div
            className="absolute left-0 right-0 h-[1px] bg-red-500"
            style={{ top: "150px" }}  
          />
        </>
      )}
      {renderKeys()}
      <button
        className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[57px] left-[18px]"
        onClick={() => setPalette(!palette)}
      >
        <PaletteIcon />
      </button>
      <button
        className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[18px] left-[18px]"
        onClick={() => {
          handleReset();
          handleResetColor();
        }}
      >
        <ResetIcon />
      </button>
      {palette && <Palette color={color} onColorChange={handleColorChange} />}
      {selectedKey && (
        <KeySettingModal
          keyData={{
            key: selectedKey.key,
            activeImage:
              positions[selectedKeyType][selectedKey.index].activeImage,
            inactiveImage:
              positions[selectedKeyType][selectedKey.index].inactiveImage,
            width: positions[selectedKeyType][selectedKey.index].width,
            height: positions[selectedKeyType][selectedKey.index].height,
            noteColor:
              positions[selectedKeyType][selectedKey.index].noteColor ||
              "#FFFFFF",
            noteOpacity:
              positions[selectedKeyType][selectedKey.index].noteOpacity || 80,
          }}
          onClose={() => setSelectedKey(null)}
          onSave={handleKeyUpdate}
        />
      )}
    </div>
  );
}
