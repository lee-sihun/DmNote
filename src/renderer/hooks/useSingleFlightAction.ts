import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export const useSingleFlightAction = <Args extends unknown[], Result>(
  action: (...args: Args) => PromiseLike<Result> | Result,
) => {
  const actionRef = useRef(action);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const [pending, setPending] = useState(false);

  useLayoutEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      if (runningRef.current) return undefined;
      runningRef.current = true;
      if (mountedRef.current) setPending(true);
      try {
        return await actionRef.current(...args);
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    },
    [],
  );

  return { run, pending };
};
