import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gateErrors, parseChanges, planValidation } from './policy.ts';

test('Draft 갱신은 빠른 검사, 같은 변경의 Ready 전환은 전체 검사', () => {
  const changes = parseChanges('M\0src/types/editor.ts\0');
  assert.equal(planValidation('pull_request', true, changes).mode, 'draft');
  assert.equal(planValidation('pull_request', false, changes).mode, 'full');
});

test('문서 삭제와 두 언어 MDX 변경은 문서 검사', () => {
  const changes = parseChanges(
    'D\0docs/old.md\0M\0docs/content/en/api/page.mdx\0A\0docs/content/ko/api/page.mdx\0',
  );
  assert.equal(planValidation('pull_request', false, changes).mode, 'docs');
});

for (const path of [
  'src-tauri/src/lib.rs',
  'tests/fixtures/editor-ops.json',
  'scripts/build-tauri.js',
  '.github/workflows/ci.yml',
  'docs/runtime.json',
  'new-file',
  'docs/code.ts',
  'docs/../src/foo.md',
]) {
  test(`문서와 ${path} 혼합은 전체 검사`, () => {
    assert.equal(
      planValidation(
        'pull_request',
        false,
        parseChanges(`M\0README.md\0M\0${path}\0`),
      ).mode,
      'full',
    );
  });
}

test('수동·정기·릴리즈·merge group은 Draft 또는 문서 분류를 재사용하지 않음', () => {
  for (const event of [
    'workflow_dispatch',
    'schedule',
    'push',
    'merge_group',
  ]) {
    assert.equal(
      planValidation(event, true, parseChanges('M\0README.md\0')).mode,
      'full',
    );
  }
  assert.equal(planValidation('pull_request', true, [], true).mode, 'full');
});

test('불완전한 diff나 상태는 전체 검사', () => {
  assert.throws(() => parseChanges('M\0README.md'));
  assert.throws(() => parseChanges('R100\0README.md\0'));
  assert.throws(() => parseChanges('X\0README.md\0'));
  assert.equal(planValidation('pull_request', false, null).mode, 'full');
  assert.equal(planValidation('pull_request', false, []).mode, 'full');
  assert.equal(planValidation('pull_request', undefined, []).mode, 'full');
  assert.equal(
    planValidation('pull_request', false, parseChanges('T\0README.md\0')).mode,
    'full',
  );
});

test('실제 Git rename의 이전 코드 경로와 개행 파일명 보존', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dmnote-ci-diff-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'ci-test@example.invalid');
    git('config', 'user.name', 'CI Test');
    mkdirSync(join(cwd, 'src'));
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'src/source.ts'), 'export const answer = 42;\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    renameSync(
      join(cwd, 'src/source.ts'),
      join(cwd, 'docs/renamed\nsource.md'),
    );
    git('add', '.');
    const changes = parseChanges(
      git('diff', '--cached', '--name-status', '-z', '--find-renames'),
    );
    assert.deepEqual(changes[0].paths, [
      'src/source.ts',
      'docs/renamed\nsource.md',
    ]);
    assert.equal(planValidation('pull_request', false, changes).mode, 'full');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const success = {
  changes: 'success',
  quality: 'success',
  frontend: 'success',
  windows: 'success',
  macos: 'success',
};
test('전체 성공만 Ready 코드 gate 통과', () => {
  assert.deepEqual(gateErrors('full', success), []);
  for (const job of Object.keys(success)) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      assert.notEqual(
        gateErrors('full', { ...success, [job]: result }).length,
        0,
      );
    }
  }
  assert.notEqual(gateErrors(undefined, success).length, 0);
});

test('Draft·문서 모드는 의도된 skip만 허용하고 빠른 검사 실패는 차단', () => {
  const results = {
    ...success,
    frontend: 'skipped',
    windows: 'skipped',
    macos: 'skipped',
  };
  for (const mode of ['draft', 'docs']) {
    assert.deepEqual(gateErrors(mode, results), []);
    assert.notEqual(
      gateErrors(mode, { ...results, quality: 'failure' }).length,
      0,
    );
    assert.notEqual(
      gateErrors(mode, { ...results, windows: 'cancelled' }).length,
      0,
    );
  }
  assert.notEqual(gateErrors('full', results).length, 0);
});
