/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import NoteSetting from '../settings/NoteSetting';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';
import type {
  NoteSettings,
  TabNoteSettings,
} from '@src/types/settings/noteSettings';
import { useTranslation } from '@contexts/useTranslation';

interface TabNoteSettingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TabNoteSettingModal = ({ isOpen, onClose }: TabNoteSettingModalProps) => {
  const { t: _t } = useTranslation();
  const globalSettings = useSettingsStore((s) => s.noteSettings);
  const noteEffect = useSettingsStore((s) => s.noteEffect);
  const selectedKeyType = useKeyStore((s) => s.selectedKeyType);
  const [tabOverride, setTabOverride] = useState<TabNoteSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // 모달 열릴 때 현재 탭의 오버라이드 로드
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    window.api.noteTab
      .get(selectedKeyType)
      .then((res) => {
        setTabOverride(res.settings ?? null);
      })
      .catch((err) => {
        console.error('Failed to load tab note settings', err);
        setTabOverride(null);
      })
      .finally(() => setLoading(false));
  }, [isOpen, selectedKeyType]);

  const handleSave = async (normalized: NoteSettings) => {
    try {
      // 전역 설정과 비교하여 다른 값만 오버라이드로 저장
      const override: TabNoteSettings = {};
      const keys = Object.keys(normalized) as (keyof NoteSettings)[];
      for (const key of keys) {
        if (normalized[key] !== globalSettings[key]) {
          (override as Record<string, NoteSettings[keyof NoteSettings]>)[key] =
            normalized[key];
        }
      }
      // 모든 값이 전역과 동일하면 오버라이드 제거
      const hasOverride = Object.keys(override).length > 0;
      await window.api.noteTab.set(
        selectedKeyType,
        hasOverride ? override : null,
      );
    } catch (error) {
      console.error('Failed to save tab note settings', error);
    }
  };

  if (!isOpen || !noteEffect || loading) return null;

  // 전역 + 오버라이드 병합하여 모달에 전달
  const mergedSettings = mergeNoteSettings(globalSettings, tabOverride);

  return (
    <NoteSetting
      settings={mergedSettings}
      onClose={onClose}
      onSave={handleSave}
    />
  );
};

export default TabNoteSettingModal;
