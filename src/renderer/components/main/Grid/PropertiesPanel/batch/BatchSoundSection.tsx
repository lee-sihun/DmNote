import { createPortal } from 'react-dom';
import Checkbox from '@components/main/common/Checkbox';
import SoundPicker from '@components/main/Modal/content/pickers/SoundPicker';
import type { BatchElementBinding } from '@hooks/pickers/useBatchElementBinding';
import type { KeyPosition } from '@src/types/key/keys';
import { NumberInput, PropertyRow, PropertySection } from '../index';
import { usePanelNav } from '../PanelNavContext';

export const BATCH_STYLE_SOUND_PAGE_KEY = 'batch-style:sound';

type MixedValueGetter = <T>(
  getter: (position: KeyPosition) => T | undefined,
  defaultValue: T,
) => { isMixed: boolean; value: T };

interface BatchSoundSectionProps {
  soundBinding: BatchElementBinding;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  getMixedValue: MixedValueGetter;
  getKeyOnlyMixedValue?: MixedValueGetter;
  t: (key: string) => string;
}

const BatchSoundSection = ({
  soundBinding,
  onSoundPathCommit,
  onSoundEnabledCommit,
  onSoundVolumeCommit,
  getMixedValue,
  getKeyOnlyMixedValue,
  t,
}: BatchSoundSectionProps) => {
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();
  const soundMixedValue = getKeyOnlyMixedValue ?? getMixedValue;

  return (
    <>
      <PropertySection>
        <PropertyRow
          label={t('propertiesPanel.keySoundEnabled') || '키 사운드 활성화'}
        >
          {soundMixedValue((pos) => pos.soundEnabled, false).isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <Checkbox
            commitStrategy="after-paint"
            checked={soundMixedValue((pos) => pos.soundEnabled, false).value}
            onChange={() => {
              const current = soundMixedValue(
                (pos) => pos.soundEnabled,
                false,
              ).value;
              onSoundEnabledCommit?.(!current);
            }}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.keySound') || '키 사운드'}>
          {soundMixedValue((pos) => pos.soundPath, '').isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === BATCH_STYLE_SOUND_PAGE_KEY
                ? 'shadow-focus-ring'
                : ''
            } text-fg text-body`}
            onClick={() => {
              if (activePageKey === BATCH_STYLE_SOUND_PAGE_KEY) closePage();
              else openPage(BATCH_STYLE_SOUND_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.soundVolume') || '사운드 볼륨'}>
          {soundMixedValue((pos) => pos.soundVolume, 100).isMixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <NumberInput
            value={soundMixedValue((pos) => pos.soundVolume, 100).value}
            onChange={(value) => {
              const soundVolume = Math.max(0, Math.min(200, value));
              onSoundVolumeCommit?.(soundVolume);
            }}
            suffix="%"
            min={0}
            max={200}
            isMixed={soundMixedValue((pos) => pos.soundVolume, 100).isMixed}
          />
        </PropertyRow>
      </PropertySection>

      {renderPageKey === BATCH_STYLE_SOUND_PAGE_KEY &&
        pageHost &&
        createPortal(
          <SoundPicker
            open={true}
            completionBinding={soundBinding.binding}
            selectedSound={
              soundMixedValue((pos) => pos.soundPath, '').value || null
            }
            onSoundSelect={(soundPath) => {
              const nextPath = soundPath || '';
              onSoundPathCommit?.(nextPath);
            }}
            previewVolume={soundMixedValue((pos) => pos.soundVolume, 100).value}
            pageTitle={t('propertiesPanel.keySound') || '키 사운드'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default BatchSoundSection;
