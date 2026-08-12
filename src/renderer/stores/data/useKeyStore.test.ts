import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ setMode: vi.fn() }));

vi.mock('@api/modules/keyModeApi', () => ({
  setKeyMode: (...args: unknown[]) => apiMocks.setMode(...args),
}));

import { useKeyStore } from './useKeyStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useKeyStore mode synchronization', () => {
  const setMode = apiMocks.setMode;
  const bootstrap = vi.fn();
  const originalApi = window.api;
  const originalRuntime = window.__dmn_runtime;
  const originalWindowType = window.__dmn_window_type;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setMode.mockReset();
    bootstrap.mockReset();
    window.__dmn_runtime = 'tauri';
    window.__dmn_window_type = 'main';
    window.api = {
      keys: { setMode },
      app: { bootstrap },
    } as unknown as Window['api'];
    useKeyStore.setState({
      selectedKeyType: '8key',
      isBootstrapped: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.api = originalApi;
    if (originalRuntime === undefined) delete window.__dmn_runtime;
    else window.__dmn_runtime = originalRuntime;
    if (originalWindowType === undefined) delete window.__dmn_window_type;
    else window.__dmn_window_type = originalWindowType;
  });

  it('rolls back an invalid request to the authoritative response mode', async () => {
    setMode.mockResolvedValue({ success: false, mode: '8key' });

    useKeyStore.getState().setSelectedKeyType('ghost');
    expect(useKeyStore.getState().selectedKeyType).toBe('ghost');
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('8key');
  });

  it('reconciles a rejected native request from bootstrap', async () => {
    setMode.mockRejectedValue(new Error('injected persist failure'));
    bootstrap.mockResolvedValue({ selectedKeyType: '8key' });

    useKeyStore.getState().setSelectedKeyType('4key');
    await flushPromises();
    await flushPromises();

    expect(bootstrap).toHaveBeenCalledOnce();
    expect(useKeyStore.getState().selectedKeyType).toBe('8key');
  });

  it('does not let an older response overwrite a newer request', async () => {
    const first = deferred<{ success: boolean; mode: string }>();
    const second = deferred<{ success: boolean; mode: string }>();
    setMode
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    useKeyStore.getState().setSelectedKeyType('4key');
    useKeyStore.getState().setSelectedKeyType('5key');
    first.resolve({ success: false, mode: '8key' });
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('5key');
    second.resolve({ success: true, mode: '5key' });
    await flushPromises();
    expect(useKeyStore.getState().selectedKeyType).toBe('5key');
  });

  it('does not let an older rejection reconciliation overwrite a newer request', async () => {
    const first = deferred<{ success: boolean; mode: string }>();
    const second = deferred<{ success: boolean; mode: string }>();
    const authoritative = deferred<{ selectedKeyType: string }>();
    setMode
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    bootstrap.mockReturnValue(authoritative.promise);

    useKeyStore.getState().setSelectedKeyType('4key');
    first.reject(new Error('injected persist failure'));
    await flushPromises();
    useKeyStore.getState().setSelectedKeyType('5key');
    authoritative.resolve({ selectedKeyType: '8key' });
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('5key');
    second.resolve({ success: true, mode: '5key' });
    await flushPromises();
  });

  it('guards against an A-B-A response race with a request generation', async () => {
    const firstA = deferred<{ success: boolean; mode: string }>();
    const middleB = deferred<{ success: boolean; mode: string }>();
    const latestA = deferred<{ success: boolean; mode: string }>();
    setMode
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(middleB.promise)
      .mockReturnValueOnce(latestA.promise);

    useKeyStore.getState().setSelectedKeyType('4key');
    useKeyStore.getState().setSelectedKeyType('5key');
    useKeyStore.getState().setSelectedKeyType('4key');
    firstA.resolve({ success: false, mode: '8key' });
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('4key');
    middleB.resolve({ success: true, mode: '5key' });
    latestA.resolve({ success: true, mode: '4key' });
    await flushPromises();
  });

  it('keeps OBS mode changes local without invoking the blocked command', async () => {
    window.__dmn_runtime = 'obs';
    window.__dmn_window_type = 'overlay';

    useKeyStore.getState().setSelectedKeyType('4key');
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('4key');
    expect(setMode).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('reconciles failures in the native overlay as well as the main window', async () => {
    window.__dmn_window_type = 'overlay';
    setMode.mockRejectedValue(new Error('injected persist failure'));
    bootstrap.mockResolvedValue({ selectedKeyType: '8key' });

    useKeyStore.getState().setSelectedKeyType('4key');
    await flushPromises();
    await flushPromises();

    expect(useKeyStore.getState().selectedKeyType).toBe('8key');
  });
});
