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
import { enqueueEditorCompatibilityOperation } from './editorCompatibilityQueue';
import { editorCoordinator } from './editorStateCoordinator';
import { drainEditorWrites, trackEditorWrite } from './editorWriteBarrier';
import { getEditSessionTarget } from './editSessionTarget';
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
  // 도메인 → 요소 id → 게스처 동안 누적된 전체 patch.
  // 정산 의도는 index가 아니라 id로 보존한다 - index로 두면 정산이 큐를
  // 기다리는 동안 재정렬된 다른 요소에 적용된다. id가 없는 구형 요소만
  // index sentinel로 남긴다
  appliedPatches: Map<PreviewDomain, Map<string, Record<string, unknown>>>;
  // 도메인 → target index → 다음 flush에 실릴 patch (프리뷰 wire는 index 표현 유지).
  // 대상별로 모아야 같은 대상의 옛 값이 덮어써진다. patch 내용으로 묶으면
  // 값이 연속으로 바뀌는 편집(드래그, 방향키 꾹 누르기)에서 중간값마다 그룹이 하나씩 생기고,
  // in-flight 하나가 도는 동안 쌓인 그룹이 전부 순차 발행돼 이미 무의미해진 값까지 IPC를 탄다
  pendingPatches: Map<PreviewDomain, Map<number, Record<string, unknown>>>;
  flushScheduled: boolean;
  publishInFlight: boolean;
}

type PositionsRecordLike = Record<
  string,
  Array<{ id?: string } & Record<string, unknown>>
>;

const DOMAIN_FIELDS: Record<
  PreviewDomain,
  'keyPositions' | 'statPositions' | 'graphPositions' | 'knobPositions'
> = {
  keyPosition: 'keyPositions',
  statPosition: 'statPositions',
  graphPosition: 'graphPositions',
  knobPosition: 'knobPositions',
};

const authorityRecordFor = (domain: PreviewDomain): PositionsRecordLike =>
  (domain === 'keyPosition'
    ? useKeyStore.getState().canonicalPositions
    : domain === 'statPosition'
    ? useStatItemStore.getState().positions
    : domain === 'graphPosition'
    ? useGraphItemStore.getState().positions
    : useKnobItemStore.getState().positions) as PositionsRecordLike;

const writeAuthorityRecord = (
  domain: PreviewDomain,
  next: PositionsRecordLike,
): void => {
  if (domain === 'keyPosition') {
    useKeyStore.getState().setPositions(next as never);
  } else if (domain === 'statPosition') {
    useStatItemStore.getState().setPositions(next as never);
  } else if (domain === 'graphPosition') {
    useGraphItemStore.getState().setPositions(next as never);
  } else {
    useKnobItemStore.getState().setPositions(next as never);
  }
};

const INDEX_SENTINEL = 'index:';

// 프리뷰 시점 index가 아직 뜨거울 때 id로 승격
const intentKeyFor = (
  domain: PreviewDomain,
  mode: string,
  index: number,
): string => {
  const id = authorityRecordFor(domain)[mode]?.[index]?.id;
  return typeof id === 'string' && id.length > 0
    ? id
    : `${INDEX_SENTINEL}${index}`;
};

// resolved id 집합을 record 전 모드에서 찾아 patch 병합 (id 불변)
const mergeIntentRecord = (
  record: PositionsRecordLike,
  resolved: ReadonlyMap<string, Record<string, unknown>>,
): { next: PositionsRecordLike; touched: number } => {
  let touched = 0;
  const next: PositionsRecordLike = {};
  for (const [mode, list] of Object.entries(record)) {
    next[mode] = list.map((position) => {
      const id = position.id;
      if (typeof id !== 'string' || !resolved.has(id)) return position;
      touched += 1;
      return { ...position, ...resolved.get(id), id };
    });
  }
  return { next, touched };
};

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
      const intentKey = intentKeyFor(domain, mode, entry.index);
      const applied = domainPatches.get(intentKey);
      domainPatches.set(
        intentKey,
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
        // 그 사이 편집 대상이 갈렸으면 되살린 patch의 index가 다른 요소를 가리키므로
        // 다음 커밋 경계에서 남의 값을 덮는다. 새 게스처가 이미 있을 때도 마찬가지
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

    // 의도 확정: sentinel(구형 무ID)은 현재 canonical에서 한 번 더 id 승격을
    // 시도하고, 여전히 없으면 대상 소실로 보고 버린다 (fail-closed)
    const intents = new Map<
      PreviewDomain,
      Map<string, Record<string, unknown>>
    >();
    for (const [domain, patches] of gesture.appliedPatches) {
      if (patches.size === 0) continue;
      const resolved = new Map<string, Record<string, unknown>>();
      for (const [key, patch] of patches) {
        if (!key.startsWith(INDEX_SENTINEL)) {
          resolved.set(key, { ...(resolved.get(key) ?? {}), ...patch });
          continue;
        }
        const index = Number(key.slice(INDEX_SENTINEL.length));
        const id = authorityRecordFor(domain)[gesture.mode]?.[index]?.id;
        if (typeof id === 'string' && id.length > 0) {
          resolved.set(id, { ...(resolved.get(id) ?? {}), ...patch });
        }
      }
      if (resolved.size > 0) intents.set(domain, resolved);
    }

    if (intents.size === 0) {
      this.cancel();
      return drainEditorWrites();
    }

    // eager 반영 - 이후의 full-record 캡처가 이 값을 포함해 자가 치유
    for (const [domain, resolved] of intents) {
      const merged = mergeIntentRecord(authorityRecordFor(domain), resolved);
      if (merged.touched > 0) writeAuthorityRecord(domain, merged.next);
    }

    // wire는 직렬 슬롯 안에서 최신 base로 재생성한다. 호출 시점 full-record는
    // 대기 중 정산된 다른 커밋(격리 플러그인 등)의 값을 통째로 되돌린다.
    // elementPatch applier는 rejection을 소비하므로 재사용 금지 - 정산은
    // 거절되는 원 promise가 필요하다
    const persisted = enqueueEditorCompatibilityOperation(() =>
      editorCoordinator.commitGeneratedPatch(
        (base) => {
          const changes: EditorPatchV1 = { schemaVersion: 1 };
          let hasChanges = false;
          for (const [domain, resolved] of intents) {
            const field = DOMAIN_FIELDS[domain];
            const merged = mergeIntentRecord(
              base[field] as PositionsRecordLike,
              resolved,
            );
            if (merged.touched > 0) {
              changes[field] = merged.next as never;
              hasChanges = true;
            }
          }
          return hasChanges ? changes : null;
        },
        { gestureId: gesture.sessionId },
      ),
    );
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
if (typeof window !== 'undefined') {
  let lastSelectedElements = useGridSelectionStore.getState().selectedElements;
  useGridSelectionStore.subscribe((state) => {
    if (state.selectedElements !== lastSelectedElements) {
      lastSelectedElements = state.selectedElements;
      editGestureController.cancel();
    }
  });
}
