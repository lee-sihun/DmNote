import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNamespacedStorage } from './storageWrapper';
import type { DMNoteAPI } from '@src/types/plugin/api';

describe('createNamespacedStorage', () => {
  const originalStorage = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn(),
    hasData: vi.fn(),
    clearByPrefix: vi.fn(),
  } as unknown as DMNoteAPI['plugin']['storage'];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(originalStorage.get).mockResolvedValue(null);
    vi.mocked(originalStorage.set).mockResolvedValue();
    vi.mocked(originalStorage.remove).mockResolvedValue();
    vi.mocked(originalStorage.keys).mockResolvedValue([]);
    vi.mocked(originalStorage.hasData).mockResolvedValue(false);
    vi.mocked(originalStorage.clearByPrefix).mockResolvedValue(0);
  });

  it('모든 키 기반 작업을 현재 플러그인 경계 안으로 제한한다', async () => {
    const storage = createNamespacedStorage('alpha', originalStorage);

    await storage.get('settings');
    await storage.set('settings', { enabled: true });
    await storage.remove('settings');
    await storage.hasData('cache/');
    await storage.clearByPrefix('cache/');

    expect(originalStorage.get).toHaveBeenCalledWith('alpha/settings');
    expect(originalStorage.set).toHaveBeenCalledWith('alpha/settings', {
      enabled: true,
    });
    expect(originalStorage.remove).toHaveBeenCalledWith('alpha/settings');
    expect(originalStorage.hasData).toHaveBeenCalledWith('alpha/cache/');
    expect(originalStorage.clearByPrefix).toHaveBeenCalledWith('alpha/cache/');
  });

  it('clear가 접두 ID 플러그인의 데이터를 함께 지우지 않는다', async () => {
    const storage = createNamespacedStorage('alpha', originalStorage);

    await storage.clear();

    expect(originalStorage.clearByPrefix).toHaveBeenCalledWith('alpha/');
    expect(originalStorage.clearByPrefix).not.toHaveBeenCalledWith('alpha');
  });

  it('이전 우회 코드의 자기 네임스페이스 접두사는 중복 적용하지 않는다', async () => {
    const storage = createNamespacedStorage('alpha', originalStorage);

    await storage.hasData('alpha/cache/');
    await storage.clearByPrefix('alpha/cache/');

    expect(originalStorage.hasData).toHaveBeenCalledWith('alpha/cache/');
    expect(originalStorage.clearByPrefix).toHaveBeenCalledWith('alpha/cache/');
  });

  it('다른 플러그인 접두사는 현재 플러그인 안의 일반 접두사로 취급한다', async () => {
    const storage = createNamespacedStorage('alpha', originalStorage);

    await storage.hasData('beta/cache/');
    await storage.clearByPrefix('beta/cache/');

    expect(originalStorage.hasData).toHaveBeenCalledWith('alpha/beta/cache/');
    expect(originalStorage.clearByPrefix).toHaveBeenCalledWith(
      'alpha/beta/cache/',
    );
  });

  it('자기 키만 반환하고 접두 ID가 같은 다른 플러그인은 제외한다', async () => {
    vi.mocked(originalStorage.keys).mockResolvedValue([
      'alpha/settings',
      'alpha/cache/item',
      'alpha2/settings',
      'beta/alpha/settings',
    ]);
    const storage = createNamespacedStorage('alpha', originalStorage);

    await expect(storage.keys()).resolves.toEqual(['settings', 'cache/item']);
  });
});
