import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DraggableKey from "@components/Key";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import KeySettingModal from "./modal/content/KeySetting";
import { useKeyStore } from "@stores/useKeyStore.js";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function Grid({
  showConfirm,
  selectedKey,
  setSelectedKey,
  keyMappings,
  positions,
  onPositionChange,
  onKeyUpdate,
  onKeyDelete,
  color,
  activeTool,
  shouldSkipModalAnimation,
  onModalAnimationConsumed,
}) {
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();
  const { noteEffect, setNoteEffect } = useSettingsStore();
  const { t } = useTranslation();
  const ipcRenderer = window.electron.ipcRenderer;
  const [initialLoaded, setInitialLoaded] = useState(false);

  useEffect(() => {
    if (!initialLoaded) return;
    ipcRenderer.send("setKeyMode", selectedKeyType);
  }, [selectedKeyType, initialLoaded]);

  // 저장된 키 모드 로드
  useEffect(() => {
    ipcRenderer
      .invoke("get-selected-key-type")
      .then((mode) => {
        const valid = ["4key", "5key", "6key", "8key"];
        if (valid.includes(mode)) {
          setSelectedKeyType(mode);
        }
      })
      .finally(() => setInitialLoaded(true));
  }, []);

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
      // if (data.positions) {

      // }
      if (data.color) {
        // onColorChange(data.color); // 이제 App에서 처리
      }
    };

    ipcRenderer.on("resetComplete", handleReset);

    return () => {
      ipcRenderer.removeAllListeners("resetComplete");
    };
  }, []);

  // cleanup
  useEffect(() => {
    return () => {
      // setPalette(false); // 이제 App에서 처리
    };
  }, []);

  // Settings에서 돌아온 직후 Grid가 표시될 때 모달의 첫 진입 애니메이션을 건너뛰도록 플래그를 1회성으로 소비
  useEffect(() => {
    if (shouldSkipModalAnimation && selectedKey && typeof onModalAnimationConsumed === "function") {
      onModalAnimationConsumed();
    }
  }, [shouldSkipModalAnimation, selectedKey, onModalAnimationConsumed]);

  const renderKeys = () => {
    if (!positions[selectedKeyType]) return null;

    return positions[selectedKeyType].map((position, index) => (
      <DraggableKey
        key={index}
        index={index}
        position={position}
        keyName={keyMappings[selectedKeyType]?.[index] || ""}
        onPositionChange={onPositionChange}
        onClick={() =>
          setSelectedKey({ key: keyMappings[selectedKeyType][index], index })
        }
        activeTool={activeTool}
        onEraserClick={() => {
          const globalKey = keyMappings[selectedKeyType]?.[index] || "";
          const displayName =
            getKeyInfoByGlobalKey(globalKey)?.displayName || globalKey;
          showConfirm(
            t("confirm.removeKey", { name: displayName }),
            () => onKeyDelete(index),
            t("confirm.remove")
          );
        }}
      />
    ));
  };

  return (
    <div
      className="grid-bg relative w-full h-full bg-[#3A3943] rounded-[0px]"
      style={{ backgroundColor: color === "transparent" ? "#3A3943" : color }}
    >
      {renderKeys()}
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
            className:
              positions[selectedKeyType][selectedKey.index].className || "",
          }}
          onClose={() => setSelectedKey(null)}
          onSave={onKeyUpdate}
          skipAnimation={shouldSkipModalAnimation}
        />
      )}
    </div>
  );
}
