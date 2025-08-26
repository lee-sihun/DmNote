// src/renderer/hooks/useNoteSystem.js
import { useState, useCallback, useRef, useEffect } from "react";
import { TRACK_HEIGHT } from "@constants/overlayConfig";

export const FLOW_SPEED = 180;

export function useNoteSystem() {
  const [notes, setNotes] = useState({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());

  useEffect(() => {
    const { ipcRenderer } = window.require("electron");

    ipcRenderer.send("get-note-effect");

    const noteEffectListener = (_, enabled) => {
      noteEffectEnabled.current = enabled;

      if (!enabled) {
        setNotes({});
        activeNotes.current.clear();
      }
    };

    ipcRenderer.on("update-note-effect", noteEffectListener);

    return () => {
      ipcRenderer.removeAllListeners("update-note-effect");
    };
  }, []);

  const createNote = useCallback((keyName) => {
    const startTime = performance.now();
    const noteId = `${keyName}_${startTime}`;
    const newNote = {
      id: noteId,
      keyName,
      startTime,
      endTime: null,
      isActive: true,
    };

    setNotes((prev) => ({
      ...prev,
      [keyName]: [...(prev[keyName] || []), newNote],
    }));

    return noteId;
  }, []);

  const finalizeNote = useCallback((keyName, noteId) => {
    const endTime = performance.now();

    setNotes((prev) => {
      if (!prev[keyName]) return prev;
      return {
        ...prev,
        [keyName]: prev[keyName].map((note) => {
          if (note.id === noteId) {
            return { ...note, endTime, isActive: false };
          }
          return note;
        }),
      };
    });
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

  // 화면 밖으로 나간 노트 제거
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = performance.now();
      const flowSpeed = FLOW_SPEED;
      const trackHeight = TRACK_HEIGHT;

      setNotes((prev) => {
        let hasChanges = false;
        const updated = {};

        Object.entries(prev).forEach(([keyName, keyNotes]) => {
          const filtered = keyNotes.filter((note) => {
            // 활성화된 노트는 유지
            if (note.isActive) return true;

            // 완료된 노트가 화면 밖으로 나갔는지 확인
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
            return yPosition < trackHeight + 150; // 여유분
          });

          if (filtered.length !== keyNotes.length) {
            hasChanges = true;
          }

          if (filtered.length > 0) {
            updated[keyName] = filtered;
          }
        });

        return hasChanges ? updated : prev;
      });
    }, 2000);

    return () => clearInterval(cleanupInterval);
  }, []);

  return {
    notes,
    handleKeyDown,
    handleKeyUp,
  };
}
