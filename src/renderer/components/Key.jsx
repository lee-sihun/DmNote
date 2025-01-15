import React, { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@hooks/useDraggable';
import { getKeyInfoByGlobalKey } from '@utils/KeyMaps';

export default function DraggableKey({ index, position, keyName, onPositionChange, onClick }) {
  const { displayName } = getKeyInfoByGlobalKey(keyName);
  const { dx, dy, width, activeImage, inactiveImage } = position;
  const draggable = useDraggable({
    gridSize: 10,
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
      className="absolute rounded-[6px] h-[60px] cursor-pointer"
      style={{
        width: `${width}px`,
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
  const { ipcRenderer } = window.require("electron");
  const keyRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const { dx, dy, width, activeImage, inactiveImage } = position;

  useEffect(() => {
    const el = keyRef.current;
    const handleMouseEnter = () => !isDragging && ipcRenderer.send('overlay-toggle-ignore-mouse', false);
    const handleMouseLeave = () => !isDragging && ipcRenderer.send('overlay-toggle-ignore-mouse', true);

    // 전역 마우스 이벤트 핸들러
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        ipcRenderer.send('overlay-toggle-ignore-mouse', true);
      }
    };

    const handleGlobalMouseMove = (e) => {
      if (isDragging) {
        requestAnimationFrame(() => {
          ipcRenderer.send('overlay-move', e.movementX, e.movementY);
        });
      }
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);

    return () => {
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [isDragging]);
  
  return (
    <div 
      ref={keyRef}
      onMouseDown={() => {
        setIsDragging(true);
        ipcRenderer.send('overlay-toggle-ignore-mouse', false);
      }}
      className="image-rendering absolute rounded-[6px] h-[60px] hover:cursor-grab active:cursor-grabbing"
      style={{
        width: `${width}px`,
        transform: `translate3d(${dx}px, ${dy}px, 0)`, // GPU 가속
        backgroundColor: (active && activeImage) || (!active && inactiveImage) ? 'transparent' :
                        (active ? '#575757' : 'white'),
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