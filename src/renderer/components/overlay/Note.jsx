import React, { memo } from "react";

export const Note = memo(({ note, trackHeight, flowOffset }) => {
  const currentTime = Date.now();
  const flowSpeed = 50;

  const startTime = note.startTime;
  const endTime = note.isActive ? currentTime : note.endTime;

  let noteStyle;

  if (note.isActive) {
    const pressDuration = currentTime - startTime;
    const noteLength = (pressDuration * flowSpeed) / 1000;

    noteStyle = {
      position: "absolute",
      bottom: "0px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "80%",
      height: `${Math.max(4, noteLength)}px`,
      backgroundColor: note.color || "#ffff00",
      borderRadius: "2px 2px 0 0",
      opacity: 1,
      zIndex: 10,
      boxShadow: "0 0 4px rgba(255, 255, 0, 0.5)",
    };
  } else {
    const noteDuration = endTime - startTime;
    const noteLength = (noteDuration * flowSpeed) / 1000;

    const timeSinceCompletion = currentTime - endTime;
    const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

    const opacity =
      yPosition > trackHeight
        ? Math.max(0, 1 - (yPosition - trackHeight) / 50)
        : 1;

    noteStyle = {
      position: "absolute",
      bottom: `${yPosition}px`,
      left: "50%",
      transform: "translateX(-50%)",
      width: "80%",
      height: `${Math.max(4, noteLength)}px`,
      backgroundColor: note.color || "#00ff00",
      borderRadius: "2px",
      opacity,
      zIndex: 10,
      boxShadow: "0 0 2px rgba(0, 255, 0, 0.3)",
    };
  }

  return <div style={noteStyle} />;
});
