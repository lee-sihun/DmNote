import { useRef, useEffect } from 'react';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { MAX_FALLBACK_CLOCK_SKEW_MS } from '@constants/inputTiming';
import {
  createNoteBuffer,
  NoteBuffer,
  TrackLayoutInput,
} from '@stores/signals/noteBuffer';
import {
  computeNoteLengthMs,
  createNoteLengthPolicy,
  toEffectiveMinLengthPx,
  toMinLengthMs,
  type NoteLengthPolicy,
} from '@utils/core/noteLengthPolicy';

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
  // 판정 폴백용 비클램프 보정 시각 - 표시용 downTime과 분리
  physDownTime?: number;
  releaseTime: number | null;
  physReleaseTime?: number;
  // 데몬이 캡처 시점에 측정한 물리 hold (UP payload, 검증 통과 값만)
  holdDurationMs?: number;
  startTime: number | null;
  startTimer: ReturnType<typeof setTimeout> | null;
  finalizeTimer: ReturnType<typeof setTimeout> | null;
  noteId: string | null;
  created: boolean;
  released: boolean;
  // press 시작 시점 길이 정책 스냅샷
  lengthPolicy?: NoteLengthPolicy;
}

// 키 이벤트 시각 정보. displayTime은 클램프 보정(표시 위치 전용),
// physTime은 비클램프 보정(hold 폴백 전용)
export interface NoteKeyTiming {
  displayTime?: number;
  physTime?: number;
  holdDurationMs?: number;
}

interface NoteSettings {
  speed?: number;
  trackHeight?: number;
  frameLimit?: number;
  delayedNoteEnabled?: boolean;
  shortNoteThresholdMs?: number;
  shortNoteMinLengthPx?: number;
}

// 셰이더는 travel ≥ trackHeight 시점에 노트를 컬하지만, 프레임 제한 시 uTime(stableTime)이
// wall clock보다 최대 limiter interval만큼 늦으므로 그만큼만 여유를 두고 정리
const NOTE_CLEANUP_SLACK_MS = 50;

interface UseNoteSystemOptions {
  noteEffect: boolean;
  noteSettings?: NoteSettings;
}

interface UseNoteSystemReturn {
  notesRef: React.MutableRefObject<Record<string, Note[]>>;
  subscribe: (callback: NoteSubscriber) => () => void;
  handleKeyDown: (keyName: string, timing?: NoteKeyTiming) => void;
  handleKeyUp: (keyName: string, timing?: NoteKeyTiming) => void;
  finalizeAllActive: () => void;
  reconcileActiveNotes: (activeKeys: ReadonlySet<string>) => void;
  noteBuffer: NoteBuffer;
  updateTrackLayouts: (layouts: TrackLayoutInput[]) => void;
}

interface CanonicalFallbackTiming {
  displayDownTime?: number;
  displayReleaseTime: number;
  physicalDownTime?: number;
  physicalReleaseTime: number;
}

export const resolveCanonicalFallbackHoldMs = ({
  displayDownTime,
  displayReleaseTime,
  physicalDownTime,
  physicalReleaseTime,
}: CanonicalFallbackTiming): number => {
  const displayHold =
    displayDownTime == null
      ? 0
      : Math.max(0, displayReleaseTime - displayDownTime);
  const physicalHold =
    physicalDownTime == null
      ? displayHold
      : Math.max(0, physicalReleaseTime - physicalDownTime);

  // 비클램프 event age의 시계 이상만 제한하고 정상적인 장시간 hold는 보존
  return Math.min(physicalHold, displayHold + MAX_FALLBACK_CLOCK_SKEW_MS);
};

// 렌더마다 재생성되는 내부 구현 중 안정 래퍼가 위임하는 대상
type LatestNoteSystemFns = Pick<
  UseNoteSystemReturn,
  | 'subscribe'
  | 'handleKeyDown'
  | 'handleKeyUp'
  | 'finalizeAllActive'
  | 'reconcileActiveNotes'
>;

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
  // 마운트~첫 effect 사이에도 최신값 보장 - 반환 핸들러는 삼항 없이 이 ref만 가드
  const noteEffectEnabled = useRef<boolean>(!!noteEffect);
  const activeNotes = useRef<Map<string, NoteState[]>>(new Map());
  const flowSpeedRef = useRef<number>(DEFAULT_NOTE_SETTINGS.speed);
  const trackHeightRef = useRef<number>(DEFAULT_NOTE_SETTINGS.trackHeight);
  const frameLimitRef = useRef<number>(0);
  // 수명 계산에 쓰이는 스칼라만 추적 — 설정 객체 identity 변경만으로 재스케줄 방지
  const prevCleanupScalarsRef = useRef<string>('');
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

  // 프레임 제한이 낮을수록 uTime 지연이 커지므로 슬랙을 limiter interval까지 확장
  const cleanupSlackPx = (flowSpeed: number): number => {
    const frameLimit = frameLimitRef.current;
    const slackMs = Math.max(
      NOTE_CLEANUP_SLACK_MS,
      frameLimit > 0 ? 1000 / frameLimit : 0,
    );
    return (flowSpeed * slackMs) / 1000;
  };

  // In-place 클린업 함수
  const runCleanup = (): void => {
    const currentTime = performance.now();
    const flowSpeed = flowSpeedRef.current;
    const trackHeight =
      trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;
    const keepDistancePx = trackHeight + cleanupSlackPx(flowSpeed);
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
          shouldKeep = yPosition < keepDistancePx;

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
          const travelTimeMs = (keepDistancePx * 1000) / flowSpeed;
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
    const travelTimeMs =
      ((trackHeight + cleanupSlackPx(flowSpeed)) * 1000) / flowSpeed;
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
    frameLimitRef.current = Number(settings?.frameLimit) || 0;
    // speed/trackHeight/frameLimit 실제 변경 시에만 기존 타이머를 새 수명 기준으로 재계산
    const cleanupScalars = `${flowSpeedRef.current}/${trackHeightRef.current}/${frameLimitRef.current}`;
    if (
      prevCleanupScalarsRef.current !== cleanupScalars &&
      cleanupTimerRef.current !== null
    ) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
      nextCleanupTimeRef.current = Infinity;
      runCleanup();
    }
    prevCleanupScalarsRef.current = cleanupScalars;
  }, [noteSettings]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const minLengthPx = shortNoteMinLengthPxRef.current || 0;
    const trackHeight =
      trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;
    return toMinLengthMs(
      toEffectiveMinLengthPx(minLengthPx, trackHeight),
      flowSpeedRef.current || DEFAULT_NOTE_SETTINGS.speed,
    );
  };

  const scheduleNoteFinalization = (
    keyName: string,
    state: NoteState,
  ): void => {
    if (!state?.noteId || state.startTime == null || !state.lengthPolicy) {
      return;
    }

    const releaseTime = state.releaseTime ?? performance.now();
    // 판정용 물리 hold: 데몬 authoritative 값 우선, 없으면 비클램프 보정 시각 차 폴백
    const physDown = state.physDownTime ?? state.downTime;
    const physRelease = state.physReleaseTime ?? releaseTime;
    const fallbackHold = resolveCanonicalFallbackHoldMs({
      displayDownTime: state.downTime,
      displayReleaseTime: releaseTime,
      physicalDownTime: physDown,
      physicalReleaseTime: physRelease,
    });
    const holdMs = state.holdDurationMs ?? fallbackHold;
    // 데몬 hold와 press 시점 정책으로만 길이 결정
    const computedNoteLengthMs = computeNoteLengthMs(
      holdMs,
      state.lengthPolicy,
    );
    // 잘못된 입력에서만 노트 소실 방지
    const noteLengthMs =
      Number.isFinite(computedNoteLengthMs) && computedNoteLengthMs > 0
        ? computedNoteLengthMs
        : 1;
    const targetEndTime = Math.max(
      state.startTime + noteLengthMs,
      performance.now(),
    );

    if (state.finalizeTimer) {
      clearTimeout(state.finalizeTimer);
      finalizeTimersRef.current.delete(state.noteId);
      state.finalizeTimer = null;
    }

    // 타이머가 늦게 실행돼 targetEndTime이 과거가 돼도 실행 시점으로 다시 밀지 않는다.
    // 셰이더에서 머리 위치는 startTime에만 의존해 완료 전후가 동일하고, 꼬리만
    // 원래 떨어졌어야 할 자리로 이동한다. 다시 클램프하면 꼬리를 제자리에 묶어
    // 롱노트 길이만 늘어난다
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

  // 노트 생성/완료. timing.displayTime: 표시용 보정 시각, timing.physTime: 판정 폴백용
  const handleKeyDown = (keyName: string, timing?: NoteKeyTiming): void => {
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
      const thresholdMs = delayMsRef.current;
      const lengthPolicy = createNoteLengthPolicy(
        computeMinLengthMs(),
        thresholdMs,
      );
      const downTime = timing?.displayTime ?? performance.now();
      const state: NoteState = {
        useDelay: true,
        downTime,
        physDownTime: timing?.physTime ?? downTime,
        releaseTime: null,
        startTime: null,
        startTimer: null,
        finalizeTimer: null,
        noteId: null,
        created: false,
        released: false,
        lengthPolicy,
      };

      const createDelayedNote = (): void => {
        state.startTimer = null;
        if (!noteEffectEnabled.current) {
          removeState(keyName, state);
          return;
        }

        const overrideStart =
          state.downTime! + state.lengthPolicy!.displayDelayMs;
        const noteId = createNote(keyName, overrideStart);
        state.noteId = noteId;
        state.created = true;
        state.startTime = overrideStart;

        // 생성 전에 UP이 먼저 도착한 press - 단/롱은 finalize 계산이 hold로 판정
        if (state.released) {
          scheduleNoteFinalization(keyName, state);
        }
      };

      stateList.push(state);
      // 실제 입력 시각 기준으로 노트 등장 시점을 맞춤
      const remainingDelay =
        downTime + lengthPolicy.displayDelayMs - performance.now();
      if (remainingDelay <= 0) {
        createDelayedNote();
        return;
      }

      state.startTimer = setTimeout(createDelayedNote, remainingDelay);
      return;
    }

    const noteId = createNote(keyName, timing?.displayTime);
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

  const handleKeyUp = (keyName: string, timing?: NoteKeyTiming): void => {
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

    const now = timing?.displayTime ?? performance.now();
    state.released = true;
    state.releaseTime = now;
    state.physReleaseTime = timing?.physTime ?? now;
    // NaN·음수 방어: 검증 실패 값은 폴백 계산으로 강등
    const rawHold = timing?.holdDurationMs;
    state.holdDurationMs =
      typeof rawHold === 'number' && Number.isFinite(rawHold) && rawHold >= 0
        ? rawHold
        : undefined;

    if (!state.useDelay) {
      if (state.created && state.noteId) {
        finalizeNote(keyName, state.noteId, now);
      }
      removeState(keyName, state);
      return;
    }

    if (state.startTimer) {
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

  // 탭 전환 시 진행 중인 모든 노트 강제 완료
  const finalizeAllActive = (): void => {
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

  // UP 유실 복구: 스냅샷 기준 실제로 눌려 있지 않은 키의 활성 press를 종료.
  // 유실된 release의 실제 시각은 복원 불가하므로 현재 시각 finalize로
  // 성장만 정지시킨다 (실패 복구 경로이지 정상 판정이 아님)
  const reconcileActiveNotes = (activeKeys: ReadonlySet<string>): void => {
    const now = performance.now();
    for (const [keyName, stateList] of activeNotes.current.entries()) {
      if (activeKeys.has(keyName)) continue;
      if (!Array.isArray(stateList)) continue;
      // removeState가 배열을 변형하므로 사본 순회
      for (const state of [...stateList]) {
        if (!state || state.released) continue;
        state.released = true;
        state.releaseTime = now;
        state.physReleaseTime = now;
        if (state.startTimer) {
          // 노트 생성 전이면 표시된 것이 없으므로 조용히 취소
          clearTimeout(state.startTimer);
          state.startTimer = null;
          removeState(keyName, state);
          continue;
        }
        // 성장 즉시 정지 - schedule 경유 시 delay 모드는 threshold만큼 더 자람
        if (state.created && state.noteId) {
          finalizeNote(
            keyName,
            state.noteId,
            Math.max(now, state.startTime ?? 0),
          );
        }
        removeState(keyName, state);
      }
    }
  };

  // 반환 API는 마운트 1회 고정 - 소비 측 effect deps에 넣어도 재구독이 발생하지
  // 않는다 (#111 재구독→resetAllKeySignals 함정 차단). 최신 구현은 latest-ref로 공급
  const latestRef = useRef<LatestNoteSystemFns | undefined>(undefined);
  latestRef.current = {
    subscribe,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
  };

  const stableApiRef = useRef<UseNoteSystemReturn | null>(null);
  stableApiRef.current ??= {
    notesRef,
    subscribe: (callback) => latestRef.current!.subscribe(callback),
    handleKeyDown: (keyName, timing) =>
      latestRef.current!.handleKeyDown(keyName, timing),
    handleKeyUp: (keyName, timing) =>
      latestRef.current!.handleKeyUp(keyName, timing),
    finalizeAllActive: () => latestRef.current!.finalizeAllActive(),
    reconcileActiveNotes: (activeKeys) =>
      latestRef.current!.reconcileActiveNotes(activeKeys),
    noteBuffer: noteBufferRef.current,
    updateTrackLayouts: (layouts: TrackLayoutInput[]) =>
      noteBufferRef.current.updateTrackLayouts(layouts),
  };
  return stableApiRef.current;
}
