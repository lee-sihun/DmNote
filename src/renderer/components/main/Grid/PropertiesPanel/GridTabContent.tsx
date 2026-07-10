import React from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useSettingsStore, type GridSettings } from '@stores/useSettingsStore';
import { PropertySection, PropertyRow, NumberInput } from './PropertyInputs';
import Checkbox from '@components/main/common/Checkbox';

// ============================================================================
// 그리드 탭 콘텐츠 컴포넌트
// ============================================================================

// 체크박스 행 컴포넌트
const CheckboxRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: () => void;
}> = ({ label, checked, onChange }) => (
  <div className="flex justify-between items-center w-full min-h-[32px]">
    <p className="text-fg-muted text-label">{label}</p>
    <Checkbox checked={checked} onChange={onChange} />
  </div>
);

const GridTabContent: React.FC = () => {
  const { t } = useTranslation();
  const { gridSettings, setGridSettings } = useSettingsStore();

  // 설정 변경 핸들러 (즉시 저장)
  const handleSettingChange = async (
    key: keyof GridSettings,
    value: boolean | number,
  ) => {
    const newSettings: GridSettings = {
      ...gridSettings,
      [key]: value,
    };
    setGridSettings(newSettings);
    try {
      await window.api.settings.update({ gridSettings: newSettings });
    } catch (error) {
      console.error('Failed to update grid settings', error);
    }
  };

  return (
    <div className="flex flex-col gap-[12px] p-[12px]">
      {/* 그리드 */}
      <PropertySection>
        <PropertyRow label={t('gridSettings.gridSnapSize')}>
          <NumberInput
            value={gridSettings.gridSnapSize}
            onChange={(val) => handleSettingChange('gridSnapSize', val)}
            min={1}
            max={10}
            suffix="px"
            width="54px"
          />
        </PropertyRow>

        {/* 오버레이 여백 */}
        <PropertyRow label={t('gridSettings.overlayPadding')}>
          <NumberInput
            value={gridSettings.overlayPadding}
            onChange={(val) => handleSettingChange('overlayPadding', val)}
            min={0}
            max={30}
            suffix="px"
            width="54px"
          />
        </PropertyRow>
      </PropertySection>

      {/* 미니맵 */}
      <PropertySection>
        <CheckboxRow
          label={t('gridSettings.minimapEnabled')}
          checked={gridSettings.minimapEnabled}
          onChange={() =>
            handleSettingChange('minimapEnabled', !gridSettings.minimapEnabled)
          }
        />
      </PropertySection>

      {/* 스마트 가이드 */}
      <PropertySection>
        <CheckboxRow
          label={t('gridSettings.alignmentGuides')}
          checked={gridSettings.alignmentGuides}
          onChange={() =>
            handleSettingChange(
              'alignmentGuides',
              !gridSettings.alignmentGuides,
            )
          }
        />
        <CheckboxRow
          label={t('gridSettings.spacingGuides')}
          checked={gridSettings.spacingGuides}
          onChange={() =>
            handleSettingChange('spacingGuides', !gridSettings.spacingGuides)
          }
        />
        <CheckboxRow
          label={t('gridSettings.sizeMatchGuides')}
          checked={gridSettings.sizeMatchGuides}
          onChange={() =>
            handleSettingChange(
              'sizeMatchGuides',
              !gridSettings.sizeMatchGuides,
            )
          }
        />
      </PropertySection>
    </div>
  );
};

export default GridTabContent;
