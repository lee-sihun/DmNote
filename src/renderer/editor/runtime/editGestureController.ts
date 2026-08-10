/**
 * 편집 게스처 컨트롤러
 * begin → preview* → (commit 성공 | cancel) 생명주기 관리
 * 프리뷰는 오버레이+채널로만 흐르고 canonical에 기록되지 않음
 */

import { previewApi } from '@api/modules/previewApi';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { EditorPatchV1 } from '@src/types/editor';
import { PREVIEW_SCHEMA_VERSION, type PreviewDomain } from '@src/types/preview';

import { previewOverlay } from './previewOverlay';
import { editorCoordinator } from './editorStateCoordinator';
import { drainEditorWrites, trackEditorWrite } from './editorWriteBarrier';
import {
  registerGestureSession,
  releaseGestureSession,
  type GestureSessionLifecycle,
} from './gestureSessionLifecycle';

interface PreviewEntry {
  index: number;
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
  // 도메인 → target index → 게스처 동안 누적된 전체 patch
  appliedPatches: Map<PreviewDomain, Map<number, Record<string, unknown>>>;
  // 도메인 → target index → 다음 flush에 실릴 patch.
  // 대상별로 모아야 같은 대상의 옛 값이 덮어써진다. patch 내용으로 묶으면
  // 값이 연속으로 바뀌는 편집(드래그, 방향키 꾹 누르기)에서 중간값마다 그룹이 하나씩 생기고,
  // in-flight 하나가 도는 동안 쌓인 그룹이 전부 순차 발행돼 이미 무의미해진 값까지 IPC를 탄다
  pendingPatches: Map<PreviewDomain, Map<number, Record<string, unknown>>>;
  flushScheduled: boolean;
  publishInFlight: boolean;
}

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

    const [firstIndex, patch] = first.value;
    const patchKey = JSON.stringify(patch);
    const groupTargets = [firstIndex];
    targets.delete(firstIndex);

    for (const [index, candidate] of targets) {
      if (JSON.stringify(candidate) === patchKey) {
        groupTargets.push(index);
        targets.delete(index);
      }
    }

    if (targets.size === 0) gesture.pendingPatches.delete(domain);
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
    for (const entry of entries) {
      const applied = domainPatches.get(entry.index);
      domainPatches.set(
        entry.index,
        applied ? { ...applied, ...entry.patch } : { ...entry.patch },
      );
      previewOverlay.applyLocalPatch(
        active.sessionId,
        mode,
        [entry.index],
        entry.patch,
        domain,
      );
      let pending = active.pendingPatches.get(domain);
      if (!pending) {
        pending = new Map();
        active.pendingPatches.set(domain, pending);
      }
      const queued = pending.get(entry.index);
      pending.set(
        entry.index,
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

  /** 커밋 정산: 성공 시 로컬 세션 종료, 실패 시 재시도 상태 복원 */
  settleCommit(persistPromise: Promise<unknown>): void {
    // 게스처 유무와 무관하게 창 전환이 정산 커밋의 성패까지 기다리게 함
    trackEditorWrite(persistPromise);

    const gesture = active;
    if (!gesture) return;
    active = null;

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
        // 새 게스처가 이미 시작됐으면 이전 세션은 오버레이만 정리
        if (active === null) {
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
    if (!gesture) return;
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
    const changes: EditorPatchV1 = { schemaVersion: 1 };
    let hasChanges = false;

    const applyPatches = <T extends object>(
      positions: Record<string, T[]>,
      patches: Map<number, Record<string, unknown>>,
    ): Record<string, T[]> | null => {
      const current = positions[gesture.mode];
      if (!current) return null;
      return {
        ...positions,
        [gesture.mode]: current.map((position, index) => {
          const patch = patches.get(index);
          return patch ? { ...position, ...patch } : position;
        }),
      };
    };

    for (const [domain, patches] of gesture.appliedPatches) {
      if (patches.size === 0) continue;
      if (domain === 'keyPosition') {
        const updated = applyPatches(
          useKeyStore.getState().canonicalPositions,
          patches,
        );
        if (!updated) {
          this.cancel();
          return drainEditorWrites();
        }
        changes.keyPositions = updated;
      } else if (domain === 'statPosition') {
        const updated = applyPatches(
          useStatItemStore.getState().positions,
          patches,
        );
        if (!updated) {
          this.cancel();
          return drainEditorWrites();
        }
        changes.statPositions = updated;
      } else if (domain === 'graphPosition') {
        const updated = applyPatches(
          useGraphItemStore.getState().positions,
          patches,
        );
        if (!updated) {
          this.cancel();
          return drainEditorWrites();
        }
        changes.graphPositions = updated;
      } else {
        const updated = applyPatches(
          useKnobItemStore.getState().positions,
          patches,
        );
        if (!updated) {
          this.cancel();
          return drainEditorWrites();
        }
        changes.knobPositions = updated;
      }
      hasChanges = true;
    }

    if (!hasChanges) {
      this.cancel();
      return drainEditorWrites();
    }

    const persisted = editorCoordinator.commitPatch(changes, {
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

  commitPending(): void {
    void this.commitPendingAsync();
  },
};

// 선택 대상 변경 시 진행 중 게스처 취소 (barrier)
if (typeof window !== 'undefined') {
  let lastSelectedElements = useGridSelectionStore.getState().selectedElements;
  useGridSelectionStore.subscribe((state) => {
    if (state.selectedElements !== lastSelectedElements) {
      lastSelectedElements = state.selectedElements;
      editGestureController.cancel();
    }
  });
}
