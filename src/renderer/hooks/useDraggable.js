import { useState, useEffect, useCallback } from "react";

export const useDraggable = ({ gridSize, initialX = 0, initialY = 0, containerWidth, containerHeight, width, height  }) => {
  const [node, setNode] = useState(null);
  const [{ dx, dy }, setOffset] = useState({
    dx: initialX,
    dy: initialY,
  });

  const ref = useCallback((nodeEle) => {
    setNode(nodeEle);
  }, []);

  const handleMouseDown = useCallback((e) => {
    const startPos = {
      x: e.clientX - dx,
      y: e.clientY - dy,
    };

    const handleMouseMove = (e) => {
      // How far the mouse has been moved
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;

      // Calculate maximum distance
      const maxX = containerWidth - width;
      const maxY = containerHeight - height;

      const snappedX = Math.min(Math.max(Math.round(dx / gridSize) * gridSize, 0), maxX);
      const snappedY = Math.min(Math.max(Math.round(dy / gridSize) * gridSize, 0), maxY);

      setOffset({ dx: snappedX, dy: snappedY });
      updateCursor();
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      resetCursor();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [dx, dy]);

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];

    const startPos = {
      x: touch.clientX - dx,
      y: touch.clientY - dy,
    };

    const handleTouchMove = (e) => {
      const touch = e.touches[0];
      const dx = touch.clientX - startPos.x;
      const dy = touch.clientY - startPos.y;
      const snappedX = Math.round(dx / gridSize) * gridSize;
      const snappedY = Math.round(dy / gridSize) * gridSize;
      setOffset({ dx: snappedX, dy: snappedY });
      updateCursor();
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      resetCursor();
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  }, [dx, dy]);

  const updateCursor = () => {
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const resetCursor = () => {
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  };

  useEffect(() => {
    if (!node) {
      return;
    }
    node.addEventListener("mousedown", handleMouseDown);
    node.addEventListener("touchstart", handleTouchStart);
    return () => {
      node.removeEventListener("mousedown", handleMouseDown);
      node.removeEventListener("touchstart", handleTouchStart);
    };
  }, [node, dx, dy]);

  return { ref, dx, dy};
};