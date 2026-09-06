// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KeySoundOutputBackend,
  KeySoundOutputState,
} from '@api/modules/resources/resourceApi';
import {
  useKeySoundOutput,
  type KeySoundOutputController,
} from './useKeySoundOutput';

const apiMocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  getState: vi.fn(),
  setBackend: vi.fn(),
}));

vi.mock('@api/modules/resources/resourceApi', () => ({
  keySoundOutputApi: apiMocks,
}));

const defaultBackend: KeySoundOutputBackend = { kind: 'defaultDevice' };
const outputState = (
  requested: KeySoundOutputBackend,
): KeySoundOutputState => ({
  requested,
  effective: requested,
  error: null,
  errorCode: null,
  asioAvailable: true,
});

let latestController: KeySoundOutputController;

const Harness = () => {
  const controller = useKeySoundOutput();
  useEffect(() => {
    latestController = controller;
  }, [controller]);
  return null;
};

describe('useKeySoundOutput', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    apiMocks.listDevices.mockReset().mockResolvedValue({
      defaultDevice: true,
      system: [],
      asio: [],
    });
    apiMocks.getState
      .mockReset()
      .mockResolvedValue(outputState(defaultBackend));
    apiMocks.setBackend.mockReset();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('적용 중 들어온 선택을 마지막 요청까지 순서대로 반영한다', async () => {
    const firstBackend: KeySoundOutputBackend = {
      kind: 'asio',
      driverName: 'First ASIO',
      bufferSize: 64,
    };
    const latestBackend: KeySoundOutputBackend = {
      kind: 'asio',
      driverName: 'Latest ASIO',
      bufferSize: 128,
    };
    let resolveFirst!: (state: KeySoundOutputState) => void;
    apiMocks.setBackend
      .mockImplementationOnce(
        () =>
          new Promise<KeySoundOutputState>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(outputState(latestBackend));

    act(() => latestController.enqueue(firstBackend));
    act(() => latestController.enqueue(latestBackend));
    expect(latestController.state?.requested).toEqual(latestBackend);

    await act(async () => resolveFirst(outputState(firstBackend)));

    expect(apiMocks.setBackend).toHaveBeenNthCalledWith(1, firstBackend);
    expect(apiMocks.setBackend).toHaveBeenNthCalledWith(2, latestBackend);
    expect(latestController.state).toEqual(outputState(latestBackend));
  });

  it('적용 실패 시 백엔드 권위 상태를 다시 읽는다', async () => {
    const failedBackend: KeySoundOutputBackend = {
      kind: 'device',
      id: 'missing',
      name: 'Missing DAC',
    };
    const authoritative = outputState(defaultBackend);
    apiMocks.setBackend.mockRejectedValueOnce(new Error('open failed'));
    apiMocks.getState.mockResolvedValueOnce(authoritative);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await act(async () => latestController.enqueue(failedBackend));

    expect(apiMocks.getState).toHaveBeenCalledTimes(2);
    expect(latestController.state).toEqual(authoritative);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to set key sound output backend',
      expect.any(Error),
    );
  });
});
