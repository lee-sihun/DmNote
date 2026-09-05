import { keyStatsService } from '@utils/keyStatsService';

import type { KeyStatsPayload, Unsubscribe } from '@src/types/plugin/api';

export const statsApi = {
  subscribe: (listener: (stats: KeyStatsPayload) => void): Unsubscribe => {
    return keyStatsService.subscribe(listener);
  },
  get: (): KeyStatsPayload => {
    return keyStatsService.getStats();
  },
  reset: (): void => {
    keyStatsService.reset();
  },
};
