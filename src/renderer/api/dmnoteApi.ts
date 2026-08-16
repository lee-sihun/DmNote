import { createHostGlobalApi } from './hostGlobalApi';
import { internalApi } from './internalApi';
// 런타임 레지스트리 모듈 로드 (부수효과 유지)
import './pluginDisplayElements';

if (typeof window !== 'undefined') {
  window.api = createHostGlobalApi(internalApi);
}

export default internalApi;
