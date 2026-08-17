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

// js:content 이벤트 payload - forced는 내용이 같아도 재주입하는 명시 리로드 표시
export type JsStatePayload = CustomJs & { forced?: boolean };
