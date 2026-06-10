/* eslint-disable react-hooks/purity */
import { useRef, useEffect } from 'react';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import {
  createNoteBuffer,
  NoteBuffer,
  TrackLayoutInput,
} from '@stores/signals/noteBuffer';

interface Note {
  id: string;
  keyName: string;
  startTime: number;
  endTime: number | null;
  isActive: boolean;
}

interface NoteEvent {
  type: 'add' | 'finalize' | 'cleanup' | 'clear';
  note?: Note | { ids: string[] };
  slot?: number;
  activeCount?: number;
  version?: number;
}

type NoteSubscriber = (event: NoteEvent) => void;

interface NoteState {
  useDelay: boolean;
  downTime?: number;
  releaseTime: number | null;
  startTime: number | null;
  startTimer: ReturnType<typeof setTimeout> | null;
  finalizeTimer: ReturnType<typeof setTimeout> | null;
  noteId: string | null;
  created: boolean;
  released: boolean;
  delayMs?: number;
  releasedBeforeStart?: boolean;
}

interface NoteSettings {
  speed?: number;
  trackHeight?: number;
  delayedNoteEnabled?: boolean;
  shortNoteThresholdMs?: number;
  shortNoteMinLengthPx?: number;
}

interface UseNoteSystemOptions {
  noteEffect: boolean;
  noteSettings?: NoteSettings;
}

interface UseNoteSystemReturn {
  notesRef: React.MutableRefObject<Record<string, Note[]>>;
  subscribe: (callback: NoteSubscriber) => () => void;
  handleKeyDown: (keyName: string) => void;
  handleKeyUp: (keyName: string) => void;
  finalizeAllActive: () => void;
  noteBuffer: NoteBuffer;
  updateTrackLayouts: (layouts: TrackLayoutInput[]) => void;
}

const acquireNote = (pool: Note[]): Note => {
  const note = pool.pop();
  if (note) {
    return note;
  }
  return {
    id: '',
    keyName: '',
    startTime: 0,
    endTime: null,
    isActive: false,
  };
};

const releaseNote = (note: Note, pool: Note[]): void => {
  note.id = '';
  note.keyName = '';
  note.startTime = 0;
  note.endTime = null;
  note.isActive = false;
  pool.push(note);
};

const releaseAllNotes = (
  notesByKey: Record<string, Note[]>,
  pool: Note[],
  lookup: Map<string, Note>,
): void => {
  const keys = Object.keys(notesByKey);
  for (const keyName of keys) {
    const keyNotes = notesByKey[keyName];
    if (!keyNotes) {
      delete notesByKey[keyName];
      continue;
    }
    for (const note of keyNotes) {
      if (!note) continue;
      lookup.delete(note.id);
      releaseNote(note, pool);
    }
    keyNotes.length = 0;
    delete notesByKey[keyName];
  }
};

export function useNoteSystem({
  noteEffect,
  noteSettings,
}: UseNoteSystemOptions): UseNoteSystemReturn {
  const notesRef = useRef<Record<string, Note[]>>({});
  const noteEffectEnabled = useRef<boolean>(true);
  const activeNotes = useRef<Map<string, NoteState[]>>(new Map());
  const flowSpeedRef = useRef<number>(DEFAULT_NOTE_SETTINGS.speed);
  const trackHeightRef = useRef<number>(DEFAULT_NOTE_SETTINGS.trackHeight);
  // 딜레이 기반 단노트 분리용 설정
  const delayEnabledRef = useRef<boolean>(false);
  const delayMsRef = useRef<number>(0);
  const shortNoteMinLengthPxRef = useRef<number>(0);
  const subscribers = useRef<Set<NoteSubscriber>>(new Set());
  const notePoolRef = useRef<Note[]>([]);
  const noteLookupRef = useRef<Map<string, Note>>(new Map());
  const noteBufferRef = useRef<NoteBuffer>(createNoteBuffer());
  const finalizeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // 이벤트 기반 클린업을 위한 refs
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCleanupTimeRef = useRef<number>(Infinity);

  const notifySubscribers = (event: NoteEvent): void => {
    if (subscribers.current.size === 0) return;
    subscribers.current.forEach((callback) => callback(event));
  };

  const subscribe = (callback: NoteSubscriber): (() => void) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  };

  // In-place 클린업 함수
  const runCleanup = (): void => {
    const currentTime = performance.now();
    const flowSpeed = flowSpeedRef.current;
    const trackHeight =
      trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;
    const currentNotes = notesRef.current;
    const removedNoteIds: string[] = [];
    const removedNotes: Note[] = [];
    let hasChanges = false;

    // 각 keyName에 대해 in-place로 배열 정리
    for (const keyName in currentNotes) {
      const keyNotes = currentNotes[keyName];
      if (!keyNotes || keyNotes.length === 0) {
        delete currentNotes[keyName];
        hasChanges = true;
        continue;
      }

      let writeIndex = 0; // 유지할 노트를 쓸 위치
      for (let readIndex = 0; readIndex < keyNotes.length; readIndex++) {
        const note = keyNotes[readIndex];
        let shouldKeep = true;

        // 활성화된 노트는 항상 유지
        if (!note.isActive) {
          // 완료된 노트가 화면 밖으로 나갔는지 확인
          const timeSinceCompletion = currentTime - (note.endTime as number);
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
          shouldKeep = yPosition < trackHeight + 200;

          if (!shouldKeep) {
            const removedId = note.id;
            removedNoteIds.push(removedId);
            noteLookupRef.current.delete(removedId);
            removedNotes.push(note);
            hasChanges = true;
          }
        }

        if (shouldKeep) {
          if (writeIndex !== readIndex) {
            keyNotes[writeIndex] = note;
          }
          writeIndex++;
        }
      }

      // 배열 길이 조정
      if (writeIndex < keyNotes.length) {
        keyNotes.length = writeIndex;
        hasChanges = true;
      }

      // 빈 배열이면 키 제거
      if (keyNotes.length === 0) {
        delete currentNotes[keyName];
      }
    }

    // 클린업 상태 초기화
    cleanupTimerRef.current = null;
    nextCleanupTimeRef.current = Infinity;

    // 구독자에게 알림
    if (removedNoteIds.length > 0) {
      const buffer = noteBufferRef.current;
      buffer.releaseBatch(removedNoteIds);
    }

    if (hasChanges && removedNoteIds.length > 0) {
      notifySubscribers({
        type: 'cleanup',
        note: { ids: removedNoteIds },
        activeCount: noteBufferRef.current.activeCount,
        version: noteBufferRef.current.version,
      });
    }

    if (removedNotes.length > 0) {
      const pool = notePoolRef.current;
      for (const note of removedNotes) {
        releaseNote(note, pool);
      }
    }

    // 다음 클린업 스케줄링: 남은 비활성 노트 중 가장 먼저 사라질 노트 찾기
    let earliestCleanupTime = Infinity;
    for (const keyName in currentNotes) {
      const keyNotes = currentNotes[keyName];
      if (!keyNotes) continue;

      for (const note of keyNotes) {
        if (!note.isActive && note.endTime != null) {
          // 이 노트가 화면 밖으로 나갈 시간 계산
          const travelTimeMs = ((trackHeight + 200) * 1000) / flowSpeed;
          const cleanupTime = note.endTime + travelTimeMs;
          if (cleanupTime < earliestCleanupTime) {
            earliestCleanupTime = cleanupTime;
          }
        }
      }
    }

    // 다음 클린업이 필요하면 스케줄
    if (earliestCleanupTime < Infinity) {
      const delay = Math.max(0, earliestCleanupTime - performance.now());
      cleanupTimerRef.current = setTimeout(runCleanup, delay);
      nextCleanupTimeRef.current = earliestCleanupTime;
    }
  };

  // 이벤트 기반 클린업 스케줄러
  const scheduleCleanup = (finalizedNote: Note): void => {
    if (!finalizedNote || !finalizedNote.endTime) return;

    const flowSpeed = flowSpeedRef.current;
    const trackHeight =
      trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;

    // 이 노트가 화면 밖으로 완전히 사라질 시간 계산
    const travelTimeMs = ((trackHeight + 200) * 1000) / flowSpeed;
    const newCleanupTime = finalizedNote.endTime + travelTimeMs;

    // 현재 예약된 것보다 더 빨리 실행해야 하는 경우에만 재스케줄
    if (newCleanupTime < nextCleanupTimeRef.current) {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
      }
      const delay = Math.max(0, newCleanupTime - performance.now());
      cleanupTimerRef.current = setTimeout(runCleanup, delay);
      nextCleanupTimeRef.current = newCleanupTime;
    }
  };

  useEffect(() => {
    const settings = noteSettings || DEFAULT_NOTE_SETTINGS;
    flowSpeedRef.current =
      Number(settings?.speed) || DEFAULT_NOTE_SETTINGS.speed;
    trackHeightRef.current =
      Number(settings?.trackHeight) || DEFAULT_NOTE_SETTINGS.trackHeight;
    // 지연 기반 단/롱 노트 처리
    delayEnabledRef.current = !!settings?.delayedNoteEnabled;
    // 설정에서 짧은 노트 분리 대기(ms) - 이름은 shortNoteThresholdMs로 사용됨
    delayMsRef.current = Number(settings?.shortNoteThresholdMs) || 0;
    // 단노트 최소 픽셀 길이
    shortNoteMinLengthPxRef.current =
      Number(settings?.shortNoteMinLengthPx) || 0;
  }, [noteSettings]);

  useEffect(() => {
    noteEffectEnabled.current = !!noteEffect;
    if (!noteEffect) {
      // 클린업 타이머 취소
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
        nextCleanupTimeRef.current = Infinity;
      }
      releaseAllNotes(
        notesRef.current,
        notePoolRef.current,
        noteLookupRef.current,
      );
      noteLookupRef.current.clear();
      // activeNotes에 남아있는 타이머 정리
      for (const [, stateList] of activeNotes.current.entries()) {
        if (!Array.isArray(stateList)) continue;
        for (const state of stateList) {
          try {
            if (state?.startTimer) {
              clearTimeout(state.startTimer);
              state.startTimer = null;
            }
            if (state?.finalizeTimer) {
              clearTimeout(state.finalizeTimer);
              state.finalizeTimer = null;
            }
          } catch {}
        }
      }
      activeNotes.current.clear();
      for (const timer of finalizeTimersRef.current.values()) {
        try {
          clearTimeout(timer);
        } catch {}
      }
      finalizeTimersRef.current.clear();
      noteBufferRef.current.clear();
      notifySubscribers({
        type: 'clear',
        activeCount: 0,
        version: noteBufferRef.current.version,
      });
    }
  }, [noteEffect]);

  const createNote = (keyName: string, startTimeOverride?: number): string => {
    const startTime = startTimeOverride ?? performance.now();
    const noteId = `${keyName}_${startTime}`;
    const currentNotes = notesRef.current;
    let keyNotes = currentNotes[keyName];
    if (!keyNotes) {
      keyNotes = [];
      currentNotes[keyName] = keyNotes;
    }

    const newNote = acquireNote(notePoolRef.current);
    newNote.id = noteId;
    newNote.keyName = keyName;
    newNote.startTime = startTime;
    newNote.endTime = null;
    newNote.isActive = true;

    keyNotes.push(newNote);
    noteLookupRef.current.set(noteId, newNote);

    const slot = noteBufferRef.current.allocate(keyName, noteId, startTime);
    if (slot >= 0) {
      notifySubscribers({
        type: 'add',
        note: newNote,
        slot,
        activeCount: noteBufferRef.current.activeCount,
        version: noteBufferRef.current.version,
      });
    } else {
      notifySubscribers({ type: 'add', note: newNote });
    }
    return noteId;
  };

  const finalizeNote = (
    keyName: string,
    noteId: string,
    endTimeOverride?: number,
  ): void => {
    const endTime = endTimeOverride ?? performance.now();
    const note = noteLookupRef.current.get(noteId);
    if (!note || note.keyName !== keyName || !note.isActive) return;

    note.endTime = endTime;
    note.isActive = false;
    const slot = noteBufferRef.current.finalize(noteId, endTime);
    notifySubscribers({
      type: 'finalize',
      note,
      slot,
      activeCount: noteBufferRef.current.activeCount,
      version: noteBufferRef.current.version,
    });
    // 이벤트 기반 클린업 스케줄링
    scheduleCleanup(note);
  };

  const removeState = (keyName: string, state: NoteState): void => {
    const stateList = activeNotes.current.get(keyName);
    if (!stateList) return;
    const index = stateList.indexOf(state);
    if (index === -1) return;
    stateList.splice(index, 1);
    if (stateList.length === 0) {
      activeNotes.current.delete(keyName);
    }
  };

  const computeMinLengthMs = (): number => {
    const minPx = shortNoteMinLengthPxRef.current || 0;
    const flowSpeed = flowSpeedRef.current || DEFAULT_NOTE_SETTINGS.speed;
    if (minPx <= 0 || flowSpeed <= 0) return 0;
    return Math.round((minPx * 1000) / flowSpeed);
  };

  const scheduleNoteFinalization = (
    keyName: string,
    state: NoteState,
    options: { forceMinLength?: boolean } = {},
  ): void => {
    const { forceMinLength = false } = options;
    if (!state?.noteId || state.startTime == null) return;

    const releaseTime = state.releaseTime ?? performance.now();
    const noteRef = state.noteId
      ? noteLookupRef.current.get(state.noteId)
      : null;
    const baselineStart =
      noteRef?.startTime ?? state.startTime ?? state.downTime ?? releaseTime;
    const clampedStart = Math.min(releaseTime, baselineStart);
    const holdDurationFromStart = Math.max(0, releaseTime - clampedStart);
    // delayed mode: 시작 표시가 threshold만큼 지연되므로 실제 입력 유지 시간 기준으로 길이 계산 (종료도 동일하게 지연)
    const physicalHoldMs =
      state.useDelay && state.downTime != null
        ? Math.max(0, releaseTime - state.downTime)
        : holdDurationFromStart;
    const minLengthMs = computeMinLengthMs();
    const desiredDuration = forceMinLength
      ? minLengthMs
      : Math.max(minLengthMs, physicalHoldMs);
    const safeDuration = Math.max(desiredDuration, 1);
    const targetEndTime = state.startTime + safeDuration;

    if (state.finalizeTimer) {
      clearTimeout(state.finalizeTimer);
      finalizeTimersRef.current.delete(state.noteId);
      state.finalizeTimer = null;
    }

    const finalizeState = (): void => {
      finalizeTimersRef.current.delete(state.noteId!);
      state.finalizeTimer = null;
      finalizeNote(keyName, state.noteId!, targetEndTime);
      removeState(keyName, state);
    };

    const delay = Math.max(0, targetEndTime - performance.now());
    if (delay <= 0) {
      finalizeState();
      return;
    }

    const timer = setTimeout(finalizeState, delay);
    state.finalizeTimer = timer;
    finalizeTimersRef.current.set(state.noteId, timer);
  };

  // 노트 생성/완료
  const handleKeyDown = (keyName: string): void => {
    if (!noteEffectEnabled.current) return;

    const useDelay = delayEnabledRef.current && delayMsRef.current > 0;
    let stateList = activeNotes.current.get(keyName);
    if (!stateList) {
      stateList = [];
      activeNotes.current.set(keyName, stateList);
    }

    if (stateList.some((state) => !state.released)) {
      return;
    }

    if (useDelay) {
      const delayMs = delayMsRef.current;
      const downTime = performance.now();
      const state: NoteState = {
        useDelay: true,
        downTime,
        releaseTime: null,
        startTime: null,
        startTimer: null,
        finalizeTimer: null,
        noteId: null,
        created: false,
        released: false,
        delayMs,
        releasedBeforeStart: false,
      };

      const startTimer = setTimeout(() => {
        state.startTimer = null;
        if (!noteEffectEnabled.current) {
          removeState(keyName, state);
          return;
        }

        const overrideStart = state.downTime! + state.delayMs!;
        const noteId = createNote(keyName, overrideStart);
        state.noteId = noteId;
        state.created = true;
        state.startTime = overrideStart;

        if (state.released) {
          const forceMinLength = !!state.releasedBeforeStart;
          scheduleNoteFinalization(keyName, state, { forceMinLength });
          state.releasedBeforeStart = false;
        }
      }, delayMs);

      state.startTimer = startTimer;
      stateList.push(state);
      return;
    }

    const noteId = createNote(keyName);
    const createdNote = noteLookupRef.current.get(noteId);
    const noteStartTime = createdNote?.startTime ?? performance.now();
    stateList.push({
      useDelay: false,
      noteId,
      created: true,
      released: false,
      startTimer: null,
      finalizeTimer: null,
      startTime: noteStartTime,
      releaseTime: null,
    });
  };

  const handleKeyUp = (keyName: string): void => {
    if (!noteEffectEnabled.current) return;

    const stateList = activeNotes.current.get(keyName);
    if (!stateList || stateList.length === 0) return;

    let state: NoteState | null = null;
    for (let i = stateList.length - 1; i >= 0; i -= 1) {
      if (!stateList[i].released) {
        state = stateList[i];
        break;
      }
    }

    if (!state) return;

    const now = performance.now();
    state.released = true;
    state.releaseTime = now;

    if (!state.useDelay) {
      if (state.created && state.noteId) {
        finalizeNote(keyName, state.noteId);
      }
      removeState(keyName, state);
      return;
    }

    if (state.startTimer) {
      state.releasedBeforeStart = true;
      // 아직 노트가 생성되지 않았으므로 타이머가 실행되면 finalize를 스케줄링한다
      return;
    }

    if (state.created && state.noteId) {
      scheduleNoteFinalization(keyName, state);
    }
  };

  // 화면 밖으로 나간 노트 제거 - 언마운트 시 타이머 정리
  useEffect(() => {
    const activeNotesCurrent = activeNotes.current;
    const finalizeTimersCurrent = finalizeTimersRef.current;
    const notesCurrent = notesRef.current;
    const notePoolCurrent = notePoolRef.current;
    const noteLookupCurrent = noteLookupRef.current;
    const noteBufferCurrent = noteBufferRef.current;

    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
      }
      // activeNotes에 남아있는 타이머 정리
      for (const [, stateList] of activeNotesCurrent.entries()) {
        if (!Array.isArray(stateList)) continue;
        for (const state of stateList) {
          try {
            if (state?.startTimer) {
              clearTimeout(state.startTimer);
              state.startTimer = null;
            }
            if (state?.finalizeTimer) {
              clearTimeout(state.finalizeTimer);
              state.finalizeTimer = null;
            }
          } catch {}
        }
      }
      for (const timer of finalizeTimersCurrent.values()) {
        try {
          clearTimeout(timer);
        } catch {}
      }
      finalizeTimersCurrent.clear();

      releaseAllNotes(notesCurrent, notePoolCurrent, noteLookupCurrent);
      noteLookupCurrent.clear();
      noteBufferCurrent.clear();
    };
  }, []);

  // 노트 효과가 꺼져있으면 no-op 함수 반환하여 오버헤드 최소화
  const noOpHandler = (): void => {};
  const effectiveHandleKeyDown = noteEffect ? handleKeyDown : noOpHandler;
  const effectiveHandleKeyUp = noteEffect ? handleKeyUp : noOpHandler;

  // 탭 전환 시 진행 중인 모든 노트 강제 완료
  const finalizeAllActiveRef = useRef<() => void>(() => {});
  finalizeAllActiveRef.current = (): void => {
    for (const [keyName, stateList] of activeNotes.current.entries()) {
      if (!Array.isArray(stateList)) continue;
      for (const state of stateList) {
        if (state?.startTimer) {
          clearTimeout(state.startTimer);
          state.startTimer = null;
        }
        if (state?.finalizeTimer) {
          clearTimeout(state.finalizeTimer);
          if (state.noteId) {
            finalizeTimersRef.current.delete(state.noteId);
          }
          state.finalizeTimer = null;
        }
        if (state?.created && state?.noteId) {
          const forcedEndTime = Math.max(
            performance.now(),
            state.startTime ?? 0,
            state.releaseTime ?? 0,
          );
          finalizeNote(keyName, state.noteId, forcedEndTime);
        }
      }
    }
    activeNotes.current.clear();
  };
  const finalizeAllActive = (): void => finalizeAllActiveRef.current();

  return {
    notesRef,
    subscribe,
    handleKeyDown: effectiveHandleKeyDown,
    handleKeyUp: effectiveHandleKeyUp,
    finalizeAllActive,
    noteBuffer: noteBufferRef.current,
    updateTrackLayouts: (layouts: TrackLayoutInput[]) =>
      noteBufferRef.current.updateTrackLayouts(layouts),
  };
}
