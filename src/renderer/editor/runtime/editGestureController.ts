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

interface PreviewEntry {
  index: number;
  patch: Record<string, unknown>;
}

interface PreviewOptions {
  domain?: PreviewDomain;
}

interface ActiveGesture {
  sessionId: string;
  mode: string;
  seq: number;
  // 도메인 → target index → 게스처 동안 누적된 전체 patch
  appliedPatches: Map<PreviewDomain, Map<number, Record<string, unknown>>>;
  // 다음 flush에 실릴 patch (patch 내용 직렬화 키로 그룹핑)
  pendingGroups: Map<
    string,
    {
      domain: PreviewDomain;
      targets: Set<number>;
      patch: Record<string, unknown>;
    }
  >;
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

const flushPending = async (gesture: ActiveGesture) => {
  // invoke in-flight 1개 유지, 대기 중 최신 patch만 보존
  if (gesture !== active || gesture.publishInFlight) return;
  if (gesture.pendingGroups.size === 0) return;

  const groups = [...gesture.pendingGroups.values()];
  gesture.pendingGroups.clear();
  gesture.publishInFlight = true;
  try {
    for (const group of groups) {
      gesture.seq += 1;
      await previewApi.publish({
        schemaVersion: PREVIEW_SCHEMA_VERSION,
        sessionId: gesture.sessionId,
        seq: gesture.seq,
        domain: group.domain,
        mode: gesture.mode,
        targets: [...group.targets],
        patch: group.patch,
      });
    }
  } catch (error) {
    console.error('Failed to publish preview', error);
  } finally {
    gesture.publishInFlight = false;
    if (gesture === active && gesture.pendingGroups.size > 0) {
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
      active = {
        sessionId: crypto.randomUUID(),
        mode,
        seq: 0,
        appliedPatches: new Map(),
        pendingGroups: new Map(),
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
      const groupKey = JSON.stringify([domain, entry.patch]);
      const group = active.pendingGroups.get(groupKey);
      if (group) {
        group.targets.add(entry.index);
        group.patch = { ...group.patch, ...entry.patch };
      } else {
        active.pendingGroups.set(groupKey, {
          domain,
          targets: new Set([entry.index]),
          patch: { ...entry.patch },
        });
      }
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

  /**
   * 커밋 정산: persist 성공 시 세션 종료 + 수신측 정리 브로드캐스트
   * 실패 시 세션 유지 (재시도 또는 명시 cancel은 호출자 몫)
   */
  settleCommit(persistPromise: Promise<unknown>): void {
    // 게스처 유무와 무관하게 창 전환이 정산 커밋의 성패까지 기다리게 함
    trackEditorWrite(persistPromise);

    const gesture = active;
    if (!gesture) return;
    active = null;

    persistPromise
      .then(() => {
        previewOverlay.endSession(gesture.sessionId);
        // 1차 정리는 committed 이벤트의 gestureId echo, cancel은 병합 커밋 등
        // echo가 다른 세션으로 향한 경우를 위한 보조 정리
        // 커밋 revision을 게이트로 실어 수신측의 선행 제거를 방지
        const committedRevision = editorCoordinator.getState().revision;
        previewApi
          .cancel(gesture.sessionId, committedRevision ?? undefined)
          .catch(() => {});
      })
      .catch((error) => {
        console.error('Commit failed, keeping preview session', error);
        // 새 게스처가 이미 시작됐으면 이전 세션은 오버레이만 정리
        if (active === null) {
          active = gesture;
        } else {
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
    gesture.pendingGroups.clear();
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

  // 창 포커스 이탈 시 진행 중 게스처 커밋 (입력 유실 방지)
  window.addEventListener('blur', () => {
    editGestureController.commitPending();
  });
}
