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
import { LatencyDisplay } from "@components/overlay/LatencyDisplay";
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

  // Latency 측정 상태
  const lastPressTimestamp = useRef(0);
  const [isMeasuring, setIsMeasuring] = useState(true);
  const [latencies, setLatencies] = useState([]);
  const [recentLatencies, setRecentLatencies] = useState([]);
  const [stats, setStats] = useState({ avg: 0, min: 0, max: 0, count: 0 });

  // 키 상태 변경 리스너
  const keyStateListener = useCallback(
    (e, { key, state, timestamp }) => {
      const isDown = state === "DOWN";

      if (isDown) {
        lastPressTimestamp.current = timestamp; // 키를 눌렀을 때의 타임스탬프 저장
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

  // 모든 키 중 가장 위에 있는 키의 Y 위치 계산
  const topMostY = useMemo(() => {
    if (!currentPositions.length) return 0;

    return Math.min(...currentPositions.map((pos) => pos.dy));
  }, [currentPositions]);

  // 성능 측정
  useEffect(() => {
    // 렌더링 후 latency 측정
    if (lastPressTimestamp.current > 0 && isMeasuring) {
      requestAnimationFrame(() => {
        const paintTimestamp = Date.now();
        const latency = paintTimestamp - lastPressTimestamp.current;
        lastPressTimestamp.current = 0; // 타임스탬프를 사용한 직후 초기화

        // 비정상적인 값 (1초 초과)은 무시
        if (latency > 1000) {
          return;
        }

        // 최근 100개 데이터만 유지
        setLatencies((prev) => [
          ...prev.slice(prev.length >= 100 ? 1 : 0),
          latency,
        ]);
        setRecentLatencies((prev) => [latency, ...prev.slice(0, 4)]); // 최근 5개 유지
      });
    } else if (lastPressTimestamp.current > 0) {
      // 측정이 중단되었어도 timestamp는 초기화해야 함
      lastPressTimestamp.current = 0;
    }
  }, [originalKeyStates, isMeasuring]);

  // Latency 통계 계산
  useEffect(() => {
    if (latencies.length === 0) {
      setStats({ avg: 0, min: 0, max: 0, count: 0 });
      return;
    }

    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = (sum / latencies.length).toFixed(2);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const count = latencies.length;

    setStats({ avg, min, max, count });
  }, [latencies]);

  const handleToggleMeasurement = () => {
    setIsMeasuring((prev) => !prev);
  };

  const handleResetStats = () => {
    setLatencies([]);
    setRecentLatencies([]);
  };

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
      {/* 성능 측정  */}
      <LatencyDisplay
        stats={stats}
        recentLatencies={recentLatencies}
        isMeasuring={isMeasuring}
        onToggle={handleToggleMeasurement}
        onReset={handleResetStats}
      />

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

        // 트랙 위치를 가장 위쪽 키 기준으로 통일
        const trackPosition = {
          ...position,
          dy: topMostY, // 모든 트랙이 동일한 Y 위치에서 시작
        };

        return (
          <Track
            key={`track-${keyMode}-${index}`}
            notes={keyNotes}
            width={position.width}
            height={trackHeight}
            // position={position}
            position={trackPosition}
            noteColor={position.noteColor || "#FFFFFF"}
            noteOpacity={position.noteOpacity || 80}
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
