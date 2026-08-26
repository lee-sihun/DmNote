import { useMemo } from 'react';
import Dropdown from '@components/main/common/Dropdown';
import { useFontStore } from '@stores/useFontStore';
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamilyName,
} from '@src/types/settings/fonts';
import { getCommonSupportedFontWeights } from '@utils/core/fontWeights';

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
  // 저장값(600 등)이 지원 목록에 없어도 그대로 보여준다 - 최근접값으로 바꿔 보이면
  // 표시와 저장이 어긋나고, 같은 값을 다시 골라도 커밋이 안 나가 되돌릴 수 없다
  const options = useMemo(() => {
    const weights =
      !isMixed && Number.isFinite(value) && !supportedWeights.includes(value)
        ? [...supportedWeights, value].sort((a, b) => a - b)
        : supportedWeights;
    return weights.map((weight) => ({
      label: String(weight),
      value: String(weight),
    }));
  }, [isMixed, supportedWeights, value]);

  return (
    <Dropdown
      commitStrategy="after-paint"
      options={options}
      value={isMixed ? '' : String(value)}
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
