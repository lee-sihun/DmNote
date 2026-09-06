import { invokeEditorWrite } from './invokeEditorWrite';

import type { KeysModeResponse } from '@src/types/plugin/api';

export const setKeyMode = (mode: string) =>
  invokeEditorWrite<KeysModeResponse>('keys_set_mode', { mode });
