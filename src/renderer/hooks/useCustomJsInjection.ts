import { useEffect } from 'react';
import { createCustomJsRuntime } from '@src/renderer/plugins/runtime/customJsRuntime';

export function useCustomJsInjection() {
  useEffect(() => {
    const runtime = createCustomJsRuntime();
    runtime.initialize();

    return () => {
      runtime.dispose();
    };
  }, []);
}
