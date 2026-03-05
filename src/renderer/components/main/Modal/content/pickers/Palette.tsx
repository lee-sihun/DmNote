import React from 'react';
import {
  parseHexColor,
  buildGradient,
  isGradientColor,
} from '@utils/color/colorUtils';

interface PaletteProps {
  color: string;
  onColorChange: (color: string | { type: 'gradient'; top: string; bottom: string }) => void;
}

interface ColorProps {
  color: string;
  onClick: () => void;
}

export default function Palette({ color, onColorChange }: PaletteProps) {
  const colors = [
    '#D9E3F0',
    '#F47373',
    '#697689',
    '#37D67A',
    '#2CCCE4',
    '#555555',
    '#DCE775',
    '#FF8A65',
    '#BA68C8',
    'transparent',
  ];

  const handleColorChange = (next: string | { type: 'gradient'; top: string; bottom: string }): void => {
    if (typeof next === 'string') {
      const parsed = parseHexColor(next);
      if (!parsed) {
        onColorChange(next);
        return;
      }
      onColorChange(parsed.hex);
      return;
    }
    if (isGradientColor(next)) {
      onColorChange(buildGradient(next.top, next.bottom));
      return;
    }
    onColorChange(next);
  };

  return (
    <div
      className="flex flex-col justify-between rounded-[13px] bg-button-primary border-button-hover border-[1px] p-[8px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-5 gap-x-[8px] gap-y-[8px]">
        {colors.map((colorItem) => (
          <Color
            key={colorItem}
            color={colorItem}
            onClick={() => handleColorChange(colorItem)}
          />
        ))}
      </div>
      <input
        type="text"
        placeholder="#FFFFFF"
        value={color}
        onChange={(e) => handleColorChange(e.target.value)}
        className="w-[142px] h-[22px] mt-[10px] rounded-[7px] bg-button-hover border-button-active border-[1px] px-[10px] flex items-center text-style-3 text-[#DBDEE8]"
      />
    </div>
  );
}

function Color({ color, onClick }: ColorProps) {
  return (
    <button
      className="w-[22px] h-[22px] border-[1px] border-button-active rounded-[7px]"
      style={{ backgroundColor: color }}
      onClick={onClick}
    />
  );
}
