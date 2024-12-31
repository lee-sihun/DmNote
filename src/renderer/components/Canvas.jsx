import React, { useState } from "react";
import { useDraggable } from "@hooks/useDraggable";
import Palette from "./Palette";
import ResetIcon from "@assets/svgs/reset.svg";
import PaletteIcon from "@assets/svgs/palette.svg";

export default function Canvas() {
  return (
    <div className="flex flex-col w-full h-full p-[18px]">
      <Grid />
    </div>
  )
}

function Grid() {
  const [palette, setPalette] = useState(false);
  const [color, setColor] = useState("transparent");

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
    });
    return { 
      draggableRef: draggable.ref,
      dx: draggable.dx,
      dy: draggable.dy,
      width,
    };
  });

  const handlePaletteClose = () => {
    if (palette) setPalette(false);
  }

  return (
    <div 
      className="grid-bg relative w-full h-[320px] bg-[#393A3F] rounded-[6px]"
      style={{ backgroundColor: color === "transparent" ? "#393A3F" : color }}
      onClick={handlePaletteClose}
    >
      {keys.map((props, index) => (
        <Key key={index} {...props} />
      ))}
      <button 
        className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[57px] left-[18px]"
        onClick={() => setPalette(!palette)}
      >
        <object type="image/svg+xml" data={PaletteIcon} className="pointer-events-none w-[12px] h-[12px]"/>
      </button>
      <button className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[18px] left-[18px]">
        <object type="image/svg+xml" data={ResetIcon} className="pointer-events-none w-[12.75px] h-[12px]"/>
      </button>
      {palette && <Palette color={color} onColorChange={setColor} />}
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