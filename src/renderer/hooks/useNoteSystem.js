import { useState, useCallback, useRef, useEffect } from 'react';

export function useNoteSystem() {
  const [notes, setNotes] = useState({});
  const [keyStates, setKeyStates] = useState({});
  const activeNotes = useRef(new Map());

  // 노트 생성 시 고정된 시간 사용
  const createNote = useCallback((keyName) => {
    const startTime = performance.now();
    const noteId = `${keyName}_${startTime}`;
    const newNote = {
      id: noteId,
      keyName,
      startTime,
      endTime: null,
      isActive: true,
      color: '#ffffff',
    };

    setNotes(prev => ({
      ...prev,
      [keyName]: [...(prev[keyName] || []), newNote],
    }));

    return noteId;
  }, []);

  const finalizeNote = useCallback((keyName, noteId) => {
    const endTime = performance.now();

    setNotes(prev => {
      if (!prev[keyName]) return prev;

      return {
        ...prev,
        [keyName]: prev[keyName].map(note => {
          if (note.id === noteId) {
            return {
              ...note,
              endTime,
              isActive: false,
              color: '#ffffff',
            };
          }
          return note;
        }),
      };
    });
  }, []);

  const handleKeyDown = useCallback((keyName) => {
    if (keyStates[keyName]) return;

    const noteId = createNote(keyName);

    setKeyStates(prev => ({ ...prev, [keyName]: true }));
    activeNotes.current.set(keyName, { noteId });
  }, [keyStates, createNote]);

  const handleKeyUp = useCallback((keyName) => {
    const activeNote = activeNotes.current.get(keyName);

    if (activeNote) {
      finalizeNote(keyName, activeNote.noteId);
      activeNotes.current.delete(keyName);
    }

    setKeyStates(prev => ({ ...prev, [keyName]: false }));
  }, [finalizeNote]);

  // 화면 밖으로 나간 노트 정리
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = performance.now();
      const flowSpeed = 50;
      const trackHeight = 150;

      setNotes(prev => {
        let hasChanges = false;
        const updated = {};

        Object.entries(prev).forEach(([keyName, keyNotes]) => {
          const filtered = keyNotes.filter(note => {
            if (note.isActive) return true;

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
    }, 3000);

    return () => clearInterval(cleanupInterval);
  }, []);

  return {
    notes,
    keyStates,
    handleKeyDown,
    handleKeyUp,
  };
}