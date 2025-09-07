import React, { useRef, useEffect } from "react";

// 경량 KPS 그래프 (Canvas 2D)
// - 매 샘플시 전체 캔버스 clear 후 재그림 (240x50 수준이므로 비용 미미)
// - ring buffer 로 값 저장, 평균선은 수평선
// - 값은 외부 ref에서 직접 읽기 (React 렌더 최소화)
export function KpsGraph({
  instantKpsRef,
  avgKpsRef,
  peakKpsRef,
  sampleHz = 30,
  width = 240,
  height = 60,
  dynamicScale = true,
  baseMax = 20,
  style = {},
}) {
  const canvasRef = useRef(null);
  const valuesRef = useRef(new Float32Array(width));
  const writeRef = useRef(0);
  const maxScaleRef = useRef(baseMax);

  useEffect(() => {
    let rafId;
    const interval = 1000 / sampleHz;
    let last = performance.now();
    const ctx = canvasRef.current?.getContext("2d", { alpha: true });
    if (!ctx) return;

    const draw = () => {
      const now = performance.now();
      if (now - last >= interval) {
        last = now;
        const inst = instantKpsRef.current || 0;
        valuesRef.current[writeRef.current] = inst;
        writeRef.current = (writeRef.current + 1) % valuesRef.current.length;

        if (dynamicScale) {
          if (inst > maxScaleRef.current * 0.9) {
            maxScaleRef.current = Math.max(
              inst * 1.2,
              maxScaleRef.current * 1.2
            );
          }
        }

        // 전체 리드로우
        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 1;

        const maxScale = maxScaleRef.current;
        // Polyline
        ctx.beginPath();
        for (let i = 0; i < valuesRef.current.length; i++) {
          // ring buffer 순서 정렬
          const idx = (writeRef.current + i) % valuesRef.current.length;
          const v = valuesRef.current[idx];
          const x = i;
          const y = Math.round((1 - Math.min(v / maxScale, 1)) * (height - 1));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#56C9FF";
        ctx.stroke();

        // 평균선
        const avg = avgKpsRef.current || 0;
        const avgY =
          Math.round((1 - Math.min(avg / maxScale, 1)) * (height - 1)) + 0.5;
        ctx.strokeStyle = "#FFA500";
        ctx.beginPath();
        ctx.moveTo(0, avgY);
        ctx.lineTo(width, avgY);
        ctx.stroke();

        // 텍스트 (상단 좌측)
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#FFFFFF";
        ctx.textBaseline = "top";
        ctx.fillText(
          `Inst ${instantKpsRef.current.toFixed(1)} / Avg ${avg.toFixed(1)}`,
          4,
          2
        );
        ctx.fillText(`Peak ${peakKpsRef.current.toFixed(1)}`, 4, 14);
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [sampleHz, width, height, dynamicScale]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width,
        height,
        imageRendering: "pixelated",
        filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))",
        ...style,
      }}
    />
  );
}
