import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import TabSwitch from '@components/main/common/TabSwitch';
import { MODES, type GradientColor } from '@utils/color/colorUtils';
import {
  isGradientSpecColor,
  type GradientSpecColor,
} from '@utils/color/colorPaletteStorage';
import { gradientToCss, toCanonicalGradient } from '@src/types/color';
import { ColorSwatchButton } from './ColorSwatch';

export type PaletteValue = string | GradientColor | GradientSpecColor;

interface ColorPaletteSectionProps {
  solidPalette: PaletteValue[];
  gradientPalette: PaletteValue[];
  onPaletteClick: (color: PaletteValue, type: string) => void;
  showGradient: boolean;
  solidLocked?: boolean;
}

export const ColorPaletteSection = ({
  solidPalette,
  gradientPalette,
  onPaletteClick,
  showGradient,
  solidLocked = false,
}: ColorPaletteSectionProps) => {
  const PALETTE_SIZE = 7;
  const filledSolid: (PaletteValue | null)[] = [...solidPalette];
  while (filledSolid.length < PALETTE_SIZE) filledSolid.push(null);
  const filledGradient: (PaletteValue | null)[] = [...gradientPalette];
  while (filledGradient.length < PALETTE_SIZE) filledGradient.push(null);

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex gap-[6px] justify-between">
        {filledSolid.map((color, index) => (
          <PaletteSlot
            key={`solid-${index}`}
            color={color}
            type="solid"
            disabled={solidLocked}
            onClick={() => color && onPaletteClick(color, 'solid')}
          />
        ))}
      </div>
      {showGradient && (
        <div className="flex gap-[6px] justify-between">
          {filledGradient.map((color, index) => (
            <PaletteSlot
              key={`gradient-${index}`}
              color={color}
              type="gradient"
              onClick={() => color && onPaletteClick(color, 'gradient')}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface PaletteSlotProps {
  color: PaletteValue | null;
  type: string;
  onClick?: () => void;
  disabled?: boolean;
}

const PaletteSlot = ({
  color,
  type,
  onClick,
  disabled = false,
}: PaletteSlotProps) => {
  const isEmpty = !color;
  const inert = isEmpty || disabled;
  const specImage = isGradientSpecColor(color)
    ? gradientToCss(toCanonicalGradient(color))
    : undefined;
  const gradient =
    type === 'gradient' &&
    color &&
    typeof color === 'object' &&
    (color as GradientColor).type === 'gradient'
      ? (color as GradientColor)
      : undefined;
  const solidColor =
    typeof color === 'string'
      ? color.startsWith('#') || color.startsWith('rgb')
        ? color
        : `#${color}`
      : isEmpty
      ? 'var(--ui-fill-faint)'
      : undefined;

  const getTitle = (): string => {
    if (isEmpty) return '';
    if (isGradientSpecColor(color)) {
      const canonical = toCanonicalGradient(color);
      const stops = canonical.stops
        .map((stop) => stop.color.replace('#', '').toUpperCase())
        .join('\n');
      return `${stops}\n${canonical.angle}°`;
    }
    if (
      type === 'gradient' &&
      color &&
      typeof color === 'object' &&
      (color as GradientColor).type === 'gradient'
    ) {
      const gradientColor = color as GradientColor;
      return `${gradientColor.top
        .replace('#', '')
        .toUpperCase()}\n${gradientColor.bottom
        .replace('#', '')
        .toUpperCase()}`;
    }
    if (typeof color === 'string') {
      if (color.startsWith('rgba(')) {
        const match = color.match(
          /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
        );
        if (match) {
          const [, red, green, blue, alpha] = match;
          return `${parseInt(red).toString(16).padStart(2, '0')}${parseInt(
            green,
          )
            .toString(16)
            .padStart(2, '0')}${parseInt(blue)
            .toString(16)
            .padStart(2, '0')}${Math.round(parseFloat(alpha) * 255)
            .toString(16)
            .padStart(2, '0')}`.toUpperCase();
        }
      }
      return color.replace('#', '').toUpperCase();
    }
    return '';
  };

  return (
    <ColorSwatchButton
      type="button"
      className={`w-[16px] h-[16px] rounded transition-colors ${
        inert ? 'cursor-default' : 'cursor-pointer'
      }`}
      surfaceClassName="rounded"
      color={solidColor}
      gradient={gradient}
      image={specImage}
      onClick={inert ? undefined : onClick}
      disabled={inert}
      data-palette-slot={type}
      title={getTitle()}
    />
  );
};

interface StateSwitchProps {
  state?: string;
  onChange?: (mode: string) => void;
}

export const StateSwitch = ({ state, onChange }: StateSwitchProps) => {
  const { t } = useTranslation();
  return (
    <TabSwitch
      commitStrategy="after-paint"
      tabs={[
        { id: 'idle', label: t('colorPicker.idle') || '대기' },
        { id: 'active', label: t('colorPicker.active') || '입력' },
      ]}
      activeTab={state ?? 'idle'}
      onTabChange={(id) => onChange?.(id)}
    />
  );
};

interface ModeSwitchProps {
  mode: string;
  onChange: (mode: string) => void;
}

export const ModeSwitch = ({ mode, onChange }: ModeSwitchProps) => {
  const { t } = useTranslation();
  return (
    <TabSwitch
      commitStrategy="after-paint"
      tabs={[
        { id: MODES.solid, label: t('colorPicker.solid') },
        { id: MODES.gradient, label: t('colorPicker.gradient') },
      ]}
      activeTab={mode}
      onTabChange={onChange}
    />
  );
};
