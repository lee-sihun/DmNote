import React, { useEffect, useState, useCallback } from 'react';
import NoteSetting from './NoteSetting';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useKeyStore } from '@stores/useKeyStore';
import { mergeNoteSettings } from '@src/types/noteSettings';
import type { NoteSettings, TabNoteSettings } from '@src/types/noteSettings';
import { useTranslation } from '@contexts/I18nContext';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function TabNoteSettingModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
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

  const handleSave = useCallback(
    async (normalized: NoteSettings) => {
      try {
        // 전역 설정과 비교하여 다른 값만 오버라이드로 저장
        const override: TabNoteSettings = {};
        const keys = Object.keys(normalized) as (keyof NoteSettings)[];
        for (const key of keys) {
          if (normalized[key] !== globalSettings[key]) {
            (override as any)[key] = normalized[key];
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
    },
    [globalSettings, selectedKeyType],
  );

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
}
