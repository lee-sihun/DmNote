import { useCallback } from 'react';

export function useDebounce(callback, delay = 200) {
  let timeoutId = null;
  
  return useCallback((...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    
    timeoutId = setTimeout(() => {
      callback(...args);
      timeoutId = null;
    }, delay);
  }, [callback, delay]);
}