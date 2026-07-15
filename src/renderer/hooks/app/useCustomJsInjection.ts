import { useEffect } from 'react';
import { createCustomJsRuntime } from '@src/renderer/plugins/runtime/customJsRuntime';

export function useCustomJsInjection(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const runtime = createCustomJsRuntime();
    runtime.initialize();

    return () => {
      runtime.dispose();
    };
  }, [enabled]);
}
