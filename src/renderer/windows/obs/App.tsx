import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useObsWebSocket } from '@hooks/obs/useObsWebSocket';
import { useNoteSystem } from '@hooks/overlay/useNoteSystem';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import {
  mergeNoteSettings,
  NOTE_SETTINGS_DEFAULTS,
} from '@src/types/settings/noteSettings';
import {
  setKeyActive as setKeyActiveSignal,
  resetAllKeySignals,
} from '@stores/signals/keySignals';
import { applyCounterSnapshot } from '@stores/signals/keyCounterSignals';
import { applyStatsSnapshot } from '@stores/signals/statsSignals';
import OverlayScene, {
  FALLBACK_POSITION,
} from '@components/shared/OverlayScene';
import type { BootstrapPayload } from '@src/types/app';
import type { KeyEventPayload } from '@src/types/obs';
import type { KeyMappings, KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import { DEFAULT_NOTE_BORDER_RADIUS } from '@constants/overlayDefaults';

const PADDING = 30;

export default function App() {
  // WS 연결 URL: HTTP로 서빙된 경우 같은 호스트:포트, 아닌 경우 query param fallback
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') || window.location.hostname || '127.0.0.1';
  const port = params.get('port') || window.location.port || '34891';
  const wsUrl = `ws://${host}:${port}`;

  // 상태
  const [keyMappings, setKeyMappings] = useState<KeyMappings>({});
  const [positions, setPositions] = useState<KeyPositions>({});
  const [statPositions, setStatPositions] = useState<StatItemPositions>({});
  const [graphPositions, setGraphPositions] = useState<GraphItemPositions>({});
  const [selectedKeyType, setSelectedKeyType] = useState('4key');
  const [noteEffect, setNoteEffect] = useState(true);
  const [noteSettings, setNoteSettings] = useState<NoteSettings>(
    NOTE_SETTINGS_DEFAULTS,
  );
  const [backgroundColor, setBackgroundColor] = useState('transparent');
  const [keyCounterEnabled, setKeyCounterEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 노트 시스템
  const {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
    noteBuffer,
    updateTrackLayouts,
  } = useNoteSystem({ noteEffect, noteSettings });

  // handleKeyDown/handleKeyUp를 ref로 유지
  const handleKeyDownRef = useRef(handleKeyDown);
  const handleKeyUpRef = useRef(handleKeyUp);
  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown;
    handleKeyUpRef.current = handleKeyUp;
  }, [handleKeyDown, handleKeyUp]);

  // 스냅샷 수신
  const onSnapshot = useCallback((payload: BootstrapPayload) => {
    setKeyMappings(payload.keys ?? {});
    setPositions(payload.positions ?? {});
    setStatPositions(payload.statPositions ?? {});
    setGraphPositions(payload.graphPositions ?? {});
    setSelectedKeyType(payload.selectedKeyType ?? '4key');

    const settings = payload.settings;
    if (settings) {
      setNoteEffect(settings.noteEffect ?? true);
      setNoteSettings(
        mergeNoteSettings(
          settings.noteSettings ?? NOTE_SETTINGS_DEFAULTS,
          null,
        ),
      );
      setBackgroundColor(settings.backgroundColor ?? 'transparent');
      setKeyCounterEnabled(settings.keyCounterEnabled ?? false);
    }

    // 카운터 초기화
    if (payload.keyCounters) {
      applyCounterSnapshot(payload.keyCounters);
    }

    // 통계 초기화
    applyStatsSnapshot({ kps: 0, kpsAvg: 0, kpsMax: 0, total: 0 });

    resetAllKeySignals();
    setInitialized(true);
  }, []);

  // 키 이벤트 수신
  const onKeyEvent = useCallback((payload: KeyEventPayload) => {
    const { key, state } = payload;
    const isDown = state === 'DOWN';
    setKeyActiveSignal(key, isDown);

    if (isDown) {
      requestAnimationFrame(() => handleKeyDownRef.current(key));
    } else {
      requestAnimationFrame(() => handleKeyUpRef.current(key));
    }
  }, []);

  // 설정 변경
  const onSettingsDiff = useCallback((diff: Record<string, unknown>) => {
    if ('noteEffect' in diff) setNoteEffect(diff.noteEffect as boolean);
    if ('noteSettings' in diff)
      setNoteSettings((prev) =>
        mergeNoteSettings(
          { ...prev, ...(diff.noteSettings as Partial<NoteSettings>) },
          null,
        ),
      );
    if ('backgroundColor' in diff)
      setBackgroundColor(diff.backgroundColor as string);
    if ('keyCounterEnabled' in diff)
      setKeyCounterEnabled(diff.keyCounterEnabled as boolean);
  }, []);

  // 카운터 업데이트
  const onCounterUpdate = useCallback((data: Record<string, unknown>) => {
    applyCounterSnapshot(data as Record<string, Record<string, number>>);
  }, []);

  useObsWebSocket({
    url: wsUrl,
    onSnapshot,
    onKeyEvent,
    onSettingsDiff,
    onCounterUpdate,
  });

  // 현재 모드 데이터
  const currentKeys = keyMappings[selectedKeyType] ?? [];
  const currentPositions = positions[selectedKeyType] ?? [];
  const currentStatPositions = statPositions[selectedKeyType] ?? [];
  const currentGraphPositions = graphPositions[selectedKeyType] ?? [];

  const trackHeight =
    noteSettings?.trackHeight ?? DEFAULT_NOTE_SETTINGS.trackHeight;

  // bounds 계산
  const bounds = (() => {
    if (
      !currentPositions.length &&
      !currentStatPositions.length &&
      !currentGraphPositions.length
    )
      return null;

    const xs: number[] = [];
    const ys: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];

    currentPositions.forEach((pos) => {
      if (pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + pos.width);
      heights.push(pos.dy + pos.height);
    });

    currentStatPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 60));
      heights.push(pos.dy + (pos.height ?? 60));
    });

    currentGraphPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 200));
      heights.push(pos.dy + (pos.height ?? 100));
    });

    if (xs.length === 0) return null;

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...widths),
      maxY: Math.max(...heights),
    };
  })();

  // 표시 위치 계산
  const displayPositions = (() => {
    if (!bounds || !currentPositions.length) return currentPositions;
    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;
    return currentPositions.map((pos) => ({
      ...pos,
      dx: pos.dx + offsetX,
      dy: pos.dy + offsetY,
    }));
  })();

  const displayStatPositions = (() => {
    if (!bounds || !currentStatPositions.length) return currentStatPositions;
    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;
    return currentStatPositions.map((pos) => ({
      ...pos,
      dx: pos.dx + offsetX,
      dy: pos.dy + offsetY,
    }));
  })();

  const displayGraphPositions = (() => {
    if (!bounds || !currentGraphPositions.length) return currentGraphPositions;
    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;
    return currentGraphPositions.map((pos) => ({
      ...pos,
      dx: pos.dx + offsetX,
      dy: pos.dy + offsetY,
    }));
  })();

  const topMostY = bounds ? trackHeight + PADDING : 0;

  // WebGL 트랙 계산
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index] ?? FALLBACK_POSITION;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      const trackStartY = useAutoCorrection ? topMostY : position.dy;
      const keyWidth = position.width;
      const desiredNoteWidth =
        typeof position.noteWidth === 'number' &&
        Number.isFinite(position.noteWidth)
          ? Math.max(1, Math.round(position.noteWidth))
          : keyWidth;
      const noteOffsetX = (keyWidth - desiredNoteWidth) / 2;

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: position.dx + noteOffsetX,
          dy: trackStartY,
        },
        width: desiredNoteWidth,
        height: trackHeight,
        noteColor: position.noteColor,
        noteOpacity: position.noteOpacity,
        noteOpacityTop: position.noteOpacityTop ?? position.noteOpacity,
        noteOpacityBottom: position.noteOpacityBottom ?? position.noteOpacity,
        noteGlowEnabled: position.noteGlowEnabled ?? false,
        noteGlowSize: position.noteGlowSize ?? 20,
        noteGlowOpacity: position.noteGlowOpacity ?? 70,
        noteGlowOpacityTop:
          position.noteGlowOpacityTop ?? position.noteGlowOpacity ?? 70,
        noteGlowOpacityBottom:
          position.noteGlowOpacityBottom ?? position.noteGlowOpacity ?? 70,
        noteGlowColor: position.noteGlowColor ?? position.noteColor,
        flowSpeed: noteSettings?.speed ?? DEFAULT_NOTE_SETTINGS.speed,
        borderRadius: position.noteBorderRadius ?? DEFAULT_NOTE_BORDER_RADIUS,
      };
    })
    .filter(Boolean);

  useEffect(() => {
    updateTrackLayouts(webglTracks);
  }, [webglTracks, updateTrackLayouts]);

  if (!initialized) {
    return (
      <div
        className="flex items-center justify-center w-full h-screen"
        style={{ backgroundColor: 'transparent' }}
      >
        <div className="text-white/40 text-sm">Connecting...</div>
      </div>
    );
  }

  return (
    <OverlayScene
      currentKeys={currentKeys}
      displayPositions={displayPositions}
      currentPositions={currentPositions}
      displayStatPositions={displayStatPositions}
      displayGraphPositions={displayGraphPositions}
      selectedKeyType={selectedKeyType}
      noteEffect={noteEffect}
      noteSettings={noteSettings}
      webglTracks={webglTracks}
      notesRef={notesRef}
      subscribe={subscribe}
      noteBuffer={noteBuffer}
      backgroundColor={backgroundColor}
      keyCounterEnabled={keyCounterEnabled}
      showPluginElements={false}
    />
  );
}
