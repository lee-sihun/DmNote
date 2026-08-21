export const CANONICAL_INPUT_TIMELINE_VERSION = 1 as const;

interface CanonicalInputTimelineActionBase {
  mode: string;
  key: string;
  eventTimeUs: string;
}

export interface CanonicalInputTimelineStateAction
  extends CanonicalInputTimelineActionBase {
  kind: 'state';
  pressId: string;
  state: 'DOWN' | 'UP';
}

export interface CanonicalInputTimelineCounterAction
  extends CanonicalInputTimelineActionBase {
  kind: 'counter';
  count: number;
  counterSessionId: string;
  counterRevision: string;
}

export type CanonicalInputTimelineAction =
  | CanonicalInputTimelineStateAction
  | CanonicalInputTimelineCounterAction;

export interface CanonicalInputTimelineBaseline {
  mode: string;
  activeKeys: string[];
  counters: Record<string, Record<string, number>>;
  counterSessionId: string;
  counterRevision: string;
}

export interface CanonicalInputTimelineBatch {
  version: typeof CANONICAL_INPUT_TIMELINE_VERSION;
  streamId: string;
  revision: string;
  sourceRevision: string;
  safeThroughUs: string;
  baseline?: CanonicalInputTimelineBaseline;
  actions: CanonicalInputTimelineAction[];
}

export interface CanonicalInputTimelineActivePress {
  pressId: string;
  mode: string;
  key: string;
  downTimeUs: string;
}

export interface CanonicalInputTimelineRebase {
  version: typeof CANONICAL_INPUT_TIMELINE_VERSION;
  streamId: string;
  revision: string;
  sourceRevision: string;
  safeThroughUs: string;
  baseline: CanonicalInputTimelineBaseline;
  activePresses: CanonicalInputTimelineActivePress[];
}
