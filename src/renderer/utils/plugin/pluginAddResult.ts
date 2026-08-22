export type PluginAddAlertKind = 'partial' | 'failed' | 'success' | 'none';

export function classifyPluginAddResult(
  addedCount: number,
  errorCount: number,
): PluginAddAlertKind {
  if (errorCount > 0) return addedCount > 0 ? 'partial' : 'failed';
  return addedCount > 0 ? 'success' : 'none';
}
