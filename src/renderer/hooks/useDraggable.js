import { useState, useEffect, useCallback, useRef } from "react";

export const useDraggable = ({
  gridSize,
  initialX = 0,
  initialY = 0,
  onPositionChange,
}) => {
  const [node, setNode] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [wasMoved, setWasMoved] = useState(false);
  const [{ dx, dy }, setOffset] = useState({ dx: initialX, dy: initialY });

  // 마지막 스냅 좌표를 ref로 보관 (mouseup 시 커밋)
  const lastSnappedRef = useRef({ dx: initialX, dy: initialY });

  // initialX, initialY 변경 시 동기화
  useEffect(() => {
    setOffset({ dx: initialX, dy: initialY });
    lastSnappedRef.current = { dx: initialX, dy: initialY };
  }, [initialX, initialY]);

  const ref = useCallback((nodeEle) => {
    setNode(nodeEle);
  }, []);

  const handleMouseOver = () => {
    if (node && !isDragging) node.style.cursor = "grab";
  };

  const handleMouseOut = () => {
    if (node && !isDragging) node.style.cursor = "default";
  };

  const handleMouseDown = useCallback(
    (e) => {
      if (!node) return;
      setIsDragging(true);
      setWasMoved(false);
      node.style.cursor = "grabbing";

      // 드래그 중 성능 최적화
      node.style.pointerEvents = "none";
      node.style.userSelect = "none";

      // bounds를 시작 시점에 1회 계산해서 캐시
      const parentNode = node.parentElement;
      const parentRect = parentNode.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const maxX = parentRect.width - nodeRect.width;
      const maxY = parentRect.height - nodeRect.height;

      const startPos = {
        x: e.clientX - dx,
        y: e.clientY - dy,
      };
      const initialPosition = { dx, dy };

      let rafId = null;

      const handleMouseMove = (moveEvent) => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;

          const newDx = moveEvent.clientX - startPos.x;
          const newDy = moveEvent.clientY - startPos.y;

          const snappedX = Math.min(
            Math.max(Math.round(newDx / gridSize) * gridSize, 0),
            maxX
          );
          const snappedY = Math.min(
            Math.max(Math.round(newDy / gridSize) * gridSize, 0),
            maxY
          );

          if (
            snappedX !== initialPosition.dx ||
            snappedY !== initialPosition.dy
          ) {
            setWasMoved(true);
          }

          lastSnappedRef.current = { dx: snappedX, dy: snappedY };
          setOffset({ dx: snappedX, dy: snappedY }); // 자기 자신만 리렌더
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setIsDragging(false);
        node.style.cursor = "grab";
        node.style.pointerEvents = "auto";
        node.style.userSelect = "auto";

        // 최종 위치만 부모에 커밋
        const { dx: finalDx, dy: finalDy } = lastSnappedRef.current;
        onPositionChange?.(finalDx, finalDy);
      };

      document.addEventListener("mousemove", handleMouseMove, {
        passive: true,
      });
      document.addEventListener("mouseup", handleMouseUp, { once: true });
    },
    [node, dx, dy, gridSize, onPositionChange]
  );

  useEffect(() => {
    if (!node) return;

    node.addEventListener("mousedown", handleMouseDown);
    node.addEventListener("mouseover", handleMouseOver);
    node.addEventListener("mouseout", handleMouseOut);

    return () => {
      node.removeEventListener("mousedown", handleMouseDown);
      node.removeEventListener("mouseover", handleMouseOver);
      node.removeEventListener("mouseout", handleMouseOut);
    };
  }, [node, handleMouseDown]);

  return { ref, dx, dy, wasMoved, isDragging };
};
