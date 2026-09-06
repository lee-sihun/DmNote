import { AngleGlyph } from '@components/main/common/TransformGlyphs';
import { ELEMENT_ROTATION_RANGE } from '@src/types/key/rotation';
import { clampRotation } from '@utils/element/rotation';
import { NumberInput, PropertyRow } from './PropertyInputs';

interface RotationInputRowProps {
  label: string;
  value: number;
  onPreview: (rotation: number) => void;
  onChange: (rotation: number) => void;
  onCancel: () => void;
}

// 요소·스프라이트·선택 공통 회전 행. 값은 ±180으로 잘라 넘기고 세션 처리는 호출부 몫
const RotationInputRow = ({
  label,
  value,
  onPreview,
  onChange,
  onCancel,
}: RotationInputRowProps) => (
  <PropertyRow label={label}>
    <NumberInput
      value={value}
      onPreview={(next) => onPreview(clampRotation(next))}
      onChange={(next) => onChange(clampRotation(next))}
      onCancel={onCancel}
      prefix={<AngleGlyph />}
      ariaLabel={label}
      suffix="°"
      width="80px"
      min={ELEMENT_ROTATION_RANGE.min}
      max={ELEMENT_ROTATION_RANGE.max}
      allowDecimal
      decimalScale={1}
    />
  </PropertyRow>
);

export default RotationInputRow;
