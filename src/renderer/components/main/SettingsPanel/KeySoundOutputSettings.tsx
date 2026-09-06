import Dropdown from '@components/main/common/dropdown/Dropdown';
import { SettingCard, SettingRow } from '@components/main/common/SettingRow';
import { useTranslation } from '@contexts/useTranslation';
import { useKeySoundOutput } from '@hooks/audio/useKeySoundOutput';
import {
  createKeySoundOutputViewModel,
  DEFAULT_ASIO_BUFFER,
  KEY_SOUND_ASIO_PREFIX,
  KEY_SOUND_DEVICE_PREFIX,
  truncateKeySoundDeviceName,
} from '@utils/audio/keySoundOutputModel';

interface KeySoundOutputSettingsProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSaveFailed?: () => void;
}

const KeySoundOutputSettings = ({
  onMouseEnter,
  onMouseLeave,
  onSaveFailed,
}: KeySoundOutputSettingsProps) => {
  const { t } = useTranslation();
  const { state, devices, enqueue } = useKeySoundOutput({ onSaveFailed });
  const viewModel = createKeySoundOutputViewModel(state, devices);

  const handleOutputChange = (value: string) => {
    if (value.startsWith(KEY_SOUND_ASIO_PREFIX)) {
      enqueue({
        kind: 'asio',
        driverName: value.slice(KEY_SOUND_ASIO_PREFIX.length),
        bufferSize: DEFAULT_ASIO_BUFFER,
      });
      return;
    }
    if (value.startsWith(KEY_SOUND_DEVICE_PREFIX)) {
      const id = value.slice(KEY_SOUND_DEVICE_PREFIX.length);
      const device = viewModel.visibleSystemDevices.find(
        (candidate) => candidate.id === id,
      );
      if (!device) return;
      enqueue({ kind: 'device', id, name: device.name });
      return;
    }
    enqueue({ kind: 'defaultDevice' });
  };

  const handleBufferChange = (value: string) => {
    const requested = state?.requested;
    if (requested?.kind !== 'asio') return;
    enqueue({
      kind: 'asio',
      driverName: requested.driverName,
      bufferSize: Number(value),
    });
  };

  return (
    <SettingCard>
      <SettingRow
        label={
          <p className="text-label text-fg flex-1 min-w-0 truncate pr-[10px]">
            {t('settings.keySoundOutput') || '키 사운드 출력'}
          </p>
        }
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <Dropdown
          options={[
            {
              value: 'defaultDevice',
              label: t('settings.keySoundOutputDefault') || '기본 재생 장치',
            },
            ...viewModel.visibleSystemDevices.map((device) => ({
              value: `${KEY_SOUND_DEVICE_PREFIX}${device.id}`,
              label:
                viewModel.systemDeviceLabels.get(device.id) ??
                truncateKeySoundDeviceName(device.name),
            })),
            ...viewModel.visibleAsioDrivers.map((name) => ({
              value: `${KEY_SOUND_ASIO_PREFIX}${name}`,
              label: `ASIO: ${truncateKeySoundDeviceName(name)}`,
            })),
          ]}
          value={viewModel.selectedValue}
          onChange={handleOutputChange}
          placeholder={t('settings.keySoundOutputDefault') || '기본 재생 장치'}
          align="right"
          widthClass="max-w-[160px]"
          disabled={viewModel.selectionDisabled}
        />
      </SettingRow>
      <SettingRow
        label={
          <p
            className={`text-label ${
              viewModel.asioSelected ? 'text-fg' : 'text-fg-disabled'
            }`}
          >
            {t('settings.keySoundOutputBuffer') || 'ASIO 버퍼 크기'}
          </p>
        }
      >
        <Dropdown
          options={viewModel.visibleAsioBuffers.map((size) => ({
            value: String(size),
            label: String(size),
          }))}
          value={String(viewModel.requestedAsioBuffer)}
          onChange={handleBufferChange}
          placeholder={String(DEFAULT_ASIO_BUFFER)}
          align="right"
          disabled={!viewModel.asioSelected}
        />
      </SettingRow>
    </SettingCard>
  );
};

export default KeySoundOutputSettings;
