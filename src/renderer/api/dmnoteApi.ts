import { createHostGlobalApi } from './hostGlobalApi';
import { internalApi } from './internalApi';

if (typeof window !== 'undefined') {
  window.api = createHostGlobalApi(internalApi);
}

export {
  handlerRegistry,
  displayElementInstanceRegistry,
} from './pluginDisplayElements';

export default internalApi;
