import { Key } from "@components/Key";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
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

  // 키 상태 변경 리스너
  const keyStateListener = useCallback((e, { key, state }) => {
    // 불필요한 객체 스프레드 제거, 직접 업데이트
    setKeyStates((prev) => {
      if (prev[key] === (state === "DOWN")) return prev; // 동일 상태면 업데이트 X
      return { ...prev, [key]: state === "DOWN" };
    });
  }, []);

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
      }}
    >
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
            active={keyStates[key] || false}
            position={position}
          />
          // </React.Fragment>
        );
      })}
    </div>
  );
}
