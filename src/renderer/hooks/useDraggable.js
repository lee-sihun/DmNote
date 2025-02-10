import { useState, useEffect, useCallback } from "react";

export const useDraggable = ({ gridSize, initialX = 0, initialY = 0, onPositionChange }) => {
  const [node, setNode] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [wasMoved, setWasMoved] = useState(false);
  const [{ dx, dy }, setOffset] = useState({
    dx: initialX,
    dy: initialY,
  });

  // initialX, initialY가 변경될 때마다 position 업데이트
  useEffect(() => {
    setOffset({ dx: initialX, dy: initialY });
  }, [initialX, initialY]);

  const ref = useCallback((nodeEle) => {
    setNode(nodeEle);
  }, []);

  const handleMouseOver = () => {
    if (node && !isDragging) node.style.cursor = 'grab';
  };

  const handleMouseOut = () => {
    if (node && !isDragging) node.style.cursor = 'default';
  };

  const handleMouseDown = useCallback((e) => {
    if (!node) return;
    setIsDragging(true);
    setWasMoved(false);  // 드래그 시작시 이동 여부 초기화
    node.style.cursor = 'grabbing';

    const startPos = {
      x: e.clientX - dx,
      y: e.clientY - dy,
    };
    const initialPosition = { dx, dy };  // 초기 위치 저장

    const handleMouseMove = (e) => {
      const parentNode = node.parentElement;
      const parentRect = parentNode.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();

      const newDx = e.clientX - startPos.x;
      const newDy = e.clientY - startPos.y;

      const maxX = parentRect.width - nodeRect.width;
      const maxY = parentRect.height - nodeRect.height;

      const snappedX = Math.min(Math.max(Math.round(newDx / gridSize) * gridSize, 0), maxX);
      const snappedY = Math.min(Math.max(Math.round(newDy / gridSize) * gridSize, 0), maxY);

      // 초기 위치와 비교하여 이동 여부 체크
      if (snappedX !== initialPosition.dx || snappedY !== initialPosition.dy) {
        setWasMoved(true);
      }

      setOffset({ dx: snappedX, dy: snappedY });
      onPositionChange?.(snappedX, snappedY);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsDragging(false);
      node.style.cursor = 'grab';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [node, dx, dy, gridSize]);

  useEffect(() => {
    if (!node) return;

    node.addEventListener('mousedown', handleMouseDown);
    node.addEventListener('mouseover', handleMouseOver);
    node.addEventListener('mouseout', handleMouseOut);

    return () => {
      node.removeEventListener('mousedown', handleMouseDown);
      node.removeEventListener('mouseover', handleMouseOver);
      node.removeEventListener('mouseout', handleMouseOut);
    };
  }, [node, handleMouseDown]);

  return { ref, dx, dy, wasMoved };
};