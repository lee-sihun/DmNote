import { useEffect, useRef, useState } from 'react';
import { keySoundOutputApi } from '@api/modules/resourceApi';
import type {
  KeySoundOutputBackend,
  KeySoundOutputDevices,
  KeySoundOutputState,
} from '@api/modules/resourceApi';

// 설정 패널 재진입 시 장치 선택 드롭다운 깜빡임 방지용 마지막 상태
let cachedKeySoundOutput: KeySoundOutputState | null = null;
let cachedOutputDevices: KeySoundOutputDevices | null = null;

export interface KeySoundOutputController {
  state: KeySoundOutputState | null;
  devices: KeySoundOutputDevices | null;
  enqueue: (backend: KeySoundOutputBackend) => void;
}

interface UseKeySoundOutputOptions {
  // 백엔드 저장 실패 안내 - 권위 상태 재조회와 별개로 사용자에게 알린다
  onSaveFailed?: () => void;
}

export const useKeySoundOutput = ({
  onSaveFailed,
}: UseKeySoundOutputOptions = {}): KeySoundOutputController => {
  const [state, setStateRaw] = useState<KeySoundOutputState | null>(
    cachedKeySoundOutput,
  );
  const [devices, setDevices] = useState<KeySoundOutputDevices | null>(
    cachedOutputDevices,
  );
  const pendingRef = useRef<KeySoundOutputBackend | null>(null);
  const applyingRef = useRef(false);

  const setState = (next: KeySoundOutputState) => {
    cachedKeySoundOutput = next;
    setStateRaw(next);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextDevices, nextState] = await Promise.all([
          keySoundOutputApi.listDevices(),
          keySoundOutputApi.getState(),
        ]);
        if (cancelled) return;
        cachedOutputDevices = nextDevices;
        setDevices(nextDevices);
        if (!applyingRef.current && !pendingRef.current) {
          setState(nextState);
        }
      } catch (error) {
        console.error('Failed to load key sound output state', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enqueue = (backend: KeySoundOutputBackend) => {
    pendingRef.current = backend;
    setStateRaw((current) => {
      if (!current) return current;
      const optimistic = {
        ...current,
        requested: backend,
        error: null,
        errorCode: null,
      };
      cachedKeySoundOutput = optimistic;
      return optimistic;
    });
    if (applyingRef.current) return;

    applyingRef.current = true;
    void (async () => {
      while (pendingRef.current) {
        const requested = pendingRef.current;
        pendingRef.current = null;
        try {
          const result = await keySoundOutputApi.setBackend(requested);
          if (!pendingRef.current) setState(result);
        } catch (error) {
          console.error('Failed to set key sound output backend', error);
          onSaveFailed?.();
          if (!pendingRef.current) {
            try {
              const authoritative = await keySoundOutputApi.getState();
              if (!pendingRef.current) setState(authoritative);
            } catch (syncError) {
              console.error('Failed to resync key sound output', syncError);
            }
          }
        }
      }
      applyingRef.current = false;
    })();
  };

  return { state, devices, enqueue };
};
