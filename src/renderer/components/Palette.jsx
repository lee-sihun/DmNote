import React from "react";

export default function Palette({ color, onColorChange }) {
  const colors = [
    "#D9E3F0",
    "#F47373",
    "#697689",
    "#37D67A",
    "#2CCCE4",
    "#555555",
    "#DCE775",
    "#FF8A65",
    "#BA68C8",
    "transparent",
  ]

  const handleColorChange = (color) => {
    onColorChange(color);
  }

  return (
    <div 
      className="flex flex-col justify-between absolute w-[264px] h-[166px] rounded-[10px] bg-[#1B1D22] bottom-[18px] left-[66px] border-[#474D58] border-[1px] p-[16px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-5 gap-x-[16px] gap-y-[16px]">
        {colors.map((color) => (
          <Color key={color} color={color} onClick={() => handleColorChange(color)} />
        ))}
      </div>
      <input 
        type="text"
        placeholder="#FFFFFF"
        value={color}
        onChange={(e) => handleColorChange(e.target.value)}
        className="h-[34.5px] rounded-[6px] bg-[#272B33] border-[#101216] border-[1px] px-[10px] flex items-center text-[17px] text-white font-normal" 
      />
    </div>
  )
}

function Color({ color, onClick }) {
  return (
    <button 
      className="w-[33.5px] h-[33.5px] border-[1px] border-[#717171] rounded-[6px]"
      style={{ backgroundColor: color }}
      onClick={onClick}
    />
  )
}