import type {
  GraphItemPosition,
  GraphItemType,
} from '@src/types/key/graphItems';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import { ColorInput, NumberInput, PropertyRow } from '../index';
import { previewBatchGraphColor } from '../selection/previewPatchForwarders';
import {
  snapBatchGraphSpeed,
  type BatchGraphSettingsModel,
} from './batchGraphSettingsModel';

interface BatchGraphSettingsSectionProps {
  model: BatchGraphSettingsModel;
  graphIds: readonly string[];
  selectedKeyType: string;
  colorId: string;
  panelElement: HTMLDivElement | null;
  onCommit: (updates: Partial<GraphItemPosition>) => void;
  t: (key: string) => string | undefined;
}

const BatchGraphSettingsSection = ({
  model,
  graphIds,
  selectedKeyType,
  colorId,
  panelElement,
  onCommit,
  t,
}: BatchGraphSettingsSectionProps) => {
  const graphShapeOptions = [
    { label: t('propertiesPanel.graphShapeLine') || 'Line', value: 'line' },
    { label: t('propertiesPanel.graphShapeBar') || 'Bar', value: 'bar' },
  ];

  return (
    <>
      <PropertyRow label={t('propertiesPanel.graphShape') || 'Graph Shape'}>
        {model.graphType.isMixed ? (
          <span className="text-fg-faint text-body italic">Mixed</span>
        ) : null}
        <Dropdown
          commitStrategy="after-paint"
          options={graphShapeOptions}
          value={model.graphType.value}
          onChange={(value) => onCommit({ graphType: value as GraphItemType })}
        />
      </PropertyRow>

      {model.hasLineGraph && (
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('propertiesPanel.graphShowAverageLine') || 'Show Average Line'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={model.showAvgLine.value}
            onChange={() => onCommit({ showAvgLine: !model.showAvgLine.value })}
          />
        </div>
      )}

      <PropertyRow label={t('propertiesPanel.graphSpeed') || 'Graph Speed'}>
        {model.graphSpeed.isMixed ? (
          <span className="text-fg-faint text-body italic">Mixed</span>
        ) : null}
        <NumberInput
          value={model.graphSpeed.value}
          width="62px"
          onChange={(value) =>
            onCommit({ graphSpeed: snapBatchGraphSpeed(value) })
          }
          min={500}
          max={5000}
          suffix="ms"
          isMixed={model.graphSpeed.isMixed}
        />
      </PropertyRow>

      <PropertyRow label={t('propertiesPanel.graphColor') || 'Graph Color'}>
        {model.graphColor.isMixed ? (
          <span className="text-fg-faint text-body italic">Mixed</span>
        ) : null}
        <ColorInput
          value={model.graphColor.value}
          hexMixed={model.graphColorMixed.hex}
          alphaMixed={model.graphColorMixed.alpha}
          onChange={() => {}}
          onPreview={(value) =>
            previewBatchGraphColor(graphIds, selectedKeyType, value)
          }
          onChangeComplete={(value) => onCommit({ graphColor: value })}
          onCancel={() => editGestureController.cancel()}
          colorId={colorId}
          panelElement={panelElement}
        />
      </PropertyRow>

      <div className="flex justify-between items-center w-full min-h-[32px]">
        <p className="text-fg-muted text-label">
          {t('propertiesPanel.graphAnimation') || 'Graph Animation'}
        </p>
        <div className="flex items-center gap-[6px]">
          {model.graphAnimation.isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <Checkbox
            commitStrategy="after-paint"
            checked={model.graphAnimation.value}
            onChange={() =>
              onCommit({
                graphAnimationEnabled: !model.graphAnimation.value,
              })
            }
          />
        </div>
      </div>
    </>
  );
};

export default BatchGraphSettingsSection;
