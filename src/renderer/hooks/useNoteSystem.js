import { useCallback, useRef, useEffect } from 'react';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayConfig';
import { createNoteBuffer } from '@stores/noteBuffer';

const acquireNote = (pool) => {
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

const releaseNote = (note, pool) => {
  note.id = '';
  note.keyName = '';
  note.startTime = 0;
  note.endTime = null;
  note.isActive = false;
  pool.push(note);
};

const releaseAllNotes = (notesByKey, pool, lookup) => {
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

export function useNoteSystem({ noteEffect, noteSettings }) {
  const notesRef = useRef({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());
  const flowSpeedRef = useRef(DEFAULT_NOTE_SETTINGS.speed);
  const trackHeightRef = useRef(DEFAULT_NOTE_SETTINGS.trackHeight);
  // 딜레이 기반 단노트 분리용 설정
  const delayEnabledRef = useRef(false);
  const delayMsRef = useRef(0);
  const shortNoteMinLengthPxRef = useRef(0);
  const subscribers = useRef(new Set());
  const notePoolRef = useRef([]);
  const noteLookupRef = useRef(new Map());
  const noteBufferRef = useRef(createNoteBuffer());
  const finalizeTimersRef = useRef(new Map());
  // 이벤트 기반 클린업을 위한 refs
  const cleanupTimerRef = useRef(null);
  const nextCleanupTimeRef = useRef(Infinity);

  const notifySubscribers = useCallback((event) => {
    if (subscribers.current.size === 0) return;
    subscribers.current.forEach((callback) => callback(event));
  }, []);

  const subscribe = useCallback((callback) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  }, []);

  // In-place 클린업 함수
  const runCleanup = useCallback(() => {
    const currentTime = performance.now();
    const flowSpeed = flowSpeedRef.current;
    const trackHeight =
      trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;
    const currentNotes = notesRef.current;
    const removedNoteIds = [];
    const removedNotes = [];
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
          const timeSinceCompletion = currentTime - note.endTime;
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
  }, [notifySubscribers]);

  // 이벤트 기반 클린업 스케줄러
  const scheduleCleanup = useCallback(
    (finalizedNote) => {
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
    },
    [runCleanup],
  );

  const updateLabSettings = useCallback((settings) => {
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
  }, []);

  useEffect(() => {
    updateLabSettings(noteSettings || DEFAULT_NOTE_SETTINGS);
  }, [noteSettings, updateLabSettings]);

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
          } catch (e) {}
        }
      }
      activeNotes.current.clear();
      for (const timer of finalizeTimersRef.current.values()) {
        try {
          clearTimeout(timer);
        } catch (e) {}
      }
      finalizeTimersRef.current.clear();
      noteBufferRef.current.clear();
      notifySubscribers({
        type: 'clear',
        activeCount: 0,
        version: noteBufferRef.current.version,
      });
    }
  }, [noteEffect, notifySubscribers]);

  const createNote = useCallback(
    (keyName, startTimeOverride) => {
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
    },
    [notifySubscribers],
  );

  const finalizeNote = useCallback(
    (keyName, noteId, endTimeOverride) => {
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
    },
    [notifySubscribers, scheduleCleanup],
  );

  const removeState = useCallback((keyName, state) => {
    const stateList = activeNotes.current.get(keyName);
    if (!stateList) return;
    const index = stateList.indexOf(state);
    if (index === -1) return;
    stateList.splice(index, 1);
    if (stateList.length === 0) {
      activeNotes.current.delete(keyName);
    }
  }, []);

  const computeMinLengthMs = useCallback(() => {
    const minPx = shortNoteMinLengthPxRef.current || 0;
    const flowSpeed = flowSpeedRef.current || DEFAULT_NOTE_SETTINGS.speed;
    if (minPx <= 0 || flowSpeed <= 0) return 0;
    return Math.round((minPx * 1000) / flowSpeed);
  }, []);

  const scheduleNoteFinalization = useCallback(
    (keyName, state, options = {}) => {
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
      const minLengthMs = computeMinLengthMs();
      const desiredDuration = forceMinLength
        ? minLengthMs
        : Math.max(minLengthMs, holdDurationFromStart);
      const safeDuration = Math.max(desiredDuration, 1);
      const targetEndTime = state.startTime + safeDuration;

      if (state.finalizeTimer) {
        clearTimeout(state.finalizeTimer);
        finalizeTimersRef.current.delete(state.noteId);
        state.finalizeTimer = null;
      }

      const finalizeState = () => {
        finalizeTimersRef.current.delete(state.noteId);
        state.finalizeTimer = null;
        finalizeNote(keyName, state.noteId, targetEndTime);
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
    },
    [computeMinLengthMs, finalizeNote, removeState],
  );

  // 노트 생성/완료
  const handleKeyDown = useCallback(
    (keyName) => {
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
        const state = {
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

          const overrideStart = state.downTime + state.delayMs;
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
      });
    },
    [createNote, removeState, scheduleNoteFinalization],
  );

  const handleKeyUp = useCallback(
    (keyName) => {
      if (!noteEffectEnabled.current) return;

      const stateList = activeNotes.current.get(keyName);
      if (!stateList || stateList.length === 0) return;

      let state = null;
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
    },
    [finalizeNote, removeState, scheduleNoteFinalization],
  );

  // 화면 밖으로 나간 노트 제거 - 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
      }
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
          } catch (e) {}
        }
      }
      for (const timer of finalizeTimersRef.current.values()) {
        try {
          clearTimeout(timer);
        } catch (e) {}
      }
      finalizeTimersRef.current.clear();

      releaseAllNotes(
        notesRef.current,
        notePoolRef.current,
        noteLookupRef.current,
      );
      noteLookupRef.current.clear();
      noteBufferRef.current.clear();
    };
  }, []);

  // 노트 효과가 꺼져있으면 no-op 함수 반환하여 오버헤드 최소화
  const noOpHandler = useCallback(() => {}, []);
  const effectiveHandleKeyDown = noteEffect ? handleKeyDown : noOpHandler;
  const effectiveHandleKeyUp = noteEffect ? handleKeyUp : noOpHandler;

  return {
    notesRef,
    subscribe,
    handleKeyDown: effectiveHandleKeyDown,
    handleKeyUp: effectiveHandleKeyUp,
    noteBuffer: noteBufferRef.current,
    updateTrackLayouts: (layouts) =>
      noteBufferRef.current.updateTrackLayouts(layouts),
  };
}
