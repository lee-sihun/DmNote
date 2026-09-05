import { createPortal } from 'react-dom';
import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';
import Checkbox from '@components/main/common/Checkbox';
import SoundPicker from '@components/main/Modal/content/pickers/SoundPicker';
import { NumberInput, PropertyRow, PropertySection } from './PropertyInputs';
import { usePanelNav } from '../navigation/PanelNavContext';

interface SoundValue<T> {
  value: T;
  isMixed: boolean;
}

interface SoundSectionProps {
  pageKey: string;
  completionBinding: CompletionBinding;
  soundEnabled: SoundValue<boolean>;
  soundPath: SoundValue<string>;
  soundVolume: SoundValue<number>;
  onSoundPathCommit: (soundPath: string) => void;
  onSoundEnabledCommit: (soundEnabled: boolean) => void;
  onSoundVolumeCommit: (soundVolume: number) => void;
  onSoundVolumePreview?: (soundVolume: number) => void;
  onSoundVolumeCancel?: () => void;
  onBeforeToggle?: () => void;
  t: (key: string) => string;
}

const SoundSection = ({
  pageKey,
  completionBinding,
  soundEnabled,
  soundPath,
  soundVolume,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  onSoundVolumePreview,
  onSoundVolumeCancel,
  onBeforeToggle,
  t,
}: SoundSectionProps) => {
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();
  const clampVolume = (value: number) => Math.max(0, Math.min(200, value));

  return (
    <>
      <PropertySection>
        <PropertyRow
          label={t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'}
        >
          {soundEnabled.isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <Checkbox
            commitStrategy="after-paint"
            checked={soundEnabled.value}
            onChange={() => onSoundEnabledCommit(!soundEnabled.value)}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
          {soundPath.isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === pageKey ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              onBeforeToggle?.();
              if (activePageKey === pageKey) closePage();
              else openPage(pageKey);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.soundVolume') || '사운드 볼륨'}>
          {soundVolume.isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={soundVolume.value}
            onChange={(value) => onSoundVolumeCommit(clampVolume(value))}
            onPreview={
              onSoundVolumePreview
                ? (value) => onSoundVolumePreview(clampVolume(value))
                : undefined
            }
            onCancel={onSoundVolumeCancel}
            suffix="%"
            min={0}
            max={200}
            isMixed={soundVolume.isMixed}
          />
        </PropertyRow>
      </PropertySection>

      {renderPageKey === pageKey &&
        pageHost &&
        createPortal(
          <SoundPicker
            open
            completionBinding={completionBinding}
            selectedSound={soundPath.value || null}
            onSoundSelect={(nextPath) => onSoundPathCommit(nextPath || '')}
            previewVolume={soundVolume.value}
            pageTitle={t('propertiesPanel.keySound') || '키 사운드'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default SoundSection;
