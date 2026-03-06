import { z } from 'zod';

export const customCssSchema = z.object({
  path: z.string().nullable(),
  content: z.string(),
});

export type CustomCss = z.infer<typeof customCssSchema>;

// 탭별 CSS 스키마
export const tabCssSchema = z.object({
  path: z.string().nullable(),
  content: z.string(),
  enabled: z.boolean().default(true),
});

export type TabCss = z.infer<typeof tabCssSchema>;

// 탭별 CSS 오버라이드 맵 (키: 탭 ID)
export type TabCssOverrides = Record<string, TabCss>;
