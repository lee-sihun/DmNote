/**
 * 편집 게스처 컨트롤러
 * begin → preview* → (commit 성공 | cancel) 생명주기 관리
 * 프리뷰는 오버레이+채널로만 흐르고 canonical에 기록되지 않음
 */

import { previewApi } from '@api/modules/previewApi';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { PREVIEW_SCHEMA_VERSION, type PreviewDomain } from '@src/types/preview';
import { stableStringify } from '@utils/core/stableStringify';
import { isNativeElementId } from '../model/elementId';

import { previewOverlay } from './previewOverlay';
import {
  applyPropertyIntentsEagerly,
  generatePropertyIntentPatch,
  intentPatch,
  runElementIntent,
  type PropertyIntents,
} from './elementIntent';
import { drainEditorWrites, trackEditorWrite } from './editorWriteBarrier';
import { getEditSessionTarget } from './editSessionTarget';
import {
  markGestureSessionsDiscarded,
  registerGestureSession,
  releaseGestureSession,
  type GestureSessionLifecycle,
} from './gestureSessionLifecycle';

interface PreviewEntry {
  // 요소 안정 id. 신원의 유일 원천 - 비 native id는 fail-closed로 무시
  id: string;
  patch: Record<string, unknown>;
}

interface PreviewOptions {
  domain?: PreviewDomain;
}

interface ActiveGesture {
  sessionId: string;
  lifecycle: GestureSessionLifecycle;
  mode: string;
  seq: number;
  // 도메인 → 요소 id → 게스처 동안 누적된 전체 patch
  appliedPatches: Map<PreviewDomain, Map<string, Record<string, unknown>>>;
  // 도메인 → 요소 id → 다음 flush에 실릴 patch (프리뷰 wire는 index 표현 유지).
  // 대상별로 모아야 같은 대상의 옛 값이 덮어써진다. patch 내용으로 묶으면
  // 값이 연속으로 바뀌는 편집(드래그, 방향키 꾹 누르기)에서 중간값마다 그룹이 하나씩 생기고,
  // in-flight 하나가 도는 동안 쌓인 그룹이 전부 순차 발행돼 이미 무의미해진 값까지 IPC를 탄다
  pendingPatches: Map<PreviewDomain, Map<string, Record<string, unknown>>>;
  flushScheduled: boolean;
  publishInFlight: boolean;
}

type PositionsRecordLike = Record<
  string,
  Array<{ id: string } & Record<string, unknown>>
>;

const authorityRecordFor = (domain: PreviewDomain): PositionsRecordLike =>
  (domain === 'keyPosition'
    ? useKeyStore.getState().canonicalPositions
    : domain === 'statPosition'
    ? useStatItemStore.getState().positions
    : domain === 'graphPosition'
    ? useGraphItemStore.getState().positions
    : domain === 'knobPosition'
    ? useKnobItemStore.getState().positions
    : useSpriteStore.getState().positions) as PositionsRecordLike;

const currentIndexForId = (
  domain: PreviewDomain,
  mode: string,
  id: string,
): number =>
  (authorityRecordFor(domain)[mode] ?? []).findIndex(
    (position) => position.id === id,
  );

let active: ActiveGesture | null = null;

const schedulePublishFlush = () => {
  const gesture = active;
  if (!gesture || gesture.flushScheduled) return;
  gesture.flushScheduled = true;
  requestAnimationFrame(() => {
    gesture.flushScheduled = false;
    void flushPending(gesture);
  });
};

const hasPending = (gesture: ActiveGesture): boolean => {
  for (const targets of gesture.pendingPatches.values()) {
    if (targets.size > 0) return true;
  }
  return false;
};

// 다음 발행분 하나만 꺼낸다. 아직 발행하지 않은 대상은 pending에 남아 있어야
// 앞선 invoke를 기다리는 동안 새 입력이 들어왔을 때 최신 patch로 교체할 수 있다
const takeNextGroup = (gesture: ActiveGesture) => {
  for (const [domain, targets] of gesture.pendingPatches) {
    const first = targets.entries().next();
    if (first.done) {
      gesture.pendingPatches.delete(domain);
      continue;
    }

    const [firstId, patch] = first.value;
    const patchKey = JSON.stringify(patch);
    const firstIndex = currentIndexForId(domain, gesture.mode, firstId);
    const groupTargets = firstIndex >= 0 ? [firstIndex] : [];
    targets.delete(firstId);

    for (const [id, candidate] of targets) {
      if (JSON.stringify(candidate) === patchKey) {
        const index = currentIndexForId(domain, gesture.mode, id);
        if (index >= 0) groupTargets.push(index);
        targets.delete(id);
      }
    }

    if (targets.size === 0) gesture.pendingPatches.delete(domain);
    if (groupTargets.length === 0) continue;
    return { domain, targets: groupTargets, patch };
  }

  return null;
};

const flushPending = async (gesture: ActiveGesture) => {
  // invoke in-flight 1개 유지, 대기 중 최신 patch만 보존
  if (gesture !== active || gesture.publishInFlight) return;
  if (!hasPending(gesture)) return;

  gesture.publishInFlight = true;
  try {
    while (gesture === active) {
      const group = takeNextGroup(gesture);
      if (!group) break;
      gesture.seq += 1;
      await previewApi.publish({
        schemaVersion: PREVIEW_SCHEMA_VERSION,
        sessionId: gesture.sessionId,
        seq: gesture.seq,
        domain: group.domain,
        mode: gesture.mode,
        targets: group.targets,
        patch: group.patch,
      });
    }
  } catch (error) {
    console.error('Failed to publish preview', error);
  } finally {
    gesture.publishInFlight = false;
    if (gesture === active && hasPending(gesture)) {
      schedulePublishFlush();
    }
  }
};

export const editGestureController = {
  /**
   * 프리뷰 반영, 활성 게스처가 없으면 자동 begin
   * 모드가 바뀌면 이전 게스처를 cancel하고 새로 시작
   */
  preview(
    mode: string,
    entries: PreviewEntry[],
    options?: PreviewOptions,
  ): void {
    if (entries.length === 0) return;
    const domain = options?.domain ?? 'keyPosition';

    if (active && active.mode !== mode) {
      this.cancel();
    }
    // 신원은 호출부가 전달한 안정 id가 결정한다. 비 native id는 fail-closed
    const validEntries = entries.filter((entry) => isNativeElementId(entry.id));
    // 전 항목 skip이면 빈 게스처를 만들지 않는다. 활성 게스처는 세션 유지
    if (validEntries.length === 0 && !active) return;
    if (!active) {
      const sessionId = crypto.randomUUID();
      active = {
        sessionId,
        lifecycle: registerGestureSession(sessionId),
        mode,
        seq: 0,
        appliedPatches: new Map(),
        pendingPatches: new Map(),
        flushScheduled: false,
        publishInFlight: false,
      };
    }

    let domainPatches = active.appliedPatches.get(domain);
    if (!domainPatches) {
      domainPatches = new Map();
      active.appliedPatches.set(domain, domainPatches);
    }
    for (const entry of validEntries) {
      const intentKey = entry.id;
      const currentIndex = currentIndexForId(domain, mode, intentKey);
      if (currentIndex < 0) continue;
      const applied = domainPatches.get(intentKey);
      domainPatches.set(
        intentKey,
        applied ? { ...applied, ...entry.patch } : { ...entry.patch },
      );
      const replacedSessionIds = previewOverlay.applyLocalPatchByIds(
        active.sessionId,
        mode,
        [intentKey],
        entry.patch,
        domain,
      );
      markGestureSessionsDiscarded(replacedSessionIds);
      replacedSessionIds.forEach((sessionId) => {
        previewApi.cancel(sessionId).catch(() => {});
      });
      let pending = active.pendingPatches.get(domain);
      if (!pending) {
        pending = new Map();
        active.pendingPatches.set(domain, pending);
      }
      const queued = pending.get(intentKey);
      pending.set(
        intentKey,
        queued ? { ...queued, ...entry.patch } : { ...entry.patch },
      );
    }
    schedulePublishFlush();
  },

  /** 활성 게스처 존재 여부 (커밋 핸들러의 히스토리 중복 push 방지용) */
  hasActiveGesture(): boolean {
    return active !== null;
  },

  activeGestureId(): string | null {
    return active?.sessionId ?? null;
  },

  /** 컨트롤러 소유권을 잃은 로컬 프리뷰 회수 */
  discardOrphanedLocalPreviews(): boolean {
    const discarded = previewOverlay.discardLocalSessionsExcept(
      active?.sessionId ?? null,
    );
    markGestureSessionsDiscarded(discarded);
    discarded.forEach((sessionId) => {
      previewApi.cancel(sessionId).catch(() => {});
    });
    return discarded.length > 0;
  },

  /** 커밋 정산: 성공 시 로컬 세션 종료, 실패 시 재시도 상태 복원 */
  settleCommit(persistPromise: Promise<unknown>): void {
    // 게스처 유무와 무관하게 창 전환이 정산 커밋의 성패까지 기다리게 함
    trackEditorWrite(persistPromise);

    const gesture = active;
    if (!gesture) return;
    active = null;
    // 실패 복원을 판정할 기준. 정산이 끝났을 때 대상이 그대로여야 되살릴 의미가 있다
    const committedTarget = getEditSessionTarget();

    persistPromise
      .then(() => {
        releaseGestureSession(gesture.lifecycle);
        previewOverlay.endSession(gesture.sessionId);
        // 1차 정리는 committed 이벤트의 gestureIds echo - 배치 간격 커밋처럼
        // echo가 다른 세션 ID로 향하면 원격 창의 이 세션이 잔존하므로 보조 정리
        // (tombstone이 중복 cancel을 흡수해 정상 경로에선 no-op)
        previewApi.cancel(gesture.sessionId).catch(() => {});
      })
      .catch((error) => {
        if (gesture.lifecycle.discarded) {
          releaseGestureSession(gesture.lifecycle);
          previewOverlay.endSession(gesture.sessionId);
          previewApi.cancel(gesture.sessionId).catch(() => {});
          return;
        }
        console.error('Commit failed, keeping preview session', error);
        // 세션을 살려두는 건 같은 대상에서 재시도하라는 뜻이다.
        // 그 사이 편집 대상이 갈렸으면 되살린 세션이 이미 떠난 대상의 patch를
        // 다음 커밋 경계에 실어 보낸다. 새 게스처가 이미 있을 때도 마찬가지
        if (active === null && getEditSessionTarget() === committedTarget) {
          active = gesture;
        } else {
          releaseGestureSession(gesture.lifecycle);
          previewOverlay.endSession(gesture.sessionId);
          previewApi.cancel(gesture.sessionId).catch(() => {});
        }
      });
  },

  /** 게스처 취소: 오버레이 제거 + cancel 브로드캐스트, canonical 무변경 */
  cancel(): void {
    const gesture = active;
    if (!gesture) {
      this.discardOrphanedLocalPreviews();
      return;
    }
    active = null;
    releaseGestureSession(gesture.lifecycle);
    gesture.pendingPatches.clear();
    previewOverlay.endSession(gesture.sessionId);
    previewApi.cancel(gesture.sessionId).catch(() => {});
  },

  /**
   * 누적 patch를 canonical에 승격해 일반 커밋
   * 창 blur·종료처럼 호출자 커밋 경로가 없는 경계에서 사용
   * 반환값: 커밋 성패 (활성 게스처 없음·빈 patch는 성공 취급)
   */
  async commitPendingAsync(): Promise<boolean> {
    const gesture = active;
    if (!gesture || gesture.appliedPatches.size === 0) {
      if (gesture) this.cancel();
      return drainEditorWrites();
    }

    const intents = new Map<
      PreviewDomain,
      Map<string, Record<string, unknown>>
    >();
    for (const [domain, patches] of gesture.appliedPatches) {
      if (patches.size === 0) continue;
      const resolved = new Map<string, Record<string, unknown>>();
      for (const [key, patch] of patches) {
        resolved.set(key, { ...(resolved.get(key) ?? {}), ...patch });
      }
      if (resolved.size > 0) intents.set(domain, resolved);
    }

    if (intents.size === 0) {
      this.cancel();
      return drainEditorWrites();
    }

    // (domain, id) 의도를 (type, id) 속성 의도로 변환 - eager 낙관과 실패
    // 복원(편입 전·대상 소실)은 runElementIntent가 소유하고, wire는 직렬
    // 슬롯 안에서 최신 base로 재생성된다. 정산에는 거절되는 원 promise가
    // 필요하므로 오류를 삼키는 applier 경로는 쓰지 않는다
    const DOMAIN_TO_TYPE = {
      keyPosition: 'key',
      statPosition: 'stat',
      graphPosition: 'graph',
      knobPosition: 'knob',
      spritePosition: 'sprite',
    } as const;
    const propertyIntents: PropertyIntents = new Map(
      [...intents].map(([domain, resolved]) => [
        DOMAIN_TO_TYPE[domain],
        resolved,
      ]),
    );
    const persisted = runElementIntent({
      applyEager: () => applyPropertyIntentsEagerly(propertyIntents),
      generate: (base) =>
        intentPatch(generatePropertyIntentPatch(base, propertyIntents)),
      gestureId: gesture.sessionId,
    });
    this.settleCommit(persisted);
    const own = await persisted.then(
      () => true,
      () => false,
    );
    if (!own) return false;
    return drainEditorWrites();
  },
};

// 선택 대상 변경 시 진행 중 게스처 취소 (barrier)
// 지문은 구조 직렬화 - 이어붙이기는 플러그인 fullId의 구분자와 충돌해
// 서로 다른 선택이 같은 지문이 된다. index는 제외해 재정렬만으로는 미발화
let unsubscribeSelectionChange: (() => void) | null = null;
if (typeof window !== 'undefined') {
  const identityFingerprint = (
    elements: ReadonlyArray<{ type: string; id: string }>,
  ): string =>
    stableStringify(
      elements
        .map((element) => [element.type, element.id] as const)
        .sort(([leftType, leftId], [rightType, rightId]) => {
          if (leftType !== rightType) return leftType < rightType ? -1 : 1;
          if (leftId === rightId) return 0;
          return leftId < rightId ? -1 : 1;
        }),
    );
  let lastSelectionFingerprint = identityFingerprint(
    useGridSelectionStore.getState().selectedElements,
  );
  unsubscribeSelectionChange = useGridSelectionStore.subscribe((state) => {
    const nextFingerprint = identityFingerprint(state.selectedElements);
    if (nextFingerprint !== lastSelectionFingerprint) {
      lastSelectionFingerprint = nextFingerprint;
      editGestureController.cancel();
    }
  });
}

// 개발 중 모듈 교체에서도 활성 게스처와 로컬 프리뷰를 함께 회수
const hotModule = (
  import.meta as ImportMeta & {
    hot?: { dispose: (callback: () => void) => void };
  }
).hot;
if (hotModule) {
  hotModule.dispose(() => {
    unsubscribeSelectionChange?.();
    editGestureController.cancel();
  });
}
