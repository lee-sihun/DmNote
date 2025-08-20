// Web Worker for note calculations
let notes = [];
let flowSpeed = 180;
let height = 150;

self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'UPDATE_NOTES':
      notes = data.notes;
      flowSpeed = data.flowSpeed;
      height = data.height;
      break;
      
    case 'CALCULATE_FRAME':
      const { currentTime, noteColor, baseOpacity } = data;
      const updates = [];
      
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const update = { id: note.id };
        
        if (note.isActive) {
          const pressDuration = currentTime - note.startTime;
          const noteLength = Math.max(0, (pressDuration * flowSpeed) / 1000);
          
          update.height = noteLength;
          update.bottom = 0;
          update.opacity = baseOpacity;
          update.backgroundColor = noteColor || '#ffffff';
        } else {
          const noteDuration = note.endTime - note.startTime;
          const noteLength = Math.max(0, (noteDuration * flowSpeed) / 1000);
          const timeSinceCompletion = currentTime - note.endTime;
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
          
          let opacity = baseOpacity;
          if (yPosition > height) {
            const fadeProgress = (yPosition - height) / 50;
            opacity = baseOpacity * (1 - Math.min(fadeProgress, 1));
          }
          
          update.height = noteLength;
          update.bottom = yPosition;
          update.opacity = opacity;
        }
        
        updates.push(update);
      }
      
      self.postMessage({
        type: 'FRAME_CALCULATED',
        data: { updates, frameTime: performance.now() - data.startTime }
      });
      break;
  }
};
