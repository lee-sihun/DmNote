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
  const [isMouseOver, setIsMouseOver] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const { dx, dy, width, activeImage, inactiveImage } = position;

  useEffect(() => {
    const el = keyRef.current;
    
    const handleMouseEnter = () => {
      setIsMouseOver(true);
      ipcRenderer.send('overlay-toggle-ignore-mouse', false);
    };

    const handleMouseLeave = () => {
      setIsMouseOver(false);
      if (!isDragging) {
        ipcRenderer.send('overlay-toggle-ignore-mouse', true);
      }
    };

    const handleGlobalMouseUp = (e) => {
      if (isDragging) {
        setIsDragging(false);
        // 마우스가 element 위에 있는지 확인
        const rect = el.getBoundingClientRect();
        const isOver = 
          e.clientX >= rect.left && 
          e.clientX <= rect.right && 
          e.clientY >= rect.top && 
          e.clientY <= rect.bottom;
        
        if (!isOver) {
          ipcRenderer.send('overlay-toggle-ignore-mouse', true);
        }
        setStartPos({ x: 0, y: 0 });
      }
    };

    const handleGlobalMouseMove = (e) => {
      if (isDragging) {
        const newX = e.screenX - startPos.x;
        const newY = e.screenY - startPos.y;
        ipcRenderer.send('overlay-set-position', newX, newY);
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
  }, [isDragging, startPos, isMouseOver]);


  const handleMouseDown = (e) => {
    setIsDragging(true);
    ipcRenderer.send('overlay-toggle-ignore-mouse', false);
    
    // 윈도우의 현재 위치 가져오기
    ipcRenderer.invoke('overlay-get-position').then(([winX, winY]) => {
      setStartPos({
        x: e.screenX - winX,
        y: e.screenY - winY
      });
    });
  };
  
  return (
    <div 
      ref={keyRef}
      onMouseDown={handleMouseDown}
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