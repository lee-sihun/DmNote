/**
 * 편집 프리뷰 오버레이 계층
 * canonical 위에 세션별 patch를 렌더 시점에만 합성, canonical은 불가침
 */

import {
  composeRenderedPositions,
  registerRenderedPositionsComposer,
  useKeyStore,
} from '@stores/data/useKeyStore';

import type { PreviewEnvelope, PreviewDomain } from '@src/types/preview';

interface PreviewSession {
  mode: string;
  // 도메인 → target index → 누적 patch (같은 필드는 덮어쓰기)
  domainPatches: Map<PreviewDomain, Map<number, Record<string, unknown>>>;
  // 로컬 세션은 ID를 신원으로 보관해 canonical reorder에도 같은 요소를 따라간다
  localIdPatches: Map<PreviewDomain, Map<string, Record<string, unknown>>>;
  lastSeq: number;
}

const sessions = new Map<string, PreviewSession>();

let overlayVersion = 0;
const overlayListeners = new Set<() => void>();

export const subscribePreviewOverlay = (listener: () => void) => {
  overlayListeners.add(listener);
  return () => overlayListeners.delete(listener);
};

export const getPreviewOverlayVersion = () => overlayVersion;

// 종료 세션 tombstone, 늦게 도착한 patch 폐기용
const TOMBSTONE_LIMIT = 64;
const tombstones = new Set<string>();

const addTombstone = (sessionId: string) => {
  tombstones.add(sessionId);
  if (tombstones.size > TOMBSTONE_LIMIT) {
    const oldest = tombstones.values().next().value;
    if (oldest !== undefined) tombstones.delete(oldest);
  }
};

export const composePreviewPositions = <T extends { id: string }>(
  domain: PreviewDomain,
  canonical: Record<string, T[]>,
): Record<string, T[]> => {
  if (sessions.size === 0) return canonical;

  let rendered = canonical;
  for (const session of sessions.values()) {
    const targetPatches = session.domainPatches.get(domain);
    const idPatches = session.localIdPatches.get(domain);
    if (!targetPatches && !idPatches) continue;
    const modePositions = rendered[session.mode];
    if (!modePositions) continue;

    let nextMode: T[] | null = null;
    for (const [index, patch] of targetPatches ?? []) {
      const current = (nextMode ?? modePositions)[index];
      if (!current) continue;
      if (nextMode === null) nextMode = [...modePositions];
      nextMode[index] = { ...current, ...patch };
    }
    for (const [id, patch] of idPatches ?? []) {
      const index = (nextMode ?? modePositions).findIndex(
        (position) => position.id === id,
      );
      if (index < 0) continue;
      const current = (nextMode ?? modePositions)[index];
      if (!current) continue;
      if (nextMode === null) nextMode = [...modePositions];
      nextMode[index] = { ...current, ...patch };
    }
    if (nextMode !== null) {
      rendered = { ...rendered, [session.mode]: nextMode };
    }
  }
  return rendered;
};

registerRenderedPositionsComposer((canonical) =>
  composePreviewPositions('keyPosition', canonical),
);

const recompose = () => {
  const canonical = useKeyStore.getState().canonicalPositions;
  useKeyStore.setState({ positions: composeRenderedPositions(canonical) });
};

const refreshRenderedState = () => {
  recompose();
  overlayVersion += 1;
  overlayListeners.forEach((listener) => listener());
};

const mergeTargetPatch = (
  session: PreviewSession,
  domain: PreviewDomain,
  targets: number[],
  patch: Record<string, unknown>,
) => {
  let targetPatches = session.domainPatches.get(domain);
  if (!targetPatches) {
    targetPatches = new Map();
    session.domainPatches.set(domain, targetPatches);
  }
  for (const index of targets) {
    const existing = targetPatches.get(index);
    targetPatches.set(
      index,
      existing ? { ...existing, ...patch } : { ...patch },
    );
  }
};

const mergeLocalIdPatch = (
  session: PreviewSession,
  domain: PreviewDomain,
  targets: readonly string[],
  patch: Record<string, unknown>,
) => {
  let targetPatches = session.localIdPatches.get(domain);
  if (!targetPatches) {
    targetPatches = new Map();
    session.localIdPatches.set(domain, targetPatches);
  }
  for (const id of targets) {
    const existing = targetPatches.get(id);
    targetPatches.set(id, existing ? { ...existing, ...patch } : { ...patch });
  }
};

export const previewOverlay = {
  /** 로컬(발신) 세션 patch 반영 */
  applyLocalPatch(
    sessionId: string,
    mode: string,
    targets: number[],
    patch: Record<string, unknown>,
    domain: PreviewDomain = 'keyPosition',
  ): void {
    if (tombstones.has(sessionId)) return;
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        mode,
        domainPatches: new Map(),
        localIdPatches: new Map(),
        lastSeq: 0,
      };
      sessions.set(sessionId, session);
    }
    mergeTargetPatch(session, domain, targets, patch);
    refreshRenderedState();
  },

  applyLocalPatchByIds(
    sessionId: string,
    mode: string,
    targets: readonly string[],
    patch: Record<string, unknown>,
    domain: PreviewDomain = 'keyPosition',
  ): void {
    if (tombstones.has(sessionId)) return;
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        mode,
        domainPatches: new Map(),
        localIdPatches: new Map(),
        lastSeq: 0,
      };
      sessions.set(sessionId, session);
    }
    mergeLocalIdPatch(session, domain, targets, patch);
    refreshRenderedState();
  },

  /** 원격 envelope 반영 (자기 발신 echo는 호출 전에 걸러짐) */
  applyRemoteEnvelope(envelope: PreviewEnvelope): void {
    if (tombstones.has(envelope.sessionId)) return;

    if (envelope.kind === 'cancel') {
      this.endSession(envelope.sessionId);
      return;
    }

    let session = sessions.get(envelope.sessionId);
    if (session) {
      // 세션 내 stale patch 폐기
      if (envelope.seq <= session.lastSeq) return;
    } else {
      session = {
        mode: envelope.mode,
        domainPatches: new Map(),
        localIdPatches: new Map(),
        lastSeq: 0,
      };
      sessions.set(envelope.sessionId, session);
    }
    session.lastSeq = envelope.seq;
    mergeTargetPatch(
      session,
      envelope.domain,
      envelope.targets,
      envelope.patch,
    );
    refreshRenderedState();
  },

  /**
   * 세션 종료 (commit 성공·cancel 공통)
   * 오버레이만 제거하며 canonical은 건드리지 않음
   */
  endSession(sessionId: string): void {
    this.endSessions([sessionId]);
  },

  endSessions(sessionIds: readonly string[]): void {
    let changed = false;
    for (const sessionId of sessionIds) {
      addTombstone(sessionId);
      changed = sessions.delete(sessionId) || changed;
    }
    if (changed) refreshRenderedState();
  },

  /** 테스트·리셋용 전체 정리 */
  clearAll(): void {
    sessions.clear();
    tombstones.clear();
    refreshRenderedState();
  },
};
