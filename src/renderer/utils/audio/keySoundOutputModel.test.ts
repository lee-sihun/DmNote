import { describe, expect, it } from 'vitest';
import type {
  KeySoundOutputDevices,
  KeySoundOutputState,
} from '@api/modules/resourceApi';
import {
  createKeySoundOutputViewModel,
  DEFAULT_ASIO_BUFFER,
  truncateKeySoundDeviceName,
} from './keySoundOutputModel';

const devices: KeySoundOutputDevices = {
  defaultDevice: true,
  system: [
    { id: 'first', name: 'Repeated output device' },
    { id: 'second', name: 'Repeated output device' },
  ],
  asio: ['Focusrite USB ASIO'],
};

const state = (
  requested: KeySoundOutputState['requested'],
): KeySoundOutputState => ({
  requested,
  effective: requested,
  error: null,
  errorCode: null,
  asioAvailable: true,
});

describe('createKeySoundOutputViewModel', () => {
  it('현재 목록에서 사라진 시스템 장치를 선택 항목으로 유지한다', () => {
    const model = createKeySoundOutputViewModel(
      state({ kind: 'device', id: 'missing', name: 'Detached DAC' }),
      devices,
    );

    expect(model.visibleSystemDevices.at(-1)).toEqual({
      id: 'missing',
      name: 'Detached DAC',
    });
    expect(model.selectedValue).toBe('device:missing');
  });

  it('현재 목록에서 사라진 ASIO 드라이버와 비표준 버퍼를 유지한다', () => {
    const model = createKeySoundOutputViewModel(
      state({ kind: 'asio', driverName: 'Legacy ASIO', bufferSize: 96 }),
      devices,
    );

    expect(model.visibleAsioDrivers).toEqual([
      'Focusrite USB ASIO',
      'Legacy ASIO',
    ]);
    expect(model.visibleAsioBuffers).toContain(96);
    expect(model.requestedAsioBuffer).toBe(96);
    expect(model.asioSelected).toBe(true);
  });

  it('동일 이름 장치를 순번으로 구분하고 긴 이름을 축약한다', () => {
    const model = createKeySoundOutputViewModel(
      state({ kind: 'defaultDevice' }),
      devices,
    );

    expect(model.systemDeviceLabels.get('first')).toBe(
      truncateKeySoundDeviceName('Repeated output device'),
    );
    expect(model.systemDeviceLabels.get('second')).toBe(
      `${truncateKeySoundDeviceName('Repeated output device')} (2)`,
    );
  });

  it('장치 로딩 완료 후 선택지가 없을 때만 선택을 잠근다', () => {
    const requested = state({ kind: 'defaultDevice' });
    expect(
      createKeySoundOutputViewModel(requested, null).selectionDisabled,
    ).toBe(false);
    expect(
      createKeySoundOutputViewModel(requested, {
        defaultDevice: true,
        system: [],
        asio: [],
      }).selectionDisabled,
    ).toBe(true);
  });

  it('ASIO 버퍼 미지정과 0을 기본 버퍼로 표시한다', () => {
    for (const bufferSize of [undefined, null, 0]) {
      const model = createKeySoundOutputViewModel(
        state({ kind: 'asio', driverName: 'ASIO', bufferSize }),
        devices,
      );
      expect(model.requestedAsioBuffer).toBe(DEFAULT_ASIO_BUFFER);
    }
  });
});
