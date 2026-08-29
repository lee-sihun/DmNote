import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TAURI_ROOT = join(__dirname, '..', 'src-tauri');
const PROJECT_ROOT = join(__dirname, '..');

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

describe('macOS WKWebView benchmark window contract', () => {
  it.each([
    'run-interaction-webview-macos.mjs',
    'run-interaction-webview-matrix-macos.mjs',
  ])(
    '%s는 Rust에서 생성하는 main 윈도우를 설정에서 중복 생성하지 않는다',
    (name) => {
      const source = readFileSync(join(PROJECT_ROOT, 'scripts', name), 'utf8');

      expect(source).toMatch(
        /label:\s*['"]main['"][\s\S]{0,120}create:\s*false/,
      );
    },
  );
});
