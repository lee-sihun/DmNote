import { useState, useCallback, useRef, useEffect } from 'react';

export const FLOW_SPEED = 180;

// 극도로 최적화된 설정
const MAX_NOTES_PER_KEY = 8; // 더 적은 노트로 메모리 절약
const CLEANUP_INTERVAL = 1000; // 정리 주기 더 늘림

export function useNoteSystem() {
  const [notes, setNotes] = useState({});
  const noteEffectEnabled = useRef(true);
  const activeNotes = useRef(new Map());
  const notesRef = useRef({});
  
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
  }, []);

  // 즉시 상태 업데이트 (배치 제거)
  const updateState = useCallback((keyName) => {
    setNotes(prev => {
      const newNotes = { ...prev };
      if (notesRef.current[keyName] && notesRef.current[keyName].length > 0) {
        newNotes[keyName] = [...notesRef.current[keyName]];
      } else {
        delete newNotes[keyName];
      }
      return newNotes;
    });
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

    if (!notesRef.current[keyName]) {
      notesRef.current[keyName] = [];
    }

    const notes = notesRef.current[keyName];
    if (notes.length >= MAX_NOTES_PER_KEY) {
      notes.shift(); // 가장 오래된 노트 제거
    }

    notes.push(newNote);
    updateState(keyName); // 즉시 상태 업데이트

    return noteId;
  }, [updateState]);

  const finalizeNote = useCallback((keyName, noteId) => {
    const endTime = performance.now();

    if (!notesRef.current[keyName]) return;

    const notes = notesRef.current[keyName];
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].id === noteId) {
        notes[i] = { ...notes[i], endTime, isActive: false };
        break;
      }
    }

    updateState(keyName); // 즉시 상태 업데이트
  }, [updateState]);

  const handleKeyDown = useCallback((keyName) => {
    if (!noteEffectEnabled.current) return;

    if (activeNotes.current.has(keyName)) return;

    const noteId = createNote(keyName);
    activeNotes.current.set(keyName, { noteId });
  }, [createNote]);

  const handleKeyUp = useCallback((keyName) => {
    if (!noteEffectEnabled.current) return;

    const activeNote = activeNotes.current.get(keyName);
    if (!activeNote) return;

    finalizeNote(keyName, activeNote.noteId);
    activeNotes.current.delete(keyName);
  }, [finalizeNote]);

  // 단순화된 정리 로직
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = performance.now();
      let hasChanges = false;

      Object.keys(notesRef.current).forEach(keyName => {
        const notes = notesRef.current[keyName];
        if (!notes) return;

        const filteredNotes = notes.filter(note => {
          if (note.isActive) return true;
          const timeSinceEnd = currentTime - (note.endTime || 0);
          return timeSinceEnd < 3000; // 3초 후 제거
        });

        if (filteredNotes.length !== notes.length) {
          if (filteredNotes.length === 0) {
            delete notesRef.current[keyName];
          } else {
            notesRef.current[keyName] = filteredNotes;
          }
          hasChanges = true;
        }
      });

      if (hasChanges) {
        setNotes(prev => {
          const newNotes = {};
          Object.keys(notesRef.current).forEach(keyName => {
            if (notesRef.current[keyName] && notesRef.current[keyName].length > 0) {
              newNotes[keyName] = [...notesRef.current[keyName]];
            }
          });
          return newNotes;
        });
      }
    }, CLEANUP_INTERVAL);

    return () => clearInterval(cleanupInterval);
  }, []);

  return {
    notes,
    handleKeyDown,
    handleKeyUp,
    noteEffectEnabled: noteEffectEnabled.current,
  };
}
