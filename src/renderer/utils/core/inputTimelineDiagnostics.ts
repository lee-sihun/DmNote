export interface InputTimelineDiagnostics {
  streamId: string | null;
  revision: string;
  pendingPresses: number;
  pendingActions: number;
  safeHeadroomMs: number;
  delayDebtMs: number;
  stalled: boolean;
  maxWatermarkIntervalMs: number;
  rebaseCount: number;
  failureCount: number;
}

const EMPTY_DIAGNOSTICS: InputTimelineDiagnostics = {
  streamId: null,
  revision: '0',
  pendingPresses: 0,
  pendingActions: 0,
  safeHeadroomMs: 0,
  delayDebtMs: 0,
  stalled: false,
  maxWatermarkIntervalMs: 0,
  rebaseCount: 0,
  failureCount: 0,
};

let latest = EMPTY_DIAGNOSTICS;

export const updateInputTimelineDiagnostics = (
  diagnostics: InputTimelineDiagnostics,
): void => {
  latest = diagnostics;
};

export const getInputTimelineDiagnostics = (): InputTimelineDiagnostics => ({
  ...latest,
});
