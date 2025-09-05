// src/renderer/hooks/useNoteSystem.js
import { useState, useCallback, useRef, useEffect } from "react";
import { TRACK_HEIGHT } from "@constants/overlayConfig";

export const FLOW_SPEED = 180;

export function useNoteSystem() {
  const notesRef = useRef({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());
  const flowSpeedRef = useRef(180);
  const subscribers = useRef(new Set());

  const notifySubscribers = useCallback(() => {
    subscribers.current.forEach((callback) => callback());
  }, []);

  const subscribe = useCallback((callback) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  }, []);

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");

    ipcRenderer.send("get-note-effect");

    const noteEffectListener = (_, enabled) => {
      noteEffectEnabled.current = enabled;

      if (!enabled) {
        notesRef.current = {};
        activeNotes.current.clear();
        notifySubscribers();
      }
    };

    ipcRenderer.on("update-note-effect", noteEffectListener);

    // 노트 설정(속도) 초기 로드 및 변경 반영
    ipcRenderer
      .invoke("get-note-settings")
      .then((settings) => {
        flowSpeedRef.current = Number(settings?.speed) || 180;
      })
      .catch(() => {});
    const noteSettingsListener = (_, settings) => {
      flowSpeedRef.current = Number(settings?.speed) || 180;
    };
    ipcRenderer.on("update-note-settings", noteSettingsListener);

    return () => {
      ipcRenderer.removeAllListeners("update-note-effect");
      ipcRenderer.removeAllListeners("update-note-settings");
    };
  }, [notifySubscribers]);

  const createNote = useCallback(
    (keyName) => {
      const startTime = performance.now();
      const noteId = `${keyName}_${startTime}`;
      const newNote = {
        id: noteId,
        keyName,
        startTime,
        endTime: null,
        isActive: true,
      };

      const currentNotes = notesRef.current;
      const keyNotes = currentNotes[keyName] || [];
      notesRef.current = {
        ...currentNotes,
        [keyName]: [...keyNotes, newNote],
      };

      notifySubscribers();
      return noteId;
    },
    [notifySubscribers]
  );

  const finalizeNote = useCallback((keyName, noteId) => {
    const endTime = performance.now();
    const currentNotes = notesRef.current;

    if (!currentNotes[keyName]) return;

    notesRef.current = {
      ...currentNotes,
      [keyName]: currentNotes[keyName].map((note) => {
        if (note.id === noteId) {
          return { ...note, endTime, isActive: false };
        }
        return note;
      }),
    };
    // 활성 상태만 변경되므로 notify 불필요
  }, []);

  // 노트 생성/완료
  const handleKeyDown = useCallback(
    (keyName) => {
      if (!noteEffectEnabled.current) return;

      // 활성화된 노트가 있는지 체크
      if (activeNotes.current.has(keyName)) return;

      const noteId = createNote(keyName);
      activeNotes.current.set(keyName, { noteId });
    },
    [createNote]
  );

  const handleKeyUp = useCallback(
    (keyName) => {
      if (!noteEffectEnabled.current) return;

      const activeNote = activeNotes.current.get(keyName);
      if (activeNote) {
        finalizeNote(keyName, activeNote.noteId);
        activeNotes.current.delete(keyName);
      }
    },
    [finalizeNote]
  );

  // 화면 밖으로 나간 노트 제거 (최적화된 버전)
  useEffect(() => {
    let cleanupTimeoutId = null;
    let lastCleanupTime = 0;

    const scheduleCleanup = () => {
      const now = performance.now();
      // 최소 1초 간격으로 cleanup 실행
      if (now - lastCleanupTime < 1000) {
        if (cleanupTimeoutId) clearTimeout(cleanupTimeoutId);
        cleanupTimeoutId = setTimeout(scheduleCleanup, 1000 - (now - lastCleanupTime));
        return;
      }

      const currentTime = performance.now();
      const flowSpeed = flowSpeedRef.current;
      const trackHeight = TRACK_HEIGHT + 0; // 여유분 추가

      const currentNotes = notesRef.current;
      let hasChanges = false;
      const updated = {};

      // 최적화: 빈 객체면 바로 스킵
      const noteEntries = Object.entries(currentNotes);
      if (noteEntries.length === 0) {
        lastCleanupTime = currentTime;
        cleanupTimeoutId = setTimeout(scheduleCleanup, 3000); // 노트가 없으면 더 긴 간격
        return;
      }

      for (const [keyName, keyNotes] of noteEntries) {
        if (!keyNotes || keyNotes.length === 0) continue;

        const filtered = keyNotes.filter((note) => {
          // 활성화된 노트는 항상 유지
          if (note.isActive) return true;

          // 완료된 노트가 화면 밖으로 나갔는지 확인 (여유분 포함)
          const timeSinceCompletion = currentTime - note.endTime;
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
          return yPosition < trackHeight;
        });

        if (filtered.length !== keyNotes.length) {
          hasChanges = true;
        }

        if (filtered.length > 0) {
          updated[keyName] = filtered;
        }
      }

      if (hasChanges) {
        notesRef.current = updated;
        notifySubscribers();
      }

      lastCleanupTime = currentTime;
      // 적응형 간격: 노트가 많으면 더 자주, 적으면 덜 자주
      const totalNotes = Object.values(updated).reduce((sum, notes) => sum + notes.length, 0);
      const nextInterval = totalNotes > 10 ? 1500 : totalNotes > 0 ? 2500 : 4000;
      cleanupTimeoutId = setTimeout(scheduleCleanup, nextInterval);
    };

    // 초기 cleanup 스케줄링
    cleanupTimeoutId = setTimeout(scheduleCleanup, 2000);

    return () => {
      if (cleanupTimeoutId) clearTimeout(cleanupTimeoutId);
    };
  }, [notifySubscribers]);

  return {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
  };
}
