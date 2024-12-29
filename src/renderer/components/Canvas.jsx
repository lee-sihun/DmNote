import React from "react";
import { useDraggable } from "@hooks/useDraggable";

export default function Canvas() {
  return (
    <div className="flex flex-col w-full h-full p-[18px]">
      <Grid />
    </div>
  )
}

function Grid() {
  const initialPositions = [
    { dx: 280, dy: 130, width: 60 },
    { dx: 360, dy: 130, width: 60 },
    { dx: 440, dy: 130, width: 60 },
    { dx: 520, dy: 130, width: 60 },
    { dx: 140, dy: 130, width: 120 },
    { dx: 600, dy: 130, width: 120 },
  ];

  const keys = initialPositions.map(({ dx, dy, width }) => {
    const draggable = useDraggable({ 
      gridSize: 10, 
      initialX: dx, 
      initialY: dy,
      containerWidth: 860,
      containerHeight: 320,
      width: width,
      height: 60 
    });
    return { 
      draggableRef: draggable.ref,
      dx: draggable.dx,
      dy: draggable.dy,
      width 
    };
  });

  return (
    <div className="relative w-full h-[320px] bg-[#393A3F] rounded-[6px]">
      {keys.map((props, index) => (
        <Key key={index} {...props} />
      ))}
    </div>
  );
}

function Key({ draggableRef, dx, dy, width }) {
  return (
    <div
      ref={draggableRef}
      className="absolute bg-white rounded-[6px] h-[60px]"
      style={{
        transform: `translate(${dx}px, ${dy}px)`,
        width: `${width}px`,
      }}
    />
  );
}