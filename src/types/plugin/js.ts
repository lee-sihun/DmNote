import { z } from 'zod';

export const jsPluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string().nullable(),
  content: z.string(),
  enabled: z.boolean(),
});

export const customJsSchema = z.object({
  path: z.string().nullable().optional(),
  content: z.string().optional(),
  plugins: z.array(jsPluginSchema).default([]),
});

export type JsPlugin = z.infer<typeof jsPluginSchema>;
export type CustomJs = z.infer<typeof customJsSchema>;
