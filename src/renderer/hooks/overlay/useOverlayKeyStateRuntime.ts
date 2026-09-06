import { useEffect, useMemo, useRef } from 'react';
import { obsApi } from '@api/modules/window/obsApi';
import { MAX_EVENT_AGE_MS } from '@constants/inputTiming';
import type { NoteKeyTiming } from '@hooks/overlay/useNoteSystem';
import {
  applyEventKeyState,
  resetAllKeySignals,
  setKeyActive as setKeyActiveSignal,
} from '@stores/signals/keySignals';
import type { KeyMappings, KeyPosition, KeySlot } from '@src/types/key/keys';
import {
  buildCanonicalIndexMap,
  isSlotAssigned,
  slotCanonical,
  slotDisplayName,
} from '@utils/keySlot';

type KeyDelayTimerHandle = ReturnType<typeof setTimeout>;

type KeyDelayTimerEntry = {
  timers: Map<KeyDelayTimerHandle, () => void>;
};

interface UseOverlayKeyStateRuntimeOptions {
  noteEffect: boolean;
  keyDisplayDelayMs: number;
  keyMappings: KeyMappings;
  currentSlots: readonly KeySlot[];
  positions: Record<string, KeyPosition[]>;
  selectedKeyType: string;
  handleKeyDown: (keyName: string, timing?: NoteKeyTiming) => void;
  handleKeyUp: (keyName: string, timing?: NoteKeyTiming) => void;
  finalizeAllActive: () => void;
  reconcileActiveNotes: (activeKeys: ReadonlySet<string>) => void;
}

interface OverlayKeyStateRuntime {
  currentKeys: string[];
  currentKeyLabels: string[];
}

const cancelKeyDelayTimers = (
  entries: Map<string, KeyDelayTimerEntry>,
  pendingTimers: Map<KeyDelayTimerHandle, () => void>,
) => {
  pendingTimers.forEach((_apply, timer) => clearTimeout(timer));
  pendingTimers.clear();
  entries.forEach((entry) => entry.timers.clear());
  entries.clear();
};

const flushKeyDelayTimers = (
  entries: Map<string, KeyDelayTimerEntry>,
  pendingTimers: Map<KeyDelayTimerHandle, () => void>,
) => {
  const pending = [...pendingTimers.entries()];
  pendingTimers.clear();
  entries.forEach((entry) => entry.timers.clear());
  entries.clear();

  pending.forEach(([timer, apply]) => {
    clearTimeout(timer);
    apply();
  });
};

const validKeySet = (slots: readonly KeySlot[]) =>
  new Set(slots.filter(isSlotAssigned).map((slot) => slotCanonical(slot)));

const validKeySignature = (slots: readonly KeySlot[]) =>
  JSON.stringify([...validKeySet(slots)].sort());

export const useOverlayKeyStateRuntime = ({
  noteEffect,
  keyDisplayDelayMs,
  keyMappings,
  currentSlots,
  positions,
  selectedKeyType,
  handleKeyDown,
  handleKeyUp,
  finalizeAllActive,
  reconcileActiveNotes,
}: UseOverlayKeyStateRuntimeOptions): OverlayKeyStateRuntime => {
  // 키 딜레이 타이머 관리 (down/up 별도 관리)
  const keyDelayTimersRef = useRef<Map<string, KeyDelayTimerEntry>>(new Map());
  const pendingKeyDelayTimersRef = useRef<Map<KeyDelayTimerHandle, () => void>>(
    new Map(),
  );

  // 키 딜레이 값을 ref로 관리하여 클로저 문제 방지
  const keyDisplayDelayMsRef = useRef(keyDisplayDelayMs);
  useEffect(() => {
    if (keyDisplayDelayMsRef.current !== keyDisplayDelayMs) {
      flushKeyDelayTimers(
        keyDelayTimersRef.current,
        pendingKeyDelayTimersRef.current,
      );
    }
    keyDisplayDelayMsRef.current = keyDisplayDelayMs;
  }, [keyDisplayDelayMs]);

  // 탭 전환 시 진행 중인 모든 노트 강제 완료
  useEffect(() => {
    finalizeAllActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyType]);

  // 구독 콜백이 읽는 최신 컨텍스트 - 구독 자체는 마운트 1회로 고정
  // positions·keyMappings가 deps에 있으면 undo의 canonical 복원마다 재구독되고,
  // cleanup의 resetAllKeySignals가 눌림 표시 중간에 끼어들어 이중 깜빡임 발생
  const keyEventContextRef = useRef({
    noteEffect,
    keyMappings,
    positions,
    selectedKeyType,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
  });
  useEffect(() => {
    keyEventContextRef.current = {
      noteEffect,
      keyMappings,
      positions,
      selectedKeyType,
      handleKeyDown,
      handleKeyUp,
      finalizeAllActive,
      reconcileActiveNotes,
    };
  });

  // 리셋 이후 이벤트가 도착한 키 추적 - 스냅샷 재수화보다 최신 이벤트가 우선
  const seenSinceResetRef = useRef<Set<string>>(new Set());
  // 대조(reconcile) fetch 이후 도착한 실이벤트 추적 - null이면 수집 안 함
  const reconcileSeenRef = useRef<Set<string> | null>(null);
  // 중첩 대조의 낡은 응답 차단 - keys:reset·탭 전환·새 대조가 세대를 올림
  const reconcileGenerationRef = useRef(0);
  // 탭 전환 재수화가 구독 확립을 기다릴 수 있게 구독 준비 promise 보관
  const keyEventsReadyRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    // 키 딜레이 적용된 신호 업데이트
    const updateKeySignalWithDelay = (key: string, isDown: boolean) => {
      const delayMs = keyDisplayDelayMsRef.current;

      let timerEntry = keyDelayTimersRef.current.get(key);
      if (!timerEntry) {
        timerEntry = { timers: new Map() };
        keyDelayTimersRef.current.set(key, timerEntry);
      }

      if (delayMs <= 0) {
        timerEntry.timers.forEach((_apply, timer) => {
          clearTimeout(timer);
          pendingKeyDelayTimersRef.current.delete(timer);
        });
        timerEntry.timers.clear();
        keyDelayTimersRef.current.delete(key);
        // 이벤트 경로만 press edge를 발화한다 - 하이드레이션·리싱크는 유령 edge 방지
        applyEventKeyState(key, isDown);
        return;
      }

      const apply = () => applyEventKeyState(key, isDown);
      const timer = setTimeout(() => {
        const pendingApply = pendingKeyDelayTimersRef.current.get(timer);
        if (!pendingApply) return;

        pendingKeyDelayTimersRef.current.delete(timer);
        const currentEntry = keyDelayTimersRef.current.get(key);
        currentEntry?.timers.delete(timer);
        if (currentEntry?.timers.size === 0) {
          keyDelayTimersRef.current.delete(key);
        }
        pendingApply();
      }, delayMs);
      timerEntry.timers.set(timer, apply);
      pendingKeyDelayTimersRef.current.set(timer, apply);
    };

    // HID 축 이벤트 버스 초기화 (input:axis 구독 → axisSignals 누적)
    import('@utils/input/axisEventBus').then(({ axisEventBus }) => {
      axisEventBus.initialize();
    });

    let hydrationCancelled = false;

    // 키 이벤트 구독을 먼저 확립한 뒤 눌림 스냅샷 요청
    const unsubscribe = import('@utils/input/keyEventBus').then(
      async ({ keyEventBus }) => {
        if (hydrationCancelled) return undefined;
        const unsubscribeKeyEvents = keyEventBus.subscribe(
          ({ key, state, mode, eventAgeMs, holdDurationMs }) => {
            // 대조 원장은 모드로 네임스페이스돼 있어 낡은 모드도 그대로 기록한다
            reconcileSeenRef.current?.add(`${mode}::${key}`);
            // 탭 전환은 백엔드 확인 전에 화면 모드를 먼저 바꾸므로, 그 사이 도착한
            // 이전 모드 이벤트가 새 탭 신호를 켜면 onPress 스프라이트까지 발동한다.
            // 대조 경로(reconcileWithBootstrap)가 쓰는 기준과 같게 건다
            if (mode !== keyEventContextRef.current.selectedKeyType) return;
            seenSinceResetRef.current.add(key);
            const isDown = state === 'DOWN';
            // 키 UI 업데이트 (딜레이 적용)
            updateKeySignalWithDelay(key, isDown);
            const {
              noteEffect,
              keyMappings,
              positions,
              selectedKeyType,
              handleKeyDown,
              handleKeyUp,
            } = keyEventContextRef.current;
            // 노트 이펙트는 즉시 처리 (딜레이 없음)
            if (noteEffect) {
              // 실제 입력 시각을 복원해 노트 시작 위치를 보정 (프레임 양자화 방지).
              // displayTime은 0~MAX_EVENT_AGE_MS 클램프 - 백엔드 stall/클럭 이상 시
              // 노트가 화면 위로 튀는 것을 방지. physTime은 비클램프 - 단/롱 판정의
              // hold 폴백 계산 전용이라 클램프 절단 왜곡을 받지 않음
              const rawAge = Math.max(eventAgeMs ?? 0, 0);
              const displayAge = Math.min(rawAge, MAX_EVENT_AGE_MS);
              const now = performance.now();
              const timing = {
                displayTime: now - displayAge,
                physTime: now - rawAge,
                holdDurationMs,
              };

              if (isDown) {
                // 개별 키의 noteEffectEnabled는 DOWN에만 적용
                // canonical → 대표 슬롯 인덱스 (Multi 우선, 계약 §11)
                const currentSlots = keyMappings[selectedKeyType] ?? [];
                const currentPositions = positions[selectedKeyType] ?? [];
                const keyIndex =
                  buildCanonicalIndexMap(currentSlots).get(key) ?? -1;
                const keyPosition = currentPositions[keyIndex];
                if (keyPosition?.noteEffectEnabled !== false) {
                  handleKeyDown(key, timing);
                }
              } else {
                // UP은 항상 전달 - DOWN 이후 설정이 꺼진 키의 활성 노트 고착 방지
                handleKeyUp(key, timing);
              }
            }
          },
        );

        try {
          await keyEventBus.initialize();
        } catch (error) {
          unsubscribeKeyEvents();
          throw error;
        }

        if (hydrationCancelled) return unsubscribeKeyEvents;

        // 지연 생성된 오버레이 hydration — 구독 이후 이벤트가 온 키는
        // 최신 이벤트가 스냅샷보다 우선하며 KPS·노트 통계에는 반영하지 않음
        const hydrationSeen = seenSinceResetRef.current;
        void window.api.app
          .bootstrap()
          .then(({ activeKeys }) => {
            if (hydrationCancelled || !activeKeys?.length) return;
            // 탭 전환 리셋이 끼었으면 이 스냅샷은 낡음 - 전환 effect의 재수화가 담당
            if (seenSinceResetRef.current !== hydrationSeen) return;
            const { keyMappings, selectedKeyType } = keyEventContextRef.current;
            const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
            for (const key of activeKeys) {
              if (validKeys.has(key) && !hydrationSeen.has(key)) {
                setKeyActiveSignal(key, true);
              }
            }
          })
          .catch((error) => {
            if (!hydrationCancelled) {
              console.error('Failed to hydrate active key state', error);
            }
          });

        return unsubscribeKeyEvents;
      },
    );
    keyEventsReadyRef.current = unsubscribe;
    void unsubscribe.catch((error) => {
      console.error('Failed to initialize key state listener', error);
    });

    // UP 유실 복구 - fresh 스냅샷과 활성 노트·눌림 신호를 대조 (실패 복구 경로)
    const reconcileWithBootstrap = async (): Promise<void> => {
      const generation = reconcileGenerationRef.current + 1;
      reconcileGenerationRef.current = generation;
      const sinceFetch = new Set<string>();
      reconcileSeenRef.current = sinceFetch;
      try {
        const payload = await window.api.app.bootstrap();
        if (hydrationCancelled) return;
        // 더 새로운 대조나 keys:reset·탭 전환이 끼었으면 이 응답은 낡음
        if (generation !== reconcileGenerationRef.current) return;
        const { selectedKeyType, keyMappings, reconcileActiveNotes } =
          keyEventContextRef.current;
        // 모드 삼중 일치에서만 대조 - 비원자 스냅샷·낙관적 모드 전환 방어
        if (
          !payload.currentMode ||
          payload.currentMode !== payload.selectedKeyType ||
          payload.currentMode !== selectedKeyType
        ) {
          return;
        }
        const held = new Set(payload.activeKeys ?? []);
        // fetch 이후 실이벤트가 도착한 키는 그 이벤트가 최신 - 대조에서 제외
        for (const entry of sinceFetch) {
          const sep = entry.indexOf('::');
          if (sep < 0) continue;
          if (entry.slice(0, sep) === payload.currentMode) {
            held.add(entry.slice(sep + 2));
          }
        }
        reconcileActiveNotes(held);
        // 고착된 눌림 하이라이트도 같은 기준으로 정정
        const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
        for (const key of validKeys) {
          if (!sinceFetch.has(`${payload.currentMode}::${key}`)) {
            setKeyActiveSignal(key, held.has(key));
          }
        }
      } catch (error) {
        if (!hydrationCancelled) {
          console.error('Failed to reconcile active notes', error);
        }
      } finally {
        if (reconcileSeenRef.current === sinceFetch) {
          reconcileSeenRef.current = null;
        }
      }
    };

    // OBS Lagged/재연결 스냅샷은 유실된 keys:state를 개별 복구하지 못하므로 대조로 정리
    const unsubscribeResync = obsApi.onResync(() => {
      void reconcileWithBootstrap();
    });

    // 키보드 훅 (재)시작 - 이전 눌림 상태가 통째로 무효화되므로 전체 리셋 후 재수화
    const unsubscribeKeysReset = window.api.keys.onKeysReset(() => {
      // 진행 중인 대조의 낡은 스냅샷이 리셋 이후 상태를 덮지 못하게 무효화
      reconcileGenerationRef.current += 1;
      const { finalizeAllActive } = keyEventContextRef.current;
      finalizeAllActive();
      cancelKeyDelayTimers(
        keyDelayTimersRef.current,
        pendingKeyDelayTimersRef.current,
      );
      const seen = new Set<string>();
      seenSinceResetRef.current = seen;
      resetAllKeySignals();
      void window.api.app
        .bootstrap()
        .then(({ activeKeys }) => {
          if (hydrationCancelled || !activeKeys?.length) return;
          if (seenSinceResetRef.current !== seen) return;
          const { keyMappings, selectedKeyType } = keyEventContextRef.current;
          const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
          for (const key of activeKeys) {
            if (validKeys.has(key) && !seen.has(key)) {
              setKeyActiveSignal(key, true);
            }
          }
        })
        .catch((error) => {
          if (!hydrationCancelled) {
            console.error('Failed to rehydrate after keys reset', error);
          }
        });
    });

    const keyDelayTimers = keyDelayTimersRef.current;
    const pendingKeyDelayTimers = pendingKeyDelayTimersRef.current;

    return () => {
      hydrationCancelled = true;
      unsubscribeResync();
      unsubscribeKeysReset();
      void unsubscribe
        .then((unsub) => {
          try {
            unsub?.();
          } catch (error) {
            console.error('Failed to remove key state listener', error);
          }
        })
        .catch(() => undefined);
      // 키 딜레이 타이머 정리
      cancelKeyDelayTimers(keyDelayTimers, pendingKeyDelayTimers);
      // 창 단위 정리 - 마운트 1회 구독이므로 여기는 실제 언마운트에서만 실행됨
      resetAllKeySignals();
    };
    // 콜백이 읽는 값은 keyEventContextRef로 공급 - 구독은 창 수명과 동일
  }, []);

  // 시그널·트랙 키는 canonical, 표시는 합성 라벨 (계약 §3, §11)
  const { currentKeys, currentKeyLabels, currentValidKeySignature } = useMemo(
    () => ({
      currentKeys: currentSlots.map((slot) => slotCanonical(slot)),
      currentKeyLabels: currentSlots.map((slot) => slotDisplayName(slot)),
      currentValidKeySignature: validKeySignature(currentSlots),
    }),
    [currentSlots],
  );

  // 탭·현재 키 집합 전환 시 예약 타이머와 눌림 신호를 권위 상태로 정합
  // positions와 다른 탭의 매핑 변경은 signature가 같아 이 effect를 건드리지 않음
  const keySignalResetArmedRef = useRef(false);
  useEffect(() => {
    if (!keySignalResetArmedRef.current) {
      // 초기 마운트 수화는 구독 effect가 담당
      keySignalResetArmedRef.current = true;
      return;
    }
    // 탭 전환은 진행 중 대조의 스냅샷을 낡게 만든다
    reconcileGenerationRef.current += 1;
    let cancelled = false;
    cancelKeyDelayTimers(
      keyDelayTimersRef.current,
      pendingKeyDelayTimersRef.current,
    );
    const seen = new Set<string>();
    const validKeys = new Set<string>(JSON.parse(currentValidKeySignature));
    seenSinceResetRef.current = seen;
    resetAllKeySignals();
    void Promise.resolve(keyEventsReadyRef.current)
      .then(() => window.api.app.bootstrap())
      .then(({ activeKeys }) => {
        if (cancelled || !activeKeys?.length) return;
        // 이후 전환의 리셋이 끼었으면 그쪽 재수화가 담당
        if (seenSinceResetRef.current !== seen) return;
        for (const key of activeKeys) {
          if (validKeys.has(key) && !seen.has(key)) {
            setKeyActiveSignal(key, true);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to rehydrate active key state', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKeyType, currentValidKeySignature]);

  return { currentKeys, currentKeyLabels };
};
