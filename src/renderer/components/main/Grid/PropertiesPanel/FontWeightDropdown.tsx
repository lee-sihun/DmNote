import { useMemo } from 'react';
import Dropdown from '@components/main/common/Dropdown';
import { useFontStore } from '@stores/useFontStore';
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamilyName,
} from '@src/types/settings/fonts';
import {
  findNearestFontWeight,
  getCommonSupportedFontWeights,
} from '@utils/core/fontWeights';

interface FontWeightDropdownProps {
  fontFamilies: readonly (string | null | undefined)[];
  value: number;
  isMixed?: boolean;
  onChange: (value: number) => void;
}

const FontWeightDropdown = ({
  fontFamilies,
  value,
  isMixed = false,
  onChange,
}: FontWeightDropdownProps) => {
  const builtinFonts = useFontStore((state) => state.builtinFonts);
  const customFonts = useFontStore((state) => state.customFonts);
  const familyKey = (
    fontFamilies.length > 0 ? fontFamilies : [DEFAULT_FONT_FAMILY]
  )
    .map((family) => normalizeFontFamilyName(family || DEFAULT_FONT_FAMILY))
    .join('\0');
  const supportedWeights = useMemo(
    () =>
      getCommonSupportedFontWeights(familyKey.split('\0'), [
        ...builtinFonts,
        ...customFonts,
      ]),
    [builtinFonts, customFonts, familyKey],
  );
  const displayedWeight = findNearestFontWeight(value, supportedWeights);

  return (
    <Dropdown
      commitStrategy="after-paint"
      options={supportedWeights.map((weight) => ({
        label: String(weight),
        value: String(weight),
      }))}
      value={isMixed ? '' : String(displayedWeight)}
      placeholder={isMixed ? 'Mixed' : '—'}
      disabled={supportedWeights.length === 0}
      widthClass="w-[72px]"
      onChange={(nextValue) => {
        const nextWeight = Number(nextValue);
        if (Number.isFinite(nextWeight)) onChange(nextWeight);
      }}
    />
  );
};

export default FontWeightDropdown;
