// src/renderer/hooks/useNoteSystem.js
import { useState, useCallback, useRef, useEffect } from "react";
import { DEFAULT_NOTE_SETTINGS } from "@constants/overlayConfig";

export const FLOW_SPEED = 180;

export function useNoteSystem() {
  const notesRef = useRef({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());
  const flowSpeedRef = useRef(180);
  const trackHeightRef = useRef(DEFAULT_NOTE_SETTINGS.trackHeight || 150);
  const subscribers = useRef(new Set());

  const notifySubscribers = useCallback((event) => {
    subscribers.current.forEach((callback) => callback(event));
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
        notifySubscribers({ type: "clear" });
      }
    };

    ipcRenderer.on("update-note-effect", noteEffectListener);

    // 노트 설정(속도) 초기 로드 및 변경 반영
    ipcRenderer
      .invoke("get-note-settings")
      .then((settings) => {
        flowSpeedRef.current = Number(settings?.speed) || 180;
        trackHeightRef.current =
          Number(settings?.trackHeight) || DEFAULT_NOTE_SETTINGS.trackHeight;
      })
      .catch(() => {});
    const noteSettingsListener = (_, settings) => {
      flowSpeedRef.current = Number(settings?.speed) || 180;
      trackHeightRef.current =
        Number(settings?.trackHeight) || DEFAULT_NOTE_SETTINGS.trackHeight;
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

      notifySubscribers({ type: "add", note: newNote });
      return noteId;
    },
    [notifySubscribers]
  );

  const finalizeNote = useCallback(
    (keyName, noteId) => {
      const endTime = performance.now();
      const currentNotes = notesRef.current;

      if (!currentNotes[keyName]) return;

      let changed = false;
      let finalizedNote = null;
      const newKeyNotes = currentNotes[keyName].map((note) => {
        if (note.id === noteId && note.isActive) {
          changed = true;
          finalizedNote = { ...note, endTime, isActive: false };
          return finalizedNote;
        }
        return note;
      });

      if (changed) {
        notesRef.current = {
          ...currentNotes,
          [keyName]: newKeyNotes,
        };
        notifySubscribers({ type: "finalize", note: finalizedNote });
      }
    },
    [notifySubscribers]
  );

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

  // 화면 밖으로 나간 노트 제거
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = performance.now();
      const flowSpeed = flowSpeedRef.current;
      const trackHeight =
        trackHeightRef.current || DEFAULT_NOTE_SETTINGS.trackHeight;

      const currentNotes = notesRef.current;
      let hasChanges = false;
      const updated = {};
      const removedNoteIds = [];

      Object.entries(currentNotes).forEach(([keyName, keyNotes]) => {
        const filtered = keyNotes.filter((note) => {
          // 활성화된 노트는 유지
          if (note.isActive) return true;

          // 완료된 노트가 화면 밖으로 나갔는지 확인
          const timeSinceCompletion = currentTime - note.endTime;
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
          const shouldKeep = yPosition < trackHeight + 200; // 화면 밖으로 완전히 나갈 때까지 여유분
          if (!shouldKeep) {
            removedNoteIds.push(note.id);
          }
          return shouldKeep;
        });

        if (filtered.length !== keyNotes.length) {
          hasChanges = true;
        }

        if (filtered.length > 0) {
          updated[keyName] = filtered;
        }
      });

      if (hasChanges) {
        notesRef.current = updated;
        notifySubscribers({ type: "cleanup", note: { ids: removedNoteIds } });
      }
    }, 2000);

    return () => clearInterval(cleanupInterval);
  }, [notifySubscribers]);

  return {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
  };
}
