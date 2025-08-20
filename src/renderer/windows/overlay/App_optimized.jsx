import { Key } from "@components/Key";
import { Track } from "@components/overlay/Track";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useNoteSystem } from "@hooks/useNoteSystem";

export default function App() {
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState("4key");
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const [backgroundColor, setBackgroundColor] = useState("");
  
  // 노트 시스템
  const { notes, handleKeyDown, handleKeyUp } = useNoteSystem();
  const [trackHeight] = useState(150);
  
  // 키 상태
  const [originalKeyStates, setOriginalKeyStates] = useState({});
  
  // 성능 측정
  const [performanceMeasurementEnabled, setPerformanceMeasurementEnabled] = useState(false);
  const [responseTimeData, setResponseTimeData] = useState([]);

  // 키 상태 변경 리스너 - 최적화된 즉시 반응
  const keyStateListener = useCallback(
    (e, { key, state }) => {
      const isDown = state === "DOWN";
      const receiveTimestamp = performance.now();

      // 노트 시스템 최우선 업데이트
      if (isDown) {
        handleKeyDown(key);
      } else {
        handleKeyUp(key);
      }

      // 키 상태 즉시 업데이트
      setOriginalKeyStates((prev) => {
        if (prev[key] === isDown) return prev;
        return { ...prev, [key]: isDown };
      });

      // 성능 측정 (비동기로 처리해 메인 로직에 영향 없음)
      if (performanceMeasurementEnabled && isDown) {
        Promise.resolve().then(() => {
          const renderTimestamp = performance.now();
          const responseTime = renderTimestamp - receiveTimestamp;

          if (responseTime >= 0 && responseTime < 50) {
            setResponseTimeData((prev) => {
              const newData = [
                ...prev,
                {
                  key,
                  responseTime: Math.round(responseTime * 100) / 100,
                  timestamp: new Date().toLocaleTimeString(),
                },
              ];
              return newData.slice(-50); // 최근 50개만 유지
            });
          }
        });
      }
    },
    [handleKeyDown, handleKeyUp, performanceMeasurementEnabled]
  );

  // 이벤트 리스너 등록
  useEffect(() => {
    ipcRenderer.on("key-state-changed", keyStateListener);
    return () => {
      ipcRenderer.removeAllListeners("key-state-changed");
    };
  }, [keyStateListener]);

  // 초기 설정 로드
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [keyModeRes, keyMappingsRes, positionsRes, backgroundColorRes] = 
          await Promise.all([
            ipcRenderer.invoke("get-key-mode"),
            ipcRenderer.invoke("get-key-mappings"),
            ipcRenderer.invoke("get-key-positions"),
            ipcRenderer.invoke("get-background-color"),
          ]);

        setKeyMode(keyModeRes);
        setKeyMappings(keyMappingsRes);
        setPositions(positionsRes);
        setBackgroundColor(backgroundColorRes);
      } catch (error) {
        console.error("설정 로드 실패:", error);
      }
    };

    loadSettings();

    // 설정 변경 리스너
    const listeners = [
      { event: "update-key-mode", setter: setKeyMode },
      { event: "update-key-mappings", setter: setKeyMappings },
      { event: "update-key-positions", setter: setPositions },
      { event: "update-background-color", setter: setBackgroundColor },
    ];

    listeners.forEach(({ event, setter }) => {
      ipcRenderer.on(event, (_, data) => setter(data));
    });

    return () => {
      listeners.forEach(({ event }) => {
        ipcRenderer.removeAllListeners(event);
      });
    };
  }, []);

  // 현재 키 목록 메모이제이션
  const currentKeys = useMemo(() => keyMappings[keyMode] || [], [keyMappings, keyMode]);
  const currentPositions = useMemo(() => positions[keyMode] || [], [positions, keyMode]);

  // 성능 측정 통계
  const averageResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    const sum = responseTimeData.reduce((acc, data) => acc + data.responseTime, 0);
    return Math.round((sum / responseTimeData.length) * 100) / 100;
  }, [responseTimeData]);

  const minResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    return Math.min(...responseTimeData.map((data) => data.responseTime));
  }, [responseTimeData]);

  const maxResponseTime = useMemo(() => {
    if (responseTimeData.length === 0) return 0;
    return Math.max(...responseTimeData.map((data) => data.responseTime));
  }, [responseTimeData]);

  // 성능 측정 토글
  const togglePerformanceMeasurement = () => {
    const newState = !performanceMeasurementEnabled;
    setPerformanceMeasurementEnabled(newState);
    ipcRenderer.send("toggle-performance-measurement", newState);
    
    if (!newState) {
      setResponseTimeData([]);
    }
  };

  // 최상단 Y 위치 계산
  const topMostY = useMemo(() => {
    if (currentPositions.length === 0) return 0;
    return Math.min(...currentPositions.map((pos) => pos.dy));
  }, [currentPositions]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor }}
    >
      {/* 성능 측정 UI */}
      <div className="[app-region:no-drag] absolute z-50 p-3 text-sm text-white bg-black bg-opacity-80 rounded-lg top-4 right-4">
        <div className="mb-2 font-bold">키 반응속도 측정</div>
        <div>측정 횟수: {responseTimeData.length}</div>
        <div>평균: {averageResponseTime}ms</div>
        <div>최소: {minResponseTime}ms</div>
        <div>최대: {maxResponseTime}ms</div>

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

      {/* 키 및 트랙 레이어 */}
      <div
        style={{
          position: "absolute",
          top: `${topMostY - trackHeight}px`,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        {/* 키 렌더링 */}
        {currentKeys.map((key, index) => {
          const position = currentPositions[index];
          if (!position) return null;

          const keyInfo = getKeyInfoByGlobalKey(key);
          return (
            <Key
              key={key}
              label={keyInfo.displayKey}
              position={position}
              active={originalKeyStates[key] || false}
            />
          );
        })}

        {/* 트랙 렌더링 */}
        {currentKeys.map((key, index) => {
          const position = currentPositions[index];
          const keyNotes = notes[key];
          
          if (!position || !keyNotes || keyNotes.length === 0) return null;

          return (
            <Track
              key={`track-${key}`}
              notes={keyNotes}
              width={position.width}
              height={trackHeight}
              position={position}
              noteColor="#ffffff"
              noteOpacity={80}
            />
          );
        })}
      </div>
    </div>
  );
}
