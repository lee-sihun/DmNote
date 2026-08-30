import type { KeyPosition } from '@src/types/key/keys';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { NumberInput, PropertyRow, PropertySection } from '../PropertyInputs';

type GeometryField = 'dx' | 'dy' | 'width' | 'height';

interface SingleGeometrySectionProps {
  keyPosition: KeyPosition;
  localDx?: number;
  localDy?: number;
  localWidth?: number;
  localHeight?: number;
  onLocalDxChange?: (value: number) => void;
  onLocalDyChange?: (value: number) => void;
  onLocalWidthChange?: (value: number) => void;
  onLocalHeightChange?: (value: number) => void;
  onGeometryPreview?: (field: GeometryField, value: number) => void;
  onGeometryCommit?: (field: GeometryField, value: number) => void;
  t: (key: string) => string;
}

const SingleGeometrySection = ({
  keyPosition,
  localDx,
  localDy,
  localWidth,
  localHeight,
  onLocalDxChange,
  onLocalDyChange,
  onLocalWidthChange,
  onLocalHeightChange,
  onGeometryPreview,
  onGeometryCommit,
  t,
}: SingleGeometrySectionProps) => {
  const isIndividualMode = !onLocalDxChange;
  const commitPosition = (
    field: 'dx' | 'dy',
    value: number,
    onLocalChange?: (nextValue: number) => void,
  ) => {
    onLocalChange?.(value);
    onGeometryCommit?.(field, value);
  };
  const commitSize = (
    field: 'width' | 'height',
    value: number,
    onLocalChange?: (nextValue: number) => void,
  ) => {
    onLocalChange?.(value);
    onGeometryCommit?.(field, value);
  };
  const previewSize = (
    field: 'width' | 'height',
    value: number,
    onLocalChange?: (nextValue: number) => void,
  ) => {
    onLocalChange?.(value);
    onGeometryPreview?.(field, value);
  };

  return (
    <PropertySection>
      <PropertyRow label={t('propertiesPanel.position') || '위치'}>
        <NumberInput
          value={isIndividualMode ? keyPosition.dx : localDx ?? keyPosition.dx}
          onChange={(value) => commitPosition('dx', value, onLocalDxChange)}
          onPreview={(value) => onGeometryPreview?.('dx', value)}
          onCancel={() => editGestureController.cancel()}
          prefix="X"
          width={AXIS_FIELD_WIDTH}
          min={-9999}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
        <NumberInput
          value={isIndividualMode ? keyPosition.dy : localDy ?? keyPosition.dy}
          onChange={(value) => commitPosition('dy', value, onLocalDyChange)}
          onPreview={(value) => onGeometryPreview?.('dy', value)}
          onCancel={() => editGestureController.cancel()}
          prefix="Y"
          width={AXIS_FIELD_WIDTH}
          min={-9999}
          max={9999}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>

      <PropertyRow label={t('propertiesPanel.size') || '크기'}>
        <NumberInput
          value={
            isIndividualMode
              ? keyPosition.width ?? 60
              : localWidth ?? keyPosition.width ?? 60
          }
          onChange={(value) => commitSize('width', value, onLocalWidthChange)}
          onPreview={(value) => previewSize('width', value, onLocalWidthChange)}
          onCancel={() => editGestureController.cancel()}
          prefix="W"
          width={AXIS_FIELD_WIDTH}
          min={1}
          max={999}
          allowDecimal
          decimalScale={1}
        />
        <NumberInput
          value={
            isIndividualMode
              ? keyPosition.height ?? 60
              : localHeight ?? keyPosition.height ?? 60
          }
          onChange={(value) => commitSize('height', value, onLocalHeightChange)}
          onPreview={(value) =>
            previewSize('height', value, onLocalHeightChange)
          }
          onCancel={() => editGestureController.cancel()}
          prefix="H"
          width={AXIS_FIELD_WIDTH}
          min={1}
          max={999}
          allowDecimal
          decimalScale={1}
        />
      </PropertyRow>
    </PropertySection>
  );
};

export default SingleGeometrySection;
