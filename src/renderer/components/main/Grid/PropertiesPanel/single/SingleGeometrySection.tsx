import type { KeyPosition } from '@src/types/key/keys';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from '../controls/PropertyInputs';
import RotationInputRow from '../controls/RotationInputRow';

type GeometryField = 'dx' | 'dy' | 'width' | 'height';
type SingleGeometryKind = 'key-or-stat' | 'graph' | 'knob';

interface SingleGeometryPolicy {
  defaultWidth: number;
  defaultHeight: number;
  minSize: number;
  maxSize: number;
  roundsDisplayedSize: boolean;
}

const GEOMETRY_POLICY: Record<SingleGeometryKind, SingleGeometryPolicy> = {
  'key-or-stat': {
    defaultWidth: 60,
    defaultHeight: 60,
    minSize: 1,
    maxSize: 999,
    roundsDisplayedSize: false,
  },
  graph: {
    defaultWidth: 200,
    defaultHeight: 100,
    minSize: 20,
    maxSize: 9999,
    roundsDisplayedSize: true,
  },
  knob: {
    defaultWidth: 60,
    defaultHeight: 60,
    minSize: 20,
    maxSize: 9999,
    roundsDisplayedSize: true,
  },
};

interface SingleGeometrySectionProps {
  keyPosition: KeyPosition;
  kind?: SingleGeometryKind;
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
  // 회전은 bounds가 아니라 patchElement/rotation 경로 - 둘 다 있을 때만 행을 그린다
  onRotationPreview?: (value: number) => void;
  onRotationCommit?: (value: number) => void;
  t: (key: string) => string | undefined;
}

const SingleGeometrySection = ({
  keyPosition,
  kind = 'key-or-stat',
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
  onRotationPreview,
  onRotationCommit,
  t,
}: SingleGeometrySectionProps) => {
  const isIndividualMode = !onLocalDxChange;
  const policy = GEOMETRY_POLICY[kind];
  const usesNativeItemSizePolicy = kind !== 'key-or-stat';
  const positionLabelFallback = usesNativeItemSizePolicy ? 'Position' : '위치';
  const sizeLabelFallback = usesNativeItemSizePolicy ? 'Size' : '크기';
  const displayPosition = (field: 'dx' | 'dy', localValue?: number) => {
    const value = isIndividualMode ? keyPosition[field] : localValue;
    return usesNativeItemSizePolicy ? value || 0 : value ?? keyPosition[field];
  };
  const displaySize = (
    field: 'width' | 'height',
    defaultValue: number,
    localValue?: number,
  ) => {
    const value = isIndividualMode
      ? keyPosition[field]
      : localValue ?? keyPosition[field];
    const resolved = usesNativeItemSizePolicy
      ? value || defaultValue
      : value ?? defaultValue;
    return policy.roundsDisplayedSize ? Math.round(resolved) : resolved;
  };
  const normalizeSize = (value: number) =>
    usesNativeItemSizePolicy ? Math.max(policy.minSize, value) : value;
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
      <PropertyRow
        label={t('propertiesPanel.position') || positionLabelFallback}
      >
        <NumberInput
          value={displayPosition('dx', localDx)}
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
          value={displayPosition('dy', localDy)}
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

      <PropertyRow label={t('propertiesPanel.size') || sizeLabelFallback}>
        <NumberInput
          value={displaySize('width', policy.defaultWidth, localWidth)}
          onChange={(value) =>
            commitSize('width', normalizeSize(value), onLocalWidthChange)
          }
          onPreview={(value) =>
            previewSize('width', normalizeSize(value), onLocalWidthChange)
          }
          onCancel={() => editGestureController.cancel()}
          prefix="W"
          width={AXIS_FIELD_WIDTH}
          min={policy.minSize}
          max={policy.maxSize}
          {...(!usesNativeItemSizePolicy
            ? { allowDecimal: true, decimalScale: 1 }
            : {})}
        />
        <NumberInput
          value={displaySize('height', policy.defaultHeight, localHeight)}
          onChange={(value) =>
            commitSize('height', normalizeSize(value), onLocalHeightChange)
          }
          onPreview={(value) =>
            previewSize('height', normalizeSize(value), onLocalHeightChange)
          }
          onCancel={() => editGestureController.cancel()}
          prefix="H"
          width={AXIS_FIELD_WIDTH}
          min={policy.minSize}
          max={policy.maxSize}
          {...(!usesNativeItemSizePolicy
            ? { allowDecimal: true, decimalScale: 1 }
            : {})}
        />
      </PropertyRow>

      {onRotationCommit && onRotationPreview && (
        <RotationInputRow
          label={t('propertiesPanel.rotation') || '회전'}
          value={keyPosition.rotation ?? 0}
          onPreview={onRotationPreview}
          onChange={onRotationCommit}
          onCancel={() => editGestureController.cancel()}
        />
      )}
    </PropertySection>
  );
};

export default SingleGeometrySection;
