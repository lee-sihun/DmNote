import { convertFileSrc } from '@tauri-apps/api/core';

const imageSrcCache = new Map<string, string>();
const IMAGE_SRC_CACHE_LIMIT = 256;

const PASSTHROUGH_PREFIX = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

function isLikelyLocalPath(value: string): boolean {
  if (!value) return false;
  if (PASSTHROUGH_PREFIX.test(value)) return false;
  if (WINDOWS_ABSOLUTE_PATH.test(value)) return true;
  if (WINDOWS_UNC_PATH.test(value)) return true;
  if (value.startsWith('/')) return true;
  return false;
}

/** base64url 인코딩 (패딩 없음) */
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** OBS 환경에서 미디어 파일 URL 생성 (토큰 포함) */
function resolveForObs(path: string): string {
  const encoded = toBase64Url(path);
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const tokenQuery = token ? `?token=${token}` : '';
  return `${window.location.origin}/media/${encoded}${tokenQuery}`;
}

export function resolveImageSource(value?: string | null): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  if (!isLikelyLocalPath(raw)) {
    return raw;
  }

  const cached = imageSrcCache.get(raw);
  if (cached !== undefined) {
    imageSrcCache.delete(raw);
    imageSrcCache.set(raw, cached);
    return cached;
  }

  // Tauri API 시도 → 실패 시 OBS HTTP fallback
  try {
    const converted = convertFileSrc(raw);
    cacheImageSource(raw, converted);
    return converted;
  } catch {
    // OBS 환경 (Tauri API 없음): HTTP /media/ 경로로 서빙
    const url = resolveForObs(raw);
    cacheImageSource(raw, url);
    return url;
  }
}

function cacheImageSource(path: string, src: string): void {
  imageSrcCache.set(path, src);
  while (imageSrcCache.size > IMAGE_SRC_CACHE_LIMIT) {
    const oldest = imageSrcCache.keys().next().value;
    if (oldest === undefined) break;
    imageSrcCache.delete(oldest);
  }
}

export function clearImageSourceCache(): void {
  imageSrcCache.clear();
}
