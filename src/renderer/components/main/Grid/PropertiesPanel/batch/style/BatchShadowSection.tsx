import ShadowControls from '../../controls/ShadowControls';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import type {
  EditorShadowPropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import {
  elementShadowLeafFromPartial,
  resolveElementShadowForPosition,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/element/elementDefaults';

type MixedValueGetter = <T>(
  getter: (position: KeyPosition) => T | undefined,
  defaultValue: T,
) => { isMixed: boolean; value: T };

interface BatchShadowSectionProps {
  getMixedValue: MixedValueGetter;
  getActiveMixedValue: MixedValueGetter;
  showActiveState: boolean;
  shadowKind: 'key' | 'knob';
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  onStylePropertyPreview?: (patch: EditorStylePropertyPreviewPatchV1) => void;
  panelElement: HTMLElement | null;
  t: (key: string) => string;
}

const BatchShadowSection = ({
  getMixedValue,
  getActiveMixedValue,
  showActiveState,
  shadowKind,
  onShadowCommit,
  onStylePropertyPreview,
  panelElement,
  t,
}: BatchShadowSectionProps) => {
  const resolvedShadowFor = (position: KeyPosition, active: boolean) =>
    resolveElementShadowForPosition({
      position,
      elementType: shadowKind,
      active,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    });

  const getBatchShadow = (active: boolean) => {
    const fallback = active
      ? DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC
      : DEFAULT_ELEMENT_SHADOW_SPEC;
    const mixedValue = active ? getActiveMixedValue : getMixedValue;
    const enabled = mixedValue(
      (position) => resolvedShadowFor(position, active).enabled,
      fallback.enabled,
    );
    const color = mixedValue(
      (position) => resolvedShadowFor(position, active).color,
      fallback.color,
    );
    const offsetX = mixedValue(
      (position) => resolvedShadowFor(position, active).offsetX,
      fallback.offsetX,
    );
    const offsetY = mixedValue(
      (position) => resolvedShadowFor(position, active).offsetY,
      fallback.offsetY,
    );
    const blur = mixedValue(
      (position) => resolvedShadowFor(position, active).blur,
      fallback.blur,
    );

    return {
      value: {
        enabled: enabled.value,
        color: color.value,
        offsetX: offsetX.value,
        offsetY: offsetY.value,
        blur: blur.value,
      },
      // 대표값은 첫 요소 기준 — 토글 표시용 "하나라도 켜짐"은 별도 계산
      enabledAny: enabled.value || enabled.isMixed,
      isMixed:
        enabled.isMixed ||
        color.isMixed ||
        offsetX.isMixed ||
        offsetY.isMixed ||
        blur.isMixed,
    };
  };

  const idleShadow = getBatchShadow(false);
  const activeShadow = getBatchShadow(true);

  const handleShadowChange = (
    state: 'idle' | 'active',
    _shadow: ElementShadowSpec,
    patch: Partial<ElementShadowSpec>,
  ) => {
    const leaf = elementShadowLeafFromPartial(patch);
    if (!leaf) return;
    onShadowCommit?.(
      state === 'active'
        ? { property: 'activeShadow', value: leaf }
        : { property: 'shadow', value: leaf },
    );
  };

  return (
    <ShadowControls
      idleShadow={idleShadow.value}
      activeShadow={activeShadow.value}
      idleMixed={idleShadow.isMixed}
      activeMixed={activeShadow.isMixed}
      anyEnabled={
        idleShadow.enabledAny || (showActiveState && activeShadow.enabledAny)
      }
      showActiveState={showActiveState}
      previewAnchor={{ kind: 'batch' }}
      onChange={handleShadowChange}
      onPreview={(state, leaf) =>
        onStylePropertyPreview?.({
          property: state === 'active' ? 'activeShadow' : 'shadow',
          value: leaf,
        })
      }
      onPreviewCancel={() => editGestureController.cancel()}
      onEnabledChange={(enabled) =>
        onShadowCommit?.({ property: 'shadowEnabled', value: enabled })
      }
      panelElement={panelElement}
      t={t}
    />
  );
};

export default BatchShadowSection;
