import type { DMNoteAPI } from '@src/types/api';

declare global {
  interface Window {
    api: DMNoteAPI;
  }

  // dmn 전역 변수 (window. 없이 바로 접근 가능)
  const dmn: DMNoteAPI;
}

export {};
