import { convertFileSrc } from "@tauri-apps/api/core";

const imageSrcCache = new Map<string, string>();

const PASSTHROUGH_PREFIX = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

function isLikelyLocalPath(value: string): boolean {
  if (!value) return false;
  if (PASSTHROUGH_PREFIX.test(value)) return false;
  if (WINDOWS_ABSOLUTE_PATH.test(value)) return true;
  if (WINDOWS_UNC_PATH.test(value)) return true;
  if (value.startsWith("/")) return true;
  return false;
}

export function resolveImageSource(value?: string | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  if (!isLikelyLocalPath(raw)) {
    return raw;
  }

  const cached = imageSrcCache.get(raw);
  if (cached) {
    return cached;
  }

  try {
    const converted = convertFileSrc(raw);
    imageSrcCache.set(raw, converted);
    return converted;
  } catch {
    return raw;
  }
}

