import { Key } from "@components/Key";
import { Track } from "@components/overlay/Track";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useNoteSystem } from "@hooks/useNoteSystem";
// import { useSettingsStore } from "@stores/useSettingsStore";
// import CountDisplay from "@components/CountDisplay";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState("4key");
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const [keyStates, setKeyStates] = useState({});
  const [backgroundColor, setBackgroundColor] = useState("");
  // const showKeyCount = useSettingsStore(state => state.showKeyCount);
  // const { setShowKeyCount } = useSettingsStore();

  // 노트 시스템
  const {
    notes,
    keyStates: noteKeyStates,
    handleKeyDown,
    handleKeyUp,
  } = useNoteSystem();
  const [trackHeight] = useState(150); // 트랙 높이 설정

  // 기존 키 상태와 노트 시스템 키 상태 병합
  const [originalKeyStates, setOriginalKeyStates] = useState({});

  // 키 상태 변경 리스너
  const keyStateListener = useCallback(
    (e, { key, state }) => {
      const isDown = state === "DOWN";

      // 원본 키 상태 업데이트
      setOriginalKeyStates((prev) => {
        if (prev[key] === isDown) return prev;
        return { ...prev, [key]: isDown };
      });

      // 노트 시스템 업데이트
      if (isDown) {
        handleKeyDown(key);
      } else {
        handleKeyUp(key);
      }
    },
    [handleKeyDown, handleKeyUp]
  );

  // 현재 모드의 키 목록 메모이제이션
  const currentKeys = useMemo(
    () => keyMappings[keyMode] || [],
    [keyMappings, keyMode]
  );
  const currentPositions = useMemo(
    () => positions[keyMode] || [],
    [positions, keyMode]
  );

  useEffect(() => {
    // 초기 데이터 요청
    ipcRenderer.send("getKeyMappings");
    ipcRenderer.send("getKeyPositions");
    ipcRenderer.send("getCurrentMode");
    ipcRenderer.send("getBackgroundColor");
    // ipcRenderer.send('get-show-key-count');

    // const keyStateListener = (e, { key, state }) => {
    //   if (state === 'DOWN') {
    //     // 이전 상태가 false일 때만 카운트 증가
    //     setKeyStates(prev => {
    //       // const wasKeyPressed = prev[key];
    //       // if (!wasKeyPressed) {
    //       //   setPositions(currentPos => {
    //       //     const newPositions = { ...currentPos };
    //       //     const currentMode = keyMode;
    //       //     const keyIndex = keyMappings[currentMode]?.indexOf(key);

    //       //     if (keyIndex !== -1 && newPositions[currentMode]) {
    //       //       newPositions[currentMode][keyIndex] = {
    //       //         ...newPositions[currentMode][keyIndex],
    //       //         count: (newPositions[currentMode][keyIndex].count || 0) + 1
    //       //       };
    //       //       ipcRenderer.send('update-key-positions', newPositions);
    //       //     }
    //       //     return newPositions;
    //       //   });
    //       // }
    //       return { ...prev, [key]: true };
    //     });
    //   } else {
    //     setKeyStates(prev => ({ ...prev, [key]: false }));
    //   }
    // };
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

    // const showKeyCountListener = (_, value) => {
    //   setShowKeyCount(value);
    // };

    // 이벤트 리스너 등록
    ipcRenderer.on("keyState", keyStateListener);
    ipcRenderer.on("keyModeChanged", keyModeListener);
    ipcRenderer.on("updateKeyMappings", keyMappingsListener);
    ipcRenderer.on("updateKeyPositions", positionsListener);
    ipcRenderer.on("updateBackgroundColor", backgroundColorListener);
    // ipcRenderer.on('update-show-key-count', showKeyCountListener);

    return () => {
      ipcRenderer.removeAllListeners("keyState");
      ipcRenderer.removeAllListeners("keyModeChanged");
      ipcRenderer.removeAllListeners("updateKeyMappings");
      ipcRenderer.removeAllListeners("updateKeyPositions");
      ipcRenderer.removeAllListeners("updateBackgroundColor");
      // ipcRenderer.removeAllListeners('update-show-key-count');
    };
  }, [keyStateListener]);

  return (
    <div
      className="relative w-full h-screen m-0 overflow-hidden [app-region:drag]"
      style={{
        backgroundColor:
          backgroundColor === "transparent" ? "transparent" : backgroundColor,
        willChange: "contents",
        contain: "layout style paint",
      }}
    >
      {currentKeys.map((key, index) => {
        const position = currentPositions[index] || {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
        };

        const keyNotes = notes[key] || [];

        return (
          <Track
            key={`track-${keyMode}-${index}`}
            notes={keyNotes}
            width={position.width}
            height={trackHeight}
            position={position}
          />
        );
      })}

      {currentKeys.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const position = currentPositions[index] || {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
        };

        return (
          // <React.Fragment key={index}>
          //   {showKeyCount && (
          //     <CountDisplay
          //       count={position.count}
          //       position={position}
          //     />
          //   )}
          <Key
            key={`${keyMode}-${index}`}
            keyName={displayName}
            active={originalKeyStates[key] || false}
            position={position}
          />
          // </React.Fragment>
        );
      })}
    </div>
  );
}
