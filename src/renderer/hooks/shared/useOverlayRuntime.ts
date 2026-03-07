import { useCallback, useEffect, useRef, useState } from 'react';
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
import { computeLayout } from '@hooks/shared/useLayoutComputation';
import type { BootstrapPayload } from '@src/types/app';
import type { KeyEventPayload } from '@src/types/obs';
import type {
  KeyMappings,
  KeyPosition,
  KeyPositions,
} from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { CustomCss } from '@src/types/plugin/css';

const OBS_CUSTOM_CSS_ID = 'dmn-obs-custom-css';

// ── 콜백 타입 (데이터 소스가 호출) ──

export interface OverlayRuntimeHandlers {
  onSnapshot: (payload: BootstrapPayload) => void;
  onKeyEvent: (payload: KeyEventPayload) => void;
  onSettingsDiff: (diff: Record<string, unknown>) => void;
  onCounterUpdate: (data: Record<string, unknown>) => void;
}

// ── 훅 ──

export function useOverlayRuntime() {
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

  // 커스텀 CSS DOM 주입
  const cssStateRef = useRef({ enabled: false, content: '' });
  const cssStyleElRef = useRef<HTMLStyleElement | null>(null);

  const applyCssToDOM = useCallback(() => {
    let el = cssStyleElRef.current;
    if (!el) {
      el = document.getElementById(
        OBS_CUSTOM_CSS_ID,
      ) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = OBS_CUSTOM_CSS_ID;
        document.head.appendChild(el);
      }
      cssStyleElRef.current = el;
    }
    const { enabled, content } = cssStateRef.current;
    if (enabled && content) {
      el.textContent = content;
      el.disabled = false;
    } else {
      el.textContent = '';
      el.disabled = true;
    }
  }, []);

  // 노트 시스템
  const {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
    noteBuffer,
    updateTrackLayouts,
  } = useNoteSystem({ noteEffect, noteSettings });

  // ref로 최신 값 유지 (useCallback 안에서 참조)
  const handleKeyDownRef = useRef(handleKeyDown);
  const handleKeyUpRef = useRef(handleKeyUp);
  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown;
    handleKeyUpRef.current = handleKeyUp;
  }, [handleKeyDown, handleKeyUp]);

  const selectedKeyTypeRef = useRef(selectedKeyType);
  useEffect(() => {
    selectedKeyTypeRef.current = selectedKeyType;
  }, [selectedKeyType]);

  const keyMappingsRef = useRef<string[]>([]);
  const positionsRef = useRef<KeyPosition[]>([]);
  useEffect(() => {
    keyMappingsRef.current = keyMappings[selectedKeyType] ?? [];
    positionsRef.current = positions[selectedKeyType] ?? [];
  }, [keyMappings, positions, selectedKeyType]);

  // 키 딜레이
  const keyDisplayDelayMsRef = useRef(0);
  const keyDelayTimersRef = useRef<
    Map<string, { timers: Set<ReturnType<typeof setTimeout>> }>
  >(new Map());

  useEffect(() => {
    keyDisplayDelayMsRef.current = Number(noteSettings?.keyDisplayDelayMs ?? 0);
  }, [noteSettings?.keyDisplayDelayMs]);

  useEffect(() => {
    const timers = keyDelayTimersRef.current;
    return () => {
      timers.forEach((entry) => {
        entry.timers.forEach((timer) => clearTimeout(timer));
      });
      timers.clear();
    };
  }, []);

  // KPS 로컬 계산 (1초 슬라이딩 윈도우)
  const kpsRef = useRef({
    timestamps: [] as number[],
    total: 0,
    kpsMax: 0,
    kpsSumForAvg: 0,
    kpsNonZeroCount: 0,
    activeKeys: new Set<string>(),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const tracker = kpsRef.current;
      const now = performance.now();
      while (
        tracker.timestamps.length > 0 &&
        now - tracker.timestamps[0] > 1000
      ) {
        tracker.timestamps.shift();
      }
      const kps = tracker.timestamps.length;
      if (kps > tracker.kpsMax) tracker.kpsMax = kps;
      if (kps > 0) {
        tracker.kpsSumForAvg += kps;
        tracker.kpsNonZeroCount++;
      }
      const kpsAvg =
        tracker.kpsNonZeroCount > 0
          ? Math.round(tracker.kpsSumForAvg / tracker.kpsNonZeroCount)
          : 0;
      applyStatsSnapshot({
        kps,
        kpsAvg,
        kpsMax: tracker.kpsMax,
        total: tracker.total,
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // 키 딜레이 적용 신호 업데이트
  const updateKeySignalWithDelay = useCallback(
    (key: string, isDown: boolean) => {
      const delayMs = keyDisplayDelayMsRef.current;

      let timerEntry = keyDelayTimersRef.current.get(key);
      if (!timerEntry) {
        timerEntry = { timers: new Set() };
        keyDelayTimersRef.current.set(key, timerEntry);
      }

      if (delayMs <= 0) {
        timerEntry.timers.forEach((timer) => clearTimeout(timer));
        timerEntry.timers.clear();
        setKeyActiveSignal(key, isDown);
        return;
      }

      const timer = setTimeout(() => {
        setKeyActiveSignal(key, isDown);
        timerEntry?.timers.delete(timer);
      }, delayMs);
      timerEntry.timers.add(timer);
    },
    [],
  );

  // ── 데이터 소스 콜백 ──

  const onSnapshot = useCallback(
    (payload: BootstrapPayload) => {
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

        // 커스텀 CSS
        cssStateRef.current = {
          enabled: settings.useCustomCSS ?? false,
          content: (settings.customCSS as CustomCss | undefined)?.content ?? '',
        };
        applyCssToDOM();
      }

      // 카운터 초기화
      if (payload.keyCounters) {
        applyCounterSnapshot(payload.keyCounters);
      }

      // KPS 트래커 리셋
      const tracker = kpsRef.current;
      tracker.timestamps = [];
      tracker.kpsMax = 0;
      tracker.kpsSumForAvg = 0;
      tracker.kpsNonZeroCount = 0;
      tracker.activeKeys.clear();
      let totalFromCounters = 0;
      if (payload.keyCounters) {
        const modeCounters =
          payload.keyCounters[payload.selectedKeyType ?? '4key'];
        if (modeCounters) {
          totalFromCounters = Object.values(modeCounters).reduce(
            (sum, v) => sum + v,
            0,
          );
        }
      }
      tracker.total = totalFromCounters;
      applyStatsSnapshot({
        kps: 0,
        kpsAvg: 0,
        kpsMax: 0,
        total: totalFromCounters,
      });

      // 딜레이 타이머 정리
      keyDelayTimersRef.current.forEach((entry) => {
        entry.timers.forEach((timer) => clearTimeout(timer));
        entry.timers.clear();
      });

      // ref 즉시 동기화
      const mode = payload.selectedKeyType ?? '4key';
      selectedKeyTypeRef.current = mode;
      keyMappingsRef.current = (payload.keys ?? {})[mode] ?? [];
      positionsRef.current = (payload.positions ?? {})[mode] ?? [];
      if (payload.settings?.noteSettings) {
        keyDisplayDelayMsRef.current = Number(
          payload.settings.noteSettings.keyDisplayDelayMs ?? 0,
        );
      }

      resetAllKeySignals();
      setInitialized(true);
    },
    [applyCssToDOM],
  );

  const onKeyEvent = useCallback(
    (payload: KeyEventPayload) => {
      const { key, state } = payload;
      const isDown = state === 'DOWN';

      updateKeySignalWithDelay(key, isDown);

      // KPS
      const tracker = kpsRef.current;
      if (isDown) {
        if (!tracker.activeKeys.has(key)) {
          tracker.activeKeys.add(key);
          tracker.timestamps.push(performance.now());
          tracker.total++;
        }
        const keys = keyMappingsRef.current;
        const pos = positionsRef.current;
        const keyIndex = keys.indexOf(key);
        const keyPosition = pos[keyIndex];
        if (keyPosition?.noteEffectEnabled !== false) {
          requestAnimationFrame(() => handleKeyDownRef.current(key));
        }
      } else {
        tracker.activeKeys.delete(key);
        requestAnimationFrame(() => handleKeyUpRef.current(key));
      }
    },
    [updateKeySignalWithDelay],
  );

  const onSettingsDiff = useCallback(
    (diff: Record<string, unknown>) => {
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

      // 커스텀 CSS
      let cssChanged = false;
      if ('useCustomCSS' in diff) {
        cssStateRef.current.enabled = diff.useCustomCSS as boolean;
        cssChanged = true;
      }
      if ('customCSS' in diff) {
        const css = diff.customCSS as Partial<CustomCss> | undefined;
        if (css?.content !== undefined) {
          cssStateRef.current.content = css.content;
          cssChanged = true;
        }
      }
      if (cssChanged) applyCssToDOM();
    },
    [applyCssToDOM],
  );

  const onCounterUpdate = useCallback((data: Record<string, unknown>) => {
    const counters = data as Record<string, Record<string, number>>;
    applyCounterSnapshot(counters);
    const modeCounters = counters[selectedKeyTypeRef.current];
    if (modeCounters) {
      kpsRef.current.total = Object.values(modeCounters).reduce(
        (sum, v) => sum + v,
        0,
      );
    }
  }, []);

  // ── 레이아웃 계산 ──

  const currentKeys = keyMappings[selectedKeyType] ?? [];
  const currentPositions = positions[selectedKeyType] ?? [];
  const currentStatPositions = statPositions[selectedKeyType] ?? [];
  const currentGraphPositions = graphPositions[selectedKeyType] ?? [];

  const trackHeight =
    noteSettings?.trackHeight ?? DEFAULT_NOTE_SETTINGS.trackHeight;

  const {
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    webglTracks,
  } = computeLayout({
    currentKeys,
    currentPositions,
    currentStatPositions,
    currentGraphPositions,
    trackHeight,
    noteSettings,
  });

  useEffect(() => {
    updateTrackLayouts(webglTracks);
  }, [webglTracks, updateTrackLayouts]);

  return {
    // 데이터 소스 콜백
    handlers: {
      onSnapshot,
      onKeyEvent,
      onSettingsDiff,
      onCounterUpdate,
    } satisfies OverlayRuntimeHandlers,

    // OverlayScene props
    sceneProps: {
      currentKeys,
      displayPositions,
      currentPositions,
      displayStatPositions,
      displayGraphPositions,
      selectedKeyType,
      noteEffect,
      noteSettings,
      webglTracks,
      notesRef,
      subscribe,
      noteBuffer,
      backgroundColor,
      keyCounterEnabled,
      showPluginElements: false as const,
    },

    initialized,
  };
}
