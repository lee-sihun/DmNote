import { Key } from "@components/Key";
import { Track } from "@components/overlay/Track";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useNoteSystem } from "@hooks/useNoteSystem";
// import { useSettingsStore } from "@stores/useSettingsStore";
// import CountDisplay from "@components/CountDisplay";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState("4key");
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const [backgroundColor, setBackgroundColor] = useState("");
  // const showKeyCount = useSettingsStore(state => state.showKeyCount);
  // const { setShowKeyCount } = useSettingsStore();

  // 노트 시스템
  const { notes, handleKeyDown, handleKeyUp } = useNoteSystem();
  const [trackHeight] = useState(150); // 트랙 높이 설정

  // 기존 키 상태와 노트 시스템 키 상태 병합
  const [originalKeyStates, setOriginalKeyStates] = useState({});

  // 반응속도 측정 관련 상태
  const [performanceMeasurementEnabled, setPerformanceMeasurementEnabled] =
    useState(true);
  const [responseTimeData, setResponseTimeData] = useState([]);

  // 키 상태 변경 리스너
  const keyStateListener = useCallback(
    (e, { key, state }) => {
      const isDown = state === "DOWN";

      // 렌더러 프로세스에서 키 이벤트 수신 시점 기록
      const receiveTimestamp = performance.now();

      console.log("키 이벤트 수신:", { key, state, receiveTimestamp });

      // 반응속도 측정이 활성화되고 키가 눌린 경우
      if (performanceMeasurementEnabled && isDown) {
        console.log("반응속도 측정 시작:", {
          key,
          receiveTimestamp,
          enabled: performanceMeasurementEnabled,
        });

        // 다음 프레임에서 화면 업데이트 완료 시점 측정
        requestAnimationFrame(() => {
          const renderTimestamp = performance.now();
          const responseTime = renderTimestamp - receiveTimestamp;

          console.log("반응속도 계산:", {
            key,
            receiveTimestamp,
            renderTimestamp,
            responseTime,
          });

          // 유효한 값인지 확인 (음수이거나 너무 큰 값 제외)
          if (responseTime >= 0 && responseTime < 1000) {
            setResponseTimeData((prev) => {
              const newData = [
                ...prev,
                {
                  key,
                  responseTime: Math.round(responseTime * 100) / 100,
                  timestamp: new Date().toLocaleTimeString(),
                },
              ];

              console.log("반응속도 데이터 추가:", newData.slice(-1)[0]);
              // 최근 100개 데이터만 유지
              return newData.slice(-100);
            });
          } else {
            console.log("유효하지 않은 반응속도:", responseTime);
          }
        });
      }

      // 원본 키 상태 업데이트
      setOriginalKeyStates((prev) => {
        if (prev[key] === isDown) return prev;
        return { ...prev, [key]: isDown };
      });

      // 노트 시스템 업데이트
      requestAnimationFrame(() => {
        if (isDown) {
          handleKeyDown(key);
        } else {
          handleKeyUp(key);
        }
      });
    },
    [handleKeyDown, handleKeyUp, performanceMeasurementEnabled]
  );

  // 반응속도 측정 토글 핸들러
  const togglePerformanceMeasurement = () => {
    const newState = !performanceMeasurementEnabled;
    console.log("반응속도 측정 토글:", {
      현재: performanceMeasurementEnabled,
      새상태: newState,
    });
    setPerformanceMeasurementEnabled(newState);
    ipcRenderer.send("toggle-performance-measurement", newState);

    if (!newState) {
      setResponseTimeData([]);
    }
  };

  // 평균 반응속도 계산
  const averageResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    const sum = responseTimeData.reduce(
      (acc, data) => acc + data.responseTime,
      0
    );
    return Math.round((sum / responseTimeData.length) * 100) / 100;
  }, [responseTimeData]);

  // 최소/최대 반응속도
  const minResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    return Math.min(...responseTimeData.map((data) => data.responseTime));
  }, [responseTimeData]);

  const maxResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    return Math.max(...responseTimeData.map((data) => data.responseTime));
  }, [responseTimeData]);

  // 현재 모드의 키 목록 메모이제이션
  const currentKeys = useMemo(
    () => keyMappings[keyMode] || [],
    [keyMappings, keyMode]
  );
  const currentPositions = useMemo(
    () => positions[keyMode] || [],
    [positions, keyMode]
  );

  // 모든 키 중 가장 위에 있는 키의 Y 위치 계산
  const topMostY = useMemo(() => {
    if (!currentPositions.length) return 0;

    return Math.min(...currentPositions.map((pos) => pos.dy));
  }, [currentPositions]);

  useEffect(() => {
    // 초기 데이터 요청
    ipcRenderer.send("getKeyMappings");
    ipcRenderer.send("getKeyPositions");
    ipcRenderer.send("getCurrentMode");
    ipcRenderer.send("getBackgroundColor");
    // ipcRenderer.send('get-show-key-count');
    ipcRenderer.send("toggle-performance-measurement", true);

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

    const performanceMeasurementListener = (e, enabled) => {
      setPerformanceMeasurementEnabled(enabled);
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
    ipcRenderer.on(
      "performance-measurement-toggled",
      performanceMeasurementListener
    );

    return () => {
      ipcRenderer.removeAllListeners("keyState");
      ipcRenderer.removeAllListeners("keyModeChanged");
      ipcRenderer.removeAllListeners("updateKeyMappings");
      ipcRenderer.removeAllListeners("updateKeyPositions");
      ipcRenderer.removeAllListeners("updateBackgroundColor");
      // ipcRenderer.removeAllListeners('update-show-key-count');
      ipcRenderer.removeAllListeners("performance-measurement-toggled");
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
        transform: "translateZ(0)",
        backfaceVisibility: "hidden",
      }}
    >
      {/* 반응속도 측정 UI - 항상 표시 */}
      <div className="[app-region:no-drag] absolute z-50 p-4 text-sm text-white bg-black bg-opacity-75 rounded-lg top-4 right-4">
        <div className="mb-2 font-bold">키 반응속도 측정</div>
        <div>측정 횟수: {responseTimeData.length}</div>
        <div>평균: {averageResponseTime}ms</div>
        <div>최소: {minResponseTime}ms</div>
        <div>최대: {maxResponseTime}ms</div>

        {/* 최근 5개 측정값 표시 */}
        {responseTimeData.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="font-semibold">최근 측정값:</div>
            {responseTimeData.slice(-5).map((data, idx) => (
              <div key={idx} className="text-xs opacity-75">
                {data.key}: {data.responseTime}ms
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <button
            onClick={togglePerformanceMeasurement}
            className={`px-2 py-1 text-xs rounded ${
              performanceMeasurementEnabled
                ? "bg-red-600 hover:bg-red-700"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {performanceMeasurementEnabled ? "측정 중단" : "측정 시작"}
          </button>
          <button
            onClick={() => setResponseTimeData([])}
            className="px-2 py-1 text-xs bg-gray-600 rounded hover:bg-gray-700"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 정적 레이어 - 트랙들 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          contain: "layout style paint",
          willChange: "transform",
        }}
      >
        {currentKeys.map((key, index) => {
          const position = currentPositions[index] || {
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
            noteColor: "#FFFFFF",
            noteOpacity: 80,
          };
          const keyNotes = notes[key] || [];
          const trackPosition = { ...position, dy: topMostY };

          return (
            <Track
              key={`track-${keyMode}-${index}`}
              notes={keyNotes}
              width={position.width}
              height={trackHeight}
              position={trackPosition}
              noteColor={position.noteColor || "#FFFFFF"}
              noteOpacity={position.noteOpacity || 80}
            />
          );
        })}
      </div>

      {/* 동적 레이어 - 키들만 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          contain: "layout style paint",
          willChange: "transform",
          pointerEvents: "none", // 키는 클릭 불필요
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
            <Key
              key={`${keyMode}-${index}`}
              keyName={displayName}
              active={originalKeyStates[key] || false}
              position={position}
            />
          );
        })}
      </div>
    </div>
  );
}
