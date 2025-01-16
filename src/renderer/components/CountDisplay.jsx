import React, { useState, useRef, useEffect } from "react";

export default function CountDisplay({ count, position }){
  const [scale, setScale] = useState(1);
  const prevCount = useRef(count);
  const animationRef = useRef(null);
  
  useEffect(() => {
    if (prevCount.current !== count) {
      prevCount.current = count;
      
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const startTime = Date.now();
      const duration = 300; 
      const maxScale = 1.1; 
      
      const getBounceScale = (elapsed) => {
        if (elapsed > duration) return 1.0;
        const progress = elapsed / duration;
        
        // easeOutQuad 적용
        const easeOutQuad = (t) => t * (2 - t);
        const easeProgress = easeOutQuad(progress);
        
        return 1.0 + (maxScale - 1.0) * (1 - easeProgress);
      };

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const currentScale = getBounceScale(elapsed);
        
        setScale(currentScale);

        if (elapsed < duration) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    }
  }, [count]);

  return (
    <div
      className="font-extrabold text-[16px] text-center bg-clip-text text-transparent bg-gradient-to-b from-[#FFFFFF] to-[#757575] [text-shadow:_0_0_0.2px_rgba(255,255,255,0.5)]"
      style={{
        position: 'absolute',
        top: position.dy - 22,
        left: position.dx,
        width: position.width,
        transform: `scale(${scale})`,
        transformOrigin: 'center bottom',
      }}
    >
      {count || 0}
    </div>
  );
};