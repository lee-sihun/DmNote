import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TAURI_ROOT = join(__dirname, '..', 'src-tauri');

const readConfig = (name: string) =>
  JSON.parse(readFileSync(join(TAURI_ROOT, name), 'utf8')) as {
    app?: { withGlobalTauri?: boolean };
  };

describe('Tauri global API contract', () => {
  it('문서화된 __TAURI__ 전역을 모든 앱 설정에서 비활성화한다', () => {
    expect(readConfig('tauri.conf.json').app?.withGlobalTauri).toBe(false);

    const overrides = readdirSync(TAURI_ROOT).filter(
      (name) => name.startsWith('tauri.') && name.endsWith('.conf.json'),
    );

    for (const name of overrides) {
      expect(readConfig(name).app?.withGlobalTauri, name).not.toBe(true);
    }
  });
});
