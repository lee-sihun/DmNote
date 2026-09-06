import { invoke } from '@tauri-apps/api/core';
import type { CssImportFetchResult } from '@utils/css/resolveUserCssImports';

// 메인창 @import 인라인용 - 브라우저 fetch는 CORS에 걸려 백엔드가 받는다.
// internalApi(플러그인 런타임에 복사됨)에 올리지 않고 주입 훅만 직접 쓴다
export const fetchCustomCssImport = (url: string) =>
  invoke<CssImportFetchResult>('css_fetch_import', { url });
