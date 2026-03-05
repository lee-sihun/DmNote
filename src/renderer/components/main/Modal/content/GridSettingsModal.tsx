import React, { useState } from 'react';
import Modal from '../Modal';
import Checkbox from '@components/main/common/Checkbox';
import { useTranslation } from '@contexts/I18nContext';
import { useSettingsStore, type GridSettings } from '@stores/useSettingsStore';

interface GridSettingsModalProps {
  onClose: () => void;
}

export default function GridSettingsModal({ onClose }: GridSettingsModalProps) {
  const { t } = useTranslation();
  const { gridSettings, setGridSettings } = useSettingsStore();

  // 로컬 상태로 관리 (저장 버튼 누를 때만 적용)
  const [alignmentGuides, setAlignmentGuides] = useState(
    gridSettings.alignmentGuides,
  );
  const [spacingGuides, setSpacingGuides] = useState(
    gridSettings.spacingGuides,
  );
  const [sizeMatchGuides, setSizeMatchGuides] = useState(
    gridSettings.sizeMatchGuides,
  );

  const handleSave = async () => {
    const newSettings: GridSettings = {
      alignmentGuides,
      spacingGuides,
      sizeMatchGuides,
      minimapEnabled: gridSettings.minimapEnabled,
      gridSnapSize: gridSettings.gridSnapSize,
    };
    setGridSettings(newSettings);
    try {
      await window.api.settings.update({ gridSettings: newSettings });
    } catch (error) {
      console.error('Failed to update grid settings', error);
    } finally {
      onClose();
    }
  };

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] gap-[19px] border-[1px] border-[#2A2A30]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 정렬 가이드 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('gridSettings.alignmentGuides')}
          </p>
          <Checkbox
            checked={alignmentGuides}
            onChange={() => setAlignmentGuides((prev) => !prev)}
          />
        </div>

        {/* 간격 일치 가이드 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('gridSettings.spacingGuides')}
          </p>
          <Checkbox
            checked={spacingGuides}
            onChange={() => setSpacingGuides((prev) => !prev)}
          />
        </div>

        {/* 크기 일치 가이드 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('gridSettings.sizeMatchGuides')}
          </p>
          <Checkbox
            checked={sizeMatchGuides}
            onChange={() => setSizeMatchGuides((prev) => !prev)}
          />
        </div>

        {/* 저장/취소 버튼 */}
        <div className="flex gap-[10.5px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t('gridSettings.save')}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t('gridSettings.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
