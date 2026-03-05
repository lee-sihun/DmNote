import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@contexts/I18nContext';
import type { SoundListItem } from '@src/types/api';
import PlusIcon from '@assets/svgs/plus2.svg';
import CommonListPickerPopup from './CommonListPickerPopup';
import SoundManagerModal from './SoundManagerModal';

interface SoundPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  selectedSound: string | null;
  onSoundSelect: (soundPath: string | null) => void;
  onClose: () => void;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  previewVolume?: number;
}

export default function SoundPicker({
  open,
  referenceRef,
  panelElement = null,
  selectedSound,
  onSoundSelect,
  onClose,
  interactiveRefs = [],
  previewVolume,
}: SoundPickerProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'local'>('all');
  const [sounds, setSounds] = useState<SoundListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showManager, setShowManager] = useState(false);

  const normalizedSelectedSound = useMemo(
    () => (selectedSound || '').trim(),
    [selectedSound],
  );

  const loadSounds = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const nextSounds = await window.api.sound.list();
      setSounds(nextSounds);
    } catch (error) {
      console.error('Failed to load sound list', error);
      setLoadError('사운드 목록 로드 실패');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadSounds();
  }, [open, loadSounds]);

  const filterOptions = useMemo(
    () => [
      { value: 'all', label: t('soundPicker.filterAll') || '전체' },
      { value: 'local', label: t('soundPicker.filterLocal') || '로컬 사운드' },
    ],
    [t],
  );

  const filteredSounds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sounds.filter((item) => {
      if (!item.enabled) return false;
      if (filterType === 'local' && item.source !== 'local') {
        return false;
      }
      if (!query) return true;
      return item.fileName.toLowerCase().includes(query);
    });
  }, [filterType, searchQuery, sounds]);

  return (
    <>
      <CommonListPickerPopup<SoundListItem>
        open={open}
        referenceRef={referenceRef}
        panelElement={panelElement}
        interactiveRefs={interactiveRefs}
        onClose={onClose}
        widthClass="w-[156px]"
        estimatedWidth={164}
        estimatedHeight={276}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t('soundPicker.searchPlaceholder') || '검색'}
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) => setFilterType(value as 'all' | 'local')}
        items={filteredSounds}
        renderItem={(item) => {
          const isSelected = item.soundPath === normalizedSelectedSound;
          return (
            <button
              key={item.soundPath}
              type="button"
              onClick={() => onSoundSelect(item.soundPath)}
              className={`w-full min-h-[24px] h-[24px] flex-shrink-0 px-[8px] rounded-[7px] text-left text-style-4 transition-colors truncate ${
                isSelected
                  ? 'bg-[#2E2D33] text-[#FFFFFF]'
                  : 'text-[#DBDEE8] hover:bg-[#26262C]'
              }`}
              title={item.fileName}
            >
              {item.fileName}
            </button>
          );
        }}
        emptyText={t('soundPicker.noSounds') || '사운드 없음'}
        isLoading={isLoading}
        loadingText={t('propertiesPanel.loading') || '로딩...'}
        errorText={loadError}
        onAdd={() => setShowManager(true)}
        addButtonContent={<PlusIcon />}
      />

      <SoundManagerModal
        isOpen={showManager}
        selectedSound={selectedSound}
        onSelectSound={(path) => {
          onSoundSelect(path);
          void loadSounds();
        }}
        onClose={() => {
          setShowManager(false);
          void loadSounds();
        }}
        previewVolume={previewVolume}
      />
    </>
  );
}
