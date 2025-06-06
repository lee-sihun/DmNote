// src/renderer/hooks/useNoteSystem.js
import { useState, useCallback, useRef, useEffect } from 'react';

export const FLOW_SPEED = 180;

// 성능 최적화를 위한 상수들
const MAX_NOTES_PER_KEY = 20; // 키당 최대 노트 수 제한
const CLEANUP_INTERVAL = 300; // 정리 주기 (ms) - 더 자주 정리

export function useNoteSystem() {
  const [notes, setNotes] = useState({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());
  const notesRef = useRef({});
  const lastCleanupTime = useRef(0);
  const stateUpdateScheduled = useRef(false);
  const updateQueue = useRef(new Set()); // 업데이트가 필요한 키들만 추적

  // 객체 풀링으로 메모리 할당 최소화
  const notePool = useRef([]);
  const getPooledNote = useCallback(() => {
    return notePool.current.pop() || {};
  }, []);

  const returnToPool = useCallback((note) => {
    // 객체 초기화
    for (let key in note) {
      delete note[key];
    }
    if (notePool.current.length < 100) { // 풀 크기 제한
      notePool.current.push(note);
    }
  }, []);

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");

    ipcRenderer.send("get-note-effect");

    const noteEffectListener = (_, enabled) => {
      noteEffectEnabled.current = enabled;

      if (!enabled) {
        setNotes({});
        notesRef.current = {};
        activeNotes.current.clear();
      }
    };

    ipcRenderer.on("update-note-effect", noteEffectListener);

    return () => {
      ipcRenderer.removeAllListeners("update-note-effect");
    };
  }, []);  // 배치 상태 업데이트 함수
  const flushStateUpdates = useCallback(() => {
    if (!stateUpdateScheduled.current || updateQueue.current.size === 0) return;

    stateUpdateScheduled.current = false;
    const keysToUpdate = Array.from(updateQueue.current);
    updateQueue.current.clear();

    setNotes(prev => {
      const updated = { ...prev };
      let hasChanges = false;

      keysToUpdate.forEach(keyName => {
        if (notesRef.current[keyName]) {
          updated[keyName] = notesRef.current[keyName];
          hasChanges = true;
        } else if (updated[keyName]) {
          delete updated[keyName];
          hasChanges = true;
        }
      });

      return hasChanges ? updated : prev;
    });
  }, []);

  // 상태 업데이트 스케줄링
  const scheduleStateUpdate = useCallback((keyName) => {
    updateQueue.current.add(keyName);

    if (!stateUpdateScheduled.current) {
      stateUpdateScheduled.current = true;
      // 다음 프레임에서 배치 업데이트
      requestAnimationFrame(flushStateUpdates);
    }
  }, [flushStateUpdates]);
  const createNote = useCallback((keyName) => {
    const startTime = performance.now();
    const noteId = `${keyName}_${startTime}`;

    // 풀에서 객체 재사용
    const newNote = getPooledNote();
    newNote.id = noteId;
    newNote.keyName = keyName;
    newNote.startTime = startTime;
    newNote.endTime = null;
    newNote.isActive = true;

    // 직접 ref 업데이트 (리렌더링 없음)
    if (!notesRef.current[keyName]) {
      notesRef.current[keyName] = [];
    }

    // 키당 최대 노트 수 제한
    if (notesRef.current[keyName].length >= MAX_NOTES_PER_KEY) {
      // 가장 오래된 비활성 노트 제거하고 풀로 반환
      let removedNote = null;
      const notes = notesRef.current[keyName];
      for (let i = 0; i < notes.length; i++) {
        if (!notes[i].isActive) {
          removedNote = notes.splice(i, 1)[0];
          break;
        }
      }
      if (removedNote) {
        returnToPool(removedNote);
      }
    }

    notesRef.current[keyName].push(newNote);    // 배치 상태 업데이트 스케줄링
    scheduleStateUpdate(keyName);

    return noteId;
  }, [scheduleStateUpdate, getPooledNote, returnToPool]);
  const finalizeNote = useCallback((keyName, noteId) => {
    const endTime = performance.now();

    if (!notesRef.current[keyName]) return;

    // 직접 ref 업데이트 - find 대신 for 루프 사용
    const notes = notesRef.current[keyName];
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].id === noteId) {
        notes[i] = { ...notes[i], endTime, isActive: false };
        break;
      }
    }

    // 배치 상태 업데이트 스케줄링
    scheduleStateUpdate(keyName);
  }, [scheduleStateUpdate]);

  // 노트 생성/완료
  const handleKeyDown = useCallback((keyName) => {
    if (!noteEffectEnabled.current) return;

    // 활성화된 노트가 있는지 체크
    if (activeNotes.current.has(keyName)) return;

    const noteId = createNote(keyName);
    activeNotes.current.set(keyName, { noteId });
  }, [createNote]);

  const handleKeyUp = useCallback((keyName) => {
    if (!noteEffectEnabled.current) return;

    const activeNote = activeNotes.current.get(keyName);
    if (activeNote) {
      finalizeNote(keyName, activeNote.noteId);
      activeNotes.current.delete(keyName);
    }
  }, [finalizeNote]);  // 화면 밖으로 나간 노트 제거 - 배치 처리로 최적화
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = performance.now();

      // 너무 자주 정리하지 않도록 스로틀링
      if (currentTime - lastCleanupTime.current < CLEANUP_INTERVAL) {
        return;
      }

      lastCleanupTime.current = currentTime;
      const flowSpeed = FLOW_SPEED;
      const trackHeight = 150;

      let hasChanges = false;
      const keysToUpdate = [];

      // Object.keys 대신 for...in 루프 사용 (더 빠름)
      for (const keyName in notesRef.current) {
        const notes = notesRef.current[keyName];
        if (!notes || notes.length === 0) continue;

        const originalLength = notes.length;

        // 역순으로 순회하면서 in-place 제거
        for (let i = notes.length - 1; i >= 0; i--) {
          const note = notes[i];
          if (!note.isActive) {
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

            if (yPosition > trackHeight + 100) {
              const removedNote = notes.splice(i, 1)[0];
              returnToPool(removedNote); // 객체를 풀로 반환
            }
          }
        }

        // 변경사항이 있으면 업데이트 큐에 추가
        if (notes.length !== originalLength) {
          hasChanges = true;
          keysToUpdate.push(keyName);
          // 빈 배열 정리
          if (notes.length === 0) {
            delete notesRef.current[keyName];
          }
        }
      }

      // 배치 상태 업데이트
      if (hasChanges && keysToUpdate.length > 0) {
        keysToUpdate.forEach(keyName => scheduleStateUpdate(keyName));
      }
    }, CLEANUP_INTERVAL);

    return () => {
      clearInterval(cleanupInterval);
      // 정리 시 모든 객체를 풀로 반환
      for (const keyName in notesRef.current) {
        const notes = notesRef.current[keyName];
        if (notes) {
          notes.forEach(note => returnToPool(note));
        }
      }
    };
  }, [scheduleStateUpdate, returnToPool]);

  return {
    notes,
    handleKeyDown,
    handleKeyUp,
  };
}