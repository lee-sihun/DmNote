import React from 'react';
import type { KeyPosition } from '@src/types/key/keys';
import type { GradientSpec } from '@src/types/color';
import type {
  EditorShadowPropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import type { GradientCanvasAnchor } from '@stores/grid/useGradientEditStore';
import { gradientToCss } from '@src/types/color';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/element/elementDefaults';
import {
  elementShadowLeafFromPartial,
  resolveElementShadowForPosition,
} from '@src/types/key/shadows';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/color/ColorSwatch';
import ShadowControls from '../controls/ShadowControls';
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from '../controls/PropertyInputs';

interface SingleSurfaceSectionProps {
  keyPosition: KeyPosition;
  backgroundColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  borderColorButtonRef: React.RefObject<HTMLButtonElement | null>;
  backgroundColorOpen: boolean;
  borderColorOpen: boolean;
  backgroundColor: string;
  borderColor: string;
  backgroundGradient: GradientSpec | null;
  borderGradient: GradientSpec | null;
  onBackgroundColorToggle: () => void;
  onBorderColorToggle: () => void;
  showImagePicker: boolean;
  imageButtonRef?: React.RefObject<HTMLButtonElement>;
  onToggleImagePicker?: () => void;
  shadowActiveState: boolean;
  canvasAnchor?: GradientCanvasAnchor;
  panelElement?: HTMLElement | null;
  onStylePreview: (patch: EditorStylePropertyPreviewPatchV1) => void;
  onBorderWidthCommit: (value: number) => void;
  onBorderRadiusCommit: (value: number) => void;
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  t: (key: string) => string;
}

const SingleSurfaceSection = ({
  keyPosition,
  backgroundColorButtonRef,
  borderColorButtonRef,
  backgroundColorOpen,
  borderColorOpen,
  backgroundColor,
  borderColor,
  backgroundGradient,
  borderGradient,
  onBackgroundColorToggle,
  onBorderColorToggle,
  showImagePicker,
  imageButtonRef,
  onToggleImagePicker,
  shadowActiveState,
  canvasAnchor,
  panelElement,
  onStylePreview,
  onBorderWidthCommit,
  onBorderRadiusCommit,
  onShadowCommit,
  t,
}: SingleSurfaceSectionProps) => {
  const shadowElementType = shadowActiveState ? 'key' : 'stat';
  const idleShadow = resolveElementShadowForPosition({
    position: keyPosition,
    elementType: shadowElementType,
    active: false,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });
  const activeShadow = resolveElementShadowForPosition({
    position: keyPosition,
    elementType: shadowElementType,
    active: true,
    defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
    defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  });

  return (
    <>
      <PropertySection>
        <PropertyRow label={t('propertiesPanel.backgroundColor') || '배경색'}>
          <ColorSwatchButton
            ref={backgroundColorButtonRef}
            type="button"
            onClick={onBackgroundColorToggle}
            open={backgroundColorOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={backgroundColor}
            image={
              backgroundGradient ? gradientToCss(backgroundGradient) : undefined
            }
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.borderColor') || '테두리 색상'}>
          <ColorSwatchButton
            ref={borderColorButtonRef}
            type="button"
            onClick={onBorderColorToggle}
            open={borderColorOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={borderColor}
            image={borderGradient ? gradientToCss(borderGradient) : undefined}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.borderWidth') || '테두리 두께'}>
          <NumberInput
            value={keyPosition.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH}
            onChange={onBorderWidthCommit}
            onPreview={(value) =>
              onStylePreview({ property: 'borderWidth', value })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={20}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.borderRadius') || '모서리 반경'}>
          <NumberInput
            value={keyPosition.borderRadius ?? DEFAULT_ELEMENT_RADIUS}
            onChange={onBorderRadiusCommit}
            onPreview={(value) =>
              onStylePreview({ property: 'borderRadius', value })
            }
            onCancel={() => editGestureController.cancel()}
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        {onToggleImagePicker && imageButtonRef && (
          <PropertyRow
            label={t('propertiesPanel.customImage') || '커스텀 이미지'}
          >
            <button
              ref={imageButtonRef}
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                showImagePicker ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={onToggleImagePicker}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>
        )}
      </PropertySection>

      <ShadowControls
        idleShadow={idleShadow}
        activeShadow={activeShadow}
        showActiveState={shadowActiveState}
        previewAnchor={canvasAnchor ?? null}
        onChange={(state, _shadow, patch) => {
          const leaf = elementShadowLeafFromPartial(patch);
          if (!leaf) return;
          onShadowCommit?.(
            state === 'active'
              ? { property: 'activeShadow', value: leaf }
              : { property: 'shadow', value: leaf },
          );
        }}
        onPreview={(state, leaf) =>
          onStylePreview({
            property: state === 'active' ? 'activeShadow' : 'shadow',
            value: leaf,
          })
        }
        onPreviewCancel={() => editGestureController.cancel()}
        onEnabledChange={(enabled) => {
          onShadowCommit?.({ property: 'shadowEnabled', value: enabled });
        }}
        panelElement={panelElement}
        t={t}
      />
    </>
  );
};

export default SingleSurfaceSection;
