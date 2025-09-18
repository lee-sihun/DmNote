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
  ];

  const handleColorChange = (color) => {
    onColorChange(color);
  };

  return (
    <div
      className="flex flex-col justify-between rounded-[13px] bg-[#1A191E] border-[#2A2A30] border-[1px] p-[8px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-5 gap-x-[8px] gap-y-[8px]">
        {colors.map((color) => (
          <Color
            key={color}
            color={color}
            onClick={() => handleColorChange(color)}
          />
        ))}
      </div>
      <input
        type="text"
        placeholder="#FFFFFF"
        value={color}
        onChange={(e) => handleColorChange(e.target.value)}
        className="w-[142px] h-[22px] mt-[10px] rounded-[7px] bg-[#2A2A30] border-[#3A3943] border-[1px] px-[10px] flex items-center text-style-3 text-[#DBDEE8]"
      />
    </div>
  );
}

function Color({ color, onClick }) {
  return (
    <button
      className="w-[22px] h-[22px] border-[1px] border-[#3A3943] rounded-[7px]"
      style={{ backgroundColor: color }}
      onClick={onClick}
    />
  );
}
