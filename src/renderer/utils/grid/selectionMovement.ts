import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

interface MovablePosition {
  id: string;
  dx: number;
  dy: number;
}

export const moveSelectedNativePositions = <Position extends MovablePosition>(
  positions: Record<string, Position[]>,
  mode: string,
  selectedIds: ReadonlySet<string>,
  deltaX: number,
  deltaY: number,
): Record<string, Position[]> => {
  const next = { ...positions };
  next[mode] = (positions[mode] ?? []).map((position) =>
    selectedIds.has(position.id)
      ? { ...position, dx: position.dx + deltaX, dy: position.dy + deltaY }
      : position,
  );
  return next;
};

export const selectedPluginIds = (
  elements: readonly PluginDisplayElementInternal[],
  selectedFullIds: ReadonlySet<string>,
): string[] => [
  ...new Set(
    elements
      .filter((element) => selectedFullIds.has(element.fullId))
      .map((element) => element.pluginId),
  ),
];

export const moveSelectedPluginElements = (
  elements: readonly PluginDisplayElementInternal[],
  selectedFullIds: ReadonlySet<string>,
  deltaX: number,
  deltaY: number,
): PluginDisplayElementInternal[] =>
  elements.map((element) =>
    selectedFullIds.has(element.fullId)
      ? {
          ...element,
          position: {
            x: element.position.x + deltaX,
            y: element.position.y + deltaY,
          },
        }
      : element,
  );
