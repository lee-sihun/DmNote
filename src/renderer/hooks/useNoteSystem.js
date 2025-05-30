import { useState, useCallback, useRef, useEffect } from 'react';

export function useNoteSystem() {
  const [notes, setNotes] = useState({});
  const [keyStates, setKeyStates] = useState({});
  const activeNotes = useRef(new Map());
  const animationFrame = useRef();

  // 노트 생성
  const createNote = useCallback((keyName, startTime) => {
    const noteId = `${keyName}_${startTime}`;
    const newNote = {
      id: noteId,
      keyName,
      startTime,
      endTime: null,
      isActive: true,
      color: '#ffffff', // 활성 노트는 노란색
    };

    setNotes(prev => ({
      ...prev,
      [keyName]: [...(prev[keyName] || []), newNote],
    }));

    return noteId;
  }, []);

  // 노트 완성
  const finalizeNote = useCallback((keyName, noteId, endTime) => {
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
              color: '#ffffff', // 완성된 노트는 초록색
            };
          }
          return note;
        }),
      };
    });
  }, []);

  const handleKeyDown = useCallback((keyName) => {
    if (keyStates[keyName]) return;

    const startTime = Date.now();
    const noteId = createNote(keyName, startTime);

    setKeyStates(prev => ({ ...prev, [keyName]: true }));
    activeNotes.current.set(keyName, { noteId, startTime });
  }, [keyStates, createNote]);

  const handleKeyUp = useCallback((keyName) => {
    const activeNote = activeNotes.current.get(keyName);

    if (activeNote) {
      const endTime = Date.now();
      finalizeNote(keyName, activeNote.noteId, endTime);
      activeNotes.current.delete(keyName);
    }

    setKeyStates(prev => ({ ...prev, [keyName]: false }));
  }, [finalizeNote]);

  // 화면 밖으로 나간 노트들 정리
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = Date.now();
      const flowSpeed = 50;
      const trackHeight = 150;

      setNotes(prev => {
        const updated = {};
        let hasChanges = false;

        Object.entries(prev).forEach(([keyName, keyNotes]) => {
          const filtered = keyNotes.filter(note => {
            // 활성 노트는 항상 유지
            if (note.isActive) return true;

            // 완성된 노트는 화면 밖으로 나가면 제거
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

            return yPosition < trackHeight + 100; // 여유분 추가
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
    }, 1000);

    return () => clearInterval(cleanupInterval);
  }, []);

  return {
    notes,
    keyStates,
    handleKeyDown,
    handleKeyUp,
  };
}