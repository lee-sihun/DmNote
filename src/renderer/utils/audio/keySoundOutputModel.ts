import type {
  KeySoundOutputDevices,
  KeySoundOutputState,
} from '@api/modules/resourceApi';

export const ASIO_BUFFER_SIZES = [64, 128, 256, 512, 1024] as const;
export const DEFAULT_ASIO_BUFFER = 64;
export const KEY_SOUND_DEVICE_PREFIX = 'device:';
export const KEY_SOUND_ASIO_PREFIX = 'asio:';

export const truncateKeySoundDeviceName = (name: string): string =>
  name.length > 16 ? `${name.slice(0, 16)}…` : name;

export interface KeySoundOutputViewModel {
  visibleSystemDevices: KeySoundOutputDevices['system'];
  visibleAsioDrivers: string[];
  systemDeviceLabels: Map<string, string>;
  selectedValue: string;
  requestedAsioBuffer: number;
  visibleAsioBuffers: readonly number[];
  asioSelected: boolean;
  selectionDisabled: boolean;
}

export const createKeySoundOutputViewModel = (
  state: KeySoundOutputState | null,
  devices: KeySoundOutputDevices | null,
): KeySoundOutputViewModel => {
  const requestedBackend = state?.requested;
  const requestedAsioDriver =
    requestedBackend?.kind === 'asio' ? requestedBackend.driverName : null;
  const asioDrivers = devices?.asio ?? [];
  const visibleAsioDrivers =
    requestedAsioDriver && !asioDrivers.includes(requestedAsioDriver)
      ? [...asioDrivers, requestedAsioDriver]
      : asioDrivers;

  const requestedDevice =
    requestedBackend?.kind === 'device' ? requestedBackend : null;
  const systemDevices = devices?.system ?? [];
  const visibleSystemDevices =
    requestedDevice &&
    !systemDevices.some((device) => device.id === requestedDevice.id)
      ? [
          ...systemDevices,
          { id: requestedDevice.id, name: requestedDevice.name },
        ]
      : systemDevices;

  const systemDeviceLabels = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  for (const device of visibleSystemDevices) {
    const seen = (nameCounts.get(device.name) ?? 0) + 1;
    nameCounts.set(device.name, seen);
    const base = truncateKeySoundDeviceName(device.name);
    systemDeviceLabels.set(device.id, seen > 1 ? `${base} (${seen})` : base);
  }

  const selectedValue =
    requestedBackend?.kind === 'asio'
      ? `${KEY_SOUND_ASIO_PREFIX}${requestedBackend.driverName}`
      : requestedBackend?.kind === 'device'
      ? `${KEY_SOUND_DEVICE_PREFIX}${requestedBackend.id}`
      : 'defaultDevice';
  const asioSelected = requestedBackend?.kind === 'asio';
  const requestedAsioBuffer = asioSelected
    ? requestedBackend.bufferSize || DEFAULT_ASIO_BUFFER
    : DEFAULT_ASIO_BUFFER;
  const visibleAsioBuffers = ASIO_BUFFER_SIZES.some(
    (size) => size === requestedAsioBuffer,
  )
    ? ASIO_BUFFER_SIZES
    : [...ASIO_BUFFER_SIZES, requestedAsioBuffer].sort((a, b) => a - b);

  return {
    visibleSystemDevices,
    visibleAsioDrivers,
    systemDeviceLabels,
    selectedValue,
    requestedAsioBuffer,
    visibleAsioBuffers,
    asioSelected,
    selectionDisabled:
      devices !== null &&
      visibleSystemDevices.length + visibleAsioDrivers.length === 0,
  };
};
