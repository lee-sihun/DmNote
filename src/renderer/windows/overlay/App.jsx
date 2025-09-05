import { Key } from "@components/Key";
import { WebGLTracks } from "@components/overlay/WebGLTracks";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  // useRef,
} from "react";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { TRACK_HEIGHT } from "@constants/overlayConfig";
import { useNoteSystem } from "@hooks/useNoteSystem";
import { useCustomCssInjection } from "@hooks/useCustomCssInjection";
// import { LatencyDisplay } from "@components/overlay/LatencyDisplay";
// import { useSettingsStore } from "@stores/useSettingsStore";
// import CountDisplay from "@components/CountDisplay";

export default function App() {
  useCustomCssInjection();
  const { ipcRenderer } = window.require("electron");
  const [keyMode, setKeyMode] = useState("4key");
  const [keyMappings, setKeyMappings] = useState({});
  const [positions, setPositions] = useState({});
  const [backgroundColor, setBackgroundColor] = useState("");
  const [noteSettings, setNoteSettings] = useState({
    borderRadius: 2,
    speed: 180,
  });
  // const showKeyCount = useSettingsStore(state => state.showKeyCount);
  // const { setShowKeyCount } = useSettingsStore();

  // 노트 시스템
  const { notesRef, subscribe, handleKeyDown, handleKeyUp } = useNoteSystem();
  const [trackHeight] = useState(TRACK_HEIGHT); // 트랙 높이 설정

  // 기존 키 상태와 노트 시스템 키 상태 병합
  const [originalKeyStates, setOriginalKeyStates] = useState({});

  // Latency 측정 상태
  // const lastPressTimestamp = useRef(0);
  // const [isMeasuring, setIsMeasuring] = useState(true);
  // const [latencies, setLatencies] = useState([]);
  // const [recentLatencies, setRecentLatencies] = useState([]);
  // const [stats, setStats] = useState({ avg: 0, min: 0, max: 0, count: 0 });

  // 키 상태 변경 리스너
  const keyStateListener = useCallback(
    (e, { key, state }) => {
      const isDown = state === "DOWN";

      // if (isDown) {
      //   lastPressTimestamp.current = timestamp; // 키를 눌렀을 때의 타임스탬프 저장
      // }

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

  // 동적 리사이즈 & 좌표 변환
  const PADDING = 30; // 상하좌우 여백
  const TRACK_RESERVE = TRACK_HEIGHT;
  const [noteEffectEnabled, setNoteEffectEnabled] = useState(false);

  useEffect(() => {
    ipcRenderer.send("get-note-effect");
    const handler = (_, value) => setNoteEffectEnabled(value);
    ipcRenderer.on("update-note-effect", handler);
    return () => ipcRenderer.removeAllListeners("update-note-effect");
  }, []);

  // 원본 좌표 기준 경계 박스 계산
  const bounds = useMemo(() => {
    if (!currentPositions.length) return null;
    const minX = Math.min(...currentPositions.map((p) => p.dx));
    const minY = Math.min(...currentPositions.map((p) => p.dy));
    const maxX = Math.max(
      ...currentPositions.map((p) => p.dx + (p.width || 60))
    );
    const maxY = Math.max(
      ...currentPositions.map((p) => p.dy + (p.height || 60))
    );
    return { minX, minY, maxX, maxY };
  }, [currentPositions]);

  // 렌더링용 변환 좌표
  const displayPositions = useMemo(() => {
    if (!bounds) return currentPositions;
    // const topOffset = (noteEffectEnabled ? TRACK_RESERVE : 0) + PADDING;
    const topOffset = TRACK_RESERVE + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;
    return currentPositions.map((pos) => ({
      ...pos,
      dx: pos.dx + offsetX,
      dy: pos.dy + offsetY,
    }));
  }, [currentPositions, bounds, noteEffectEnabled]);

  // 윈도우 크기 계산 및 메인 프로세스에 전달
  useEffect(() => {
    if (!bounds) return;
    const keyAreaWidth = bounds.maxX - bounds.minX;
    const keyAreaHeight = bounds.maxY - bounds.minY;
    // const extraTop = noteEffectEnabled ? TRACK_RESERVE : 0;
    const extraTop = TRACK_RESERVE;
    const totalWidth = keyAreaWidth + PADDING * 2;
    const totalHeight = keyAreaHeight + PADDING * 2 + extraTop;
    ipcRenderer.send("resize-overlay", {
      width: totalWidth,
      height: totalHeight,
    });
  }, [bounds, noteEffectEnabled]);

  // 가장 위 키 (변환 후) Y 위치
  const topMostY = useMemo(() => {
    if (!displayPositions.length) return 0;
    return Math.min(...displayPositions.map((pos) => pos.dy));
  }, [displayPositions]);

  // WebGL 트랙 데이터 (항상 계산하되 noteEffectEnabled일 때만 사용)
  const webglTracks = useMemo(
    () =>
      currentKeys.map((key, index) => {
        const originalPos = currentPositions[index] || {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          noteColor: "#FFFFFF",
          noteOpacity: 80,
        };
        const position = displayPositions[index] || originalPos;
        const trackStartY = position.dy; // 키 위치를 트랙 시작점으로 사용

        return {
          trackKey: key,
          position: { ...position, dy: trackStartY },
          width: position.width,
          height: trackHeight,
          noteColor: position.noteColor || "#FFFFFF",
          noteOpacity: position.noteOpacity || 80,
          flowSpeed: noteSettings.speed,
          borderRadius: noteSettings.borderRadius,
        };
      }),
    [
      currentKeys,
      currentPositions,
      displayPositions,
      trackHeight,
      noteSettings.speed,
      noteSettings.borderRadius,
    ]
  );

  // 성능 측정
  // useEffect(() => {
  //   // 렌더링 후 latency 측정
  //   if (lastPressTimestamp.current > 0 && isMeasuring) {
  //     requestAnimationFrame(() => {
  //       const paintTimestamp = Date.now();
  //       const latency = paintTimestamp - lastPressTimestamp.current;
  //       lastPressTimestamp.current = 0; // 타임스탬프를 사용한 직후 초기화

  //       // 비정상적인 값 (1초 초과)은 무시
  //       if (latency > 1000) {
  //         return;
  //       }

  //       // 최근 100개 데이터만 유지
  //       setLatencies((prev) => [
  //         ...prev.slice(prev.length >= 100 ? 1 : 0),
  //         latency,
  //       ]);
  //       setRecentLatencies((prev) => [latency, ...prev.slice(0, 4)]); // 최근 5개 유지
  //     });
  //   } else if (lastPressTimestamp.current > 0) {
  //     // 측정이 중단되었어도 timestamp는 초기화해야 함
  //     lastPressTimestamp.current = 0;
  //   }
  // }, [originalKeyStates, isMeasuring]);

  // Latency 통계 계산
  // useEffect(() => {
  //   if (latencies.length === 0) {
  //     setStats({ avg: 0, min: 0, max: 0, count: 0 });
  //     return;
  //   }

  //   const sum = latencies.reduce((a, b) => a + b, 0);
  //   const avg = (sum / latencies.length).toFixed(2);
  //   const min = Math.min(...latencies);
  //   const max = Math.max(...latencies);
  //   const count = latencies.length;

  //   setStats({ avg, min, max, count });
  // }, [latencies]);

  // const handleToggleMeasurement = () => {
  //   setIsMeasuring((prev) => !prev);
  // };

  // const handleResetStats = () => {
  //   setLatencies([]);
  //   setRecentLatencies([]);
  // };

  useEffect(() => {
    const keyModeListener = (e, mode) => {
      setKeyMode(mode);
    };

    // getCurrentMode 응답 처리 (최초 동기화 보장)
    const currentModeListener = (e, mode) => {
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

    const noteSettingsListener = (e, settings) => {
      setNoteSettings(settings);
    };

    // const showKeyCountListener = (_, value) => {
    //   setShowKeyCount(value);
    // };

    // 이벤트 리스너 등록
    ipcRenderer.on("keyState", keyStateListener);
    ipcRenderer.on("keyModeChanged", keyModeListener);
    ipcRenderer.on("currentMode", currentModeListener);
    ipcRenderer.on("updateKeyMappings", keyMappingsListener);
    ipcRenderer.on("updateKeyPositions", positionsListener);
    ipcRenderer.on("updateBackgroundColor", backgroundColorListener);
    ipcRenderer.on("update-note-settings", noteSettingsListener);
    // ipcRenderer.on('update-show-key-count', showKeyCountListener);

    // 초기 데이터 요청 (리스너 등록 후 요청하여 레이스 방지)
    ipcRenderer.send("getCurrentMode");
    ipcRenderer.send("getKeyMappings");
    ipcRenderer.send("getKeyPositions");
    ipcRenderer.send("getBackgroundColor");
    ipcRenderer
      .invoke("get-note-settings")
      .then((settings) => {
        setNoteSettings(settings);
      })
      .catch(() => {});
    // ipcRenderer.send('get-show-key-count');

    return () => {
      ipcRenderer.removeAllListeners("keyState");
      ipcRenderer.removeAllListeners("keyModeChanged");
      ipcRenderer.removeAllListeners("currentMode");
      ipcRenderer.removeAllListeners("updateKeyMappings");
      ipcRenderer.removeAllListeners("updateKeyPositions");
      ipcRenderer.removeAllListeners("updateBackgroundColor");
      ipcRenderer.removeAllListeners("update-note-settings");
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
      {/* <LatencyDisplay
        stats={stats}
        recentLatencies={recentLatencies}
        isMeasuring={isMeasuring}
        onToggle={handleToggleMeasurement}
        onReset={handleResetStats}
      /> */}

      {/* 노트 효과 공간 시각화 (투명 영역 확보) */}
      {/* {noteEffectEnabled && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: `${TRACK_RESERVE + PADDING}px`,
            pointerEvents: "none",
          }}
        />
      )} */}

      {/* WebGL 노트 렌더링 */}
      {noteEffectEnabled && (
        <WebGLTracks
          tracks={webglTracks}
          notesRef={notesRef}
          subscribe={subscribe}
          noteSettings={noteSettings}
        />
      )}

      {currentKeys.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const position = displayPositions[index] ||
          currentPositions[index] || {
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
