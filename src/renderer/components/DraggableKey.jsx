import React from 'react';
import { useDraggable } from '@hooks/useDraggable';

export default function DraggableKey({ index, position, keyName, onPositionChange, onClick }) {
  const { dx, dy, width } = position;
  const draggable = useDraggable({
    gridSize: 10,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx, newDy) => onPositionChange(index, newDx, newDy)
  });

  return (
    <div
      ref={draggable.ref}
      className="absolute bg-white rounded-[6px] h-[60px] cursor-pointer"
      style={{
        width: `${width}px`,
        transform: `translate(${draggable.dx}px, ${draggable.dy}px)`
      }}
      onClick={onClick}
    >
      <div className="flex items-center justify-center h-full">{keyName}</div>
    </div>
  );
};