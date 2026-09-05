import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { gateErrors, parseChanges, planValidation } from './policy.ts';

const append = (variable: string, value: string) => {
  const path = process.env[variable];
  if (path) appendFileSync(path, value);
};

if (process.argv[2] === 'plan') {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'),
  );
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const ref = process.env.VALIDATION_REF ?? '';
  if (ref && !/^[a-f0-9]{40}$/.test(ref))
    throw new Error('검증 ref는 commit SHA여야 함');
  let changes = null;
  if (eventName === 'pull_request' && !ref) {
    try {
      const { base, head } = event.pull_request;
      if (![base.sha, head.sha].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
        throw new Error('PR SHA 누락');
      }
      const diff = execFileSync(
        'git',
        [
          'diff',
          '--name-status',
          '-z',
          '--find-renames',
          `${base.sha}...${head.sha}`,
          '--',
        ],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      );
      changes = parseChanges(diff);
    } catch {
      process.stdout.write('변경 목록 조회 실패: 전체 검사로 전환\n');
    }
  }
  const plan = planValidation(
    eventName,
    event.pull_request?.draft,
    changes,
    Boolean(ref),
  );
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (ref && sha !== ref) throw new Error('요청한 검증 SHA와 checkout 불일치');
  append('GITHUB_OUTPUT', `mode=${plan.mode}\nsha=${sha}\n`);
  append(
    'GITHUB_STEP_SUMMARY',
    `### 검증 범위\n\n- 모드: ${plan.mode}\n- 사유: ${plan.reason}\n- SHA: \`${sha}\`\n`,
  );
} else if (process.argv[2] === 'gate') {
  const needs = JSON.parse(process.env.CI_NEEDS ?? '{}');
  const results = Object.fromEntries(
    Object.entries(needs).map(([job, value]) => [
      job,
      (value as { result?: string }).result,
    ]),
  );
  const errors = gateErrors(needs.changes?.outputs?.mode, results);
  append(
    'GITHUB_STEP_SUMMARY',
    `### 검사 결과\n\n${Object.entries(results)
      .map(([job, result]) => `- ${job}: ${result}`)
      .join('\n')}\n`,
  );
  if (errors.length) throw new Error(errors.join('\n'));
} else {
  throw new Error('사용법: runPolicy.ts plan|gate');
}
