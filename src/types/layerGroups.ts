import { z } from 'zod';

export const layerGroupDefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type LayerGroupDef = z.infer<typeof layerGroupDefSchema>;

export const layerGroupsSchema = z.record(
  z.string(),
  z.array(layerGroupDefSchema),
);

export type LayerGroups = Record<string, LayerGroupDef[]>;
