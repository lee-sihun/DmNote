import type { BatchElementBinding } from '@hooks/pickers/useBatchElementBinding';
import type { KeyPosition } from '@src/types/key/keys';
import SoundSection from '../../controls/SoundSection';

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
  const soundMixedValue = getKeyOnlyMixedValue ?? getMixedValue;
  const soundEnabled = soundMixedValue((pos) => pos.soundEnabled, false);
  const soundPath = soundMixedValue((pos) => pos.soundPath, '');
  const soundVolume = soundMixedValue((pos) => pos.soundVolume, 100);

  return (
    <SoundSection
      pageKey={BATCH_STYLE_SOUND_PAGE_KEY}
      completionBinding={soundBinding.binding}
      soundEnabled={soundEnabled}
      soundPath={soundPath}
      soundVolume={soundVolume}
      onSoundEnabledCommit={(value) => onSoundEnabledCommit?.(value)}
      onSoundPathCommit={(value) => onSoundPathCommit?.(value)}
      onSoundVolumeCommit={(value) => onSoundVolumeCommit?.(value)}
      t={t}
    />
  );
};

export default BatchSoundSection;
