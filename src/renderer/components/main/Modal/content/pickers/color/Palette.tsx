import React, { useEffect, useRef, useState } from 'react';
import {
  parseHexColor,
  buildGradient,
  isGradientColor,
} from '@utils/color/colorUtils';
import { ColorSwatchButton } from './ColorSwatch';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';

type PaletteValue = string | { type: 'gradient'; top: string; bottom: string };

interface PaletteProps {
  color: string;
  onColorChange: (color: PaletteValue) => void;
}

interface ColorProps {
  color: string;
  onClick: () => void;
}

const normalizePaletteValue = (next: PaletteValue): PaletteValue => {
  if (typeof next === 'string') {
    return parseHexColor(next)?.hex ?? next;
  }
  return isGradientColor(next) ? buildGradient(next.top, next.bottom) : next;
};

const Palette = ({ color, onColorChange }: PaletteProps) => {
  const [draftColor, setDraftColor] = useState(color);
  const inputRef = useRef<HTMLInputElement>(null);
  const textSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<string>
  > | null>(null);

  useEffect(() => {
    const scheduler = createRafLatestScheduler((next: string) =>
      onColorChange(normalizePaletteValue(next)),
    );
    textSchedulerRef.current = scheduler;
    return () => {
      scheduler.flush();
      textSchedulerRef.current = null;
    };
  }, [onColorChange]);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 비포커스 controlled 값 동기화
      setDraftColor(color);
    }
  }, [color]);

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

  const handleColorChange = (next: PaletteValue): void => {
    textSchedulerRef.current?.flush();
    if (typeof next === 'string') setDraftColor(next);
    onColorChange(normalizePaletteValue(next));
  };

  return (
    // 표면 클래스는 호출부가 소유 - 박스를 만들지 않고 클릭만 가로챈다
    <div className="contents" onClick={(e) => e.stopPropagation()}>
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
        ref={inputRef}
        type="text"
        placeholder="#FFFFFF"
        value={draftColor}
        onChange={(event) => {
          const next = event.target.value;
          setDraftColor(next);
          textSchedulerRef.current?.push(next);
        }}
        onBlur={() => textSchedulerRef.current?.flush()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') textSchedulerRef.current?.flush();
        }}
        className="w-[142px] h-[22px] mt-[10px] rounded-md bg-inset focus:shadow-focus-ring px-[10px] flex items-center text-body text-fg"
      />
    </div>
  );
};

export default Palette;

const Color = ({ color, onClick }: ColorProps) => {
  return (
    <ColorSwatchButton
      className="w-[22px] h-[22px] rounded-md hover:scale-110 transition-transform duration-fast ease-out-expo"
      surfaceClassName="rounded-md"
      color={color}
      onClick={onClick}
      title={color}
      aria-label={color}
    />
  );
};
