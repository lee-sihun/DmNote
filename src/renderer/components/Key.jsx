import React, { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@hooks/useDraggable';
import { getKeyInfoByGlobalKey } from '@utils/KeyMaps';

export default function DraggableKey({ index, position, keyName, onPositionChange, onClick }) {
  const { displayName } = getKeyInfoByGlobalKey(keyName);
  const { dx, dy, width, height = 60, activeImage, inactiveImage } = position;
  const draggable = useDraggable({
    gridSize: 5,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx, newDy) => onPositionChange(index, newDx, newDy)
  });

  const handleClick = (e) => {
    if (!draggable.wasMoved) {  // 위치가 변경되지 않았을 때만 onClick 실행
      onClick(e);
    }
  };

  return (
    <div
      ref={draggable.ref}
      className="absolute rounded-[6px] cursor-pointer"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${dx}px, ${dy}px, 0)`, // GPU 가속
        backgroundImage: inactiveImage ? `url(${inactiveImage})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: inactiveImage ? 'transparent' : 'white',
        willChange: 'transform', // GPU 힌트
        backfaceVisibility: 'hidden', // GPU 가속
      }}
      onClick={handleClick}
    >
      {!inactiveImage && (
        <div className="flex items-center justify-center h-full font-semibold">{displayName}</div>
      )}
    </div>
  );
};

export function Key({ keyName, active, position }) {
  const { dx, dy, width, height = 60, activeImage, inactiveImage } = position;
  
  return (
    <div 
      className="image-rendering absolute rounded-[6px]"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${dx}px, ${dy}px, 0)`, // GPU 가속
        backgroundColor: (active && activeImage) || (!active && inactiveImage) ? 'transparent' :
                        (active ? '#575757' : 'white'),
        borderRadius: active ? (activeImage ? '0' : '6px') : (inactiveImage ? '0' : '6px'), 
        color: active && !activeImage ? 'white' : 'black',
        backgroundImage: active && activeImage ? 
          `url(${activeImage})` : 
          (!active && inactiveImage ? `url(${inactiveImage})` : 'none'),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        willChange: 'transform', // GPU 힌트
        backfaceVisibility: 'hidden', // GPU 가속
      }}
    >
      {(!active && !inactiveImage) || (active && !activeImage) ? (
        <div className="flex items-center justify-center h-full font-semibold">{keyName}</div>
      ) : null}
    </div>
  )
}