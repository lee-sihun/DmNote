import React, { useState, useEffect } from "react";
import { useDraggable } from "@hooks/useDraggable";
import Palette from "./Palette";
import { ReactComponent as ResetIcon } from "@assets/svgs/reset.svg";
import { ReactComponent as PaletteIcon } from "@assets/svgs/palette.svg";
import { getKeyInfo } from "@utils/KeyMaps";

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

  // cleanup
  useEffect(() => {
    setPalette(false); 
    return () => {
      setPalette(false);
    };
  }, []); 

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
        <PaletteIcon /> 
      </button>
      <button className="absolute flex items-center justify-center w-[30px] h-[30px] bg-[#101216] rounded-[6px] bottom-[18px] left-[18px]">
        <ResetIcon /> 
      </button>
      {palette && <Palette color={color} onColorChange={setColor} />}
      <KeySettingModal />
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

function KeySettingModal() {
  const ipcRenderer = window.electron.ipcRenderer;
  const [isListening, setIsListening] = useState(false);
  const [key, setKey] = useState(null);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (isListening) {
        e.preventDefault();
        const info = getKeyInfo(e.code, e.key);
        setKey(info);
        ipcRenderer.send('update-key-mapping', [
          'Z',
          'X',
          'DOT',
          info.globalKey
        ]);
        setIsListening(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isListening]);

  return (
    <div className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px]">
      <div className="flex flex-col items-center justify-center p-[25px] bg-[#1C1E25] border border-[#3B4049] rounded-[6px]">
        <button 
          onClick={() => setIsListening(true)}
          className="flex items-center h-[25px] px-[9px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
        >
          {isListening ? "Press any key..." : key?.displayName || "Click to set key"}
        </button>
      </div>
    </div>
  )
}