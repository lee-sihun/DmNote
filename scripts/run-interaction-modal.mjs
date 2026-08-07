import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const variants = [
  ['sync', 'sync-baseline', 'benchmarks/results/base-09-modal-baseline.json'],
  ['after-paint', 'improved', 'benchmarks/results/base-09-modal-improved.json'],
];

for (const [strategy, variant, output] of variants) {
  const result = spawnSync(
    npmCommand,
    ['run', 'benchmark:interaction:modal:raw'],
    {
      cwd: root,
      env: {
        ...process.env,
        DMN_BENCHMARK_OUTPUT: output,
        DMN_BENCHMARK_VARIANT: variant,
        DMN_BENCHMARK_STRATEGY: strategy,
        DMN_BENCHMARK_ITEM_COUNTS:
          process.env.DMN_BENCHMARK_ITEM_COUNTS ?? '1,100,500',
        DMN_BENCHMARK_ITERATIONS: process.env.DMN_BENCHMARK_ITERATIONS ?? '30',
        DMN_BENCHMARK_WARMUP: process.env.DMN_BENCHMARK_WARMUP ?? '5',
      },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const readResult = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const baseline = await readResult(variants[0][2]);
const improved = await readResult(variants[1][2]);
const baselineCase = baseline.cases.at(-1);
const improvedCase = improved.cases.at(-1);
if (!baselineCase || !improvedCase) throw new Error('BASE-09 측정 case 누락');

const improvement = (before, after) =>
  before === 0 ? null : ((before - after) / before) * 100;
const ms = (value) => value.toFixed(3);
const percent = (value) =>
  value === null
    ? '—'
    : `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;
const visualBefore = baselineCase.visualDomCommitMs.p95;
const visualAfter = improvedCase.visualDomCommitMs.p95;
const visualImprovement = improvement(visualBefore, visualAfter);
if (visualImprovement === null || visualImprovement <= 0) {
  throw new Error(
    `BASE-09 dialog shell P95 미개선: ${ms(visualBefore)}ms → ${ms(
      visualAfter,
    )}ms`,
  );
}

const correctness = spawnSync(
  npxCommand,
  ['vitest', 'run', 'src/renderer/components/main/Modal/Modal.test.tsx'],
  { cwd: root, stdio: 'inherit' },
);
if (correctness.status !== 0) process.exit(correctness.status ?? 1);

const implementationCommit = execFileSync(
  'git',
  [
    'log',
    '-1',
    '--format=%H',
    '--',
    'src/renderer/components/main/Modal/Modal.tsx',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
const short = implementationCommit.slice(0, 8);
const date = improved.measuredAt.slice(0, 10);
const runtime = `${improved.runtime.kind}, ${improved.runtime.platform} ${improved.runtime.arch}, ${improved.runtime.node}`;
const contentBefore = baselineCase.contentDomCommitMs.p95;
const contentAfter = improvedCase.contentDomCommitMs.p95;
const resultBlock = `<!-- BASE-09:RESULT:START -->
#### BASE-09 Modal 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 공통 Modal + 본문 DOM ${baselineCase.itemCount}개 mount proxy |
| 반복 | 기준선 ${baselineCase.iterations}회 / 개선 ${
  improvedCase.iterations
}회, 워밍업 각 ${baselineCase.warmupIterations}회 |
| 구현 코드 커밋 | \`${implementationCommit}\` |
| 측정 코드 커밋 | \`${improved.commit}\` |
| 비교 전략 | \`${baseline.commitStrategy}\` → \`${improved.commitStrategy}\` |
| 환경 | ${improved.runtime.platform} ${improved.runtime.arch}, ${
  improved.runtime.node
} |

| P95 지표 | sync 기준선 | after-paint | 개선율 |
| --- | ---: | ---: | ---: |
| opener·dialog shell DOM commit | ${ms(visualBefore)}ms | ${ms(
  visualAfter,
)}ms | ${percent(visualImprovement)} |
| modal content mount | ${ms(contentBefore)}ms | ${ms(
  contentAfter,
)}ms | ${percent(improvement(contentBefore, contentAfter))} |
| React commit duration | ${ms(
  baselineCase.reactCommitDurationMs.p95,
)}ms | ${ms(improvedCase.reactCommitDurationMs.p95)}ms | ${percent(
  improvement(
    baselineCase.reactCommitDurationMs.p95,
    improvedCase.reactCommitDurationMs.p95,
  ),
)} |

- 원시 결과: [기준선](../${variants[0][2]}) · [개선](../${variants[1][2]})
- 정확성 게이트: Modal 포커스·복원·키보드·중첩 popup 계약 테스트 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-09:RESULT:END -->`;

const row = (id, stage, result, resultCase, output) =>
  `| ${id} | ${date} | BASE-09 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtime} | 본문 DOM ${resultCase.itemCount}개 | ${
    resultCase.iterations
  } | ${ms(resultCase.visualDomCommitMs.p50)} | ${ms(
    resultCase.visualDomCommitMs.p95,
  )} | ${ms(resultCase.visualDomCommitMs.max)} | content P95 ${ms(
    resultCase.contentDomCommitMs.p95,
  )}ms·event P95 ${ms(
    resultCase.eventBlockingMs.p95,
  )}ms | [JSON](../${output}) | DOM commit proxy |`;
const sessionsBlock = `<!-- BASE-09:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${row('BASE-09-SYNC', '기준선', baseline, baselineCase, variants[0][2])}
${row('BASE-09-PAINT', '개선', improved, improvedCase, variants[1][2])}
<!-- BASE-09:SESSIONS:END -->`;
const experimentBlock = `<!-- BASE-09:EXPERIMENT:START -->
### EXP-015: 공통 모달 콘텐츠 표시 분리

| 필드 | 내용 |
| --- | --- |
| 항목 ID | BASE-09 |
| 적용 범위 | 공통 Modal을 사용하는 설정·편집·확인 표면 9곳 |
| 변경 내용 | dialog backdrop·shell을 먼저 반영하고 무거운 children mount를 첫 paint 뒤 실행 |
| 적용 기법 | 시각 피드백 분리·지연 mount·예약 취소·초기 포커스 인계 |
| 구현 커밋 | \`${short}\` |
| P95 변화 | ${ms(visualBefore)}ms → ${ms(visualAfter)}ms (${percent(
  visualImprovement,
)}) |
| 정확성 검증 | sync 호환·첫 항목 포커스·포커스 복원·Tab·Escape·중첩 popup 계약 테스트 통과 |
| 결론 | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지 |
<!-- BASE-09:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^\| BASE-09\s+\|.*$/m,
  `| BASE-09 | Modal | 기반 | DOM P95 ms | ${ms(visualBefore)} | ${ms(
    visualAfter,
  )} | ${percent(visualImprovement)} | 검증 | [기준선](../${
    variants[0][2]
  }) · [개선](../${variants[1][2]}) |`,
);
const affected = [
  ['GRID-14', '더블클릭 편집', 'P1/P3'],
  ['TOOL-11', '노트 트랙 설정 열기', 'P3'],
  ['MODAL-08', 'Alert·Confirm·Custom Dialog', '기반/P3'],
];
for (const [id, label, priority] of affected) {
  tracker = tracker.replace(
    new RegExp(`^\\| ${id}\\s+\\|.*$`, 'm'),
    `| ${id} | ${label} | ${priority} | CTP ms | — | — | — | 실험 | \`${short}\`, 공통 dialog shell 우선 표시 적용 |`,
  );
}
const upsert = (start, end, block, before) => {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return pattern.test(tracker)
    ? tracker.replace(pattern, block)
    : tracker.replace(before, `${block}\n\n${before}`);
};
tracker = upsert(
  '<!-- BASE-09:RESULT:START -->',
  '<!-- BASE-09:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = upsert(
  '<!-- BASE-09:SESSIONS:START -->',
  '<!-- BASE-09:SESSIONS:END -->',
  sessionsBlock,
  '### 6.1 실제 브라우저 세션',
);
tracker = upsert(
  '<!-- BASE-09:EXPERIMENT:START -->',
  '<!-- BASE-09:EXPERIMENT:END -->',
  experimentBlock,
  '## 8. 완료 게이트',
);
const trackingStart = tracker.indexOf('## 5. 전수 성능 추적표');
const trackingEnd = tracker.indexOf('## 6. 측정 세션');
const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const rows = tracker.slice(trackingStart, trackingEnd);
const pending = (rows.match(/\| 대기 \|/g) ?? []).length;
const validating = (rows.match(/\| (?:실험|검증) \|/g) ?? []).length;
const summary = tracker
  .slice(summaryStart, trackingStart)
  .replace(/^\| 대기\s+\|.*$/m, `| 대기 | ${pending}개 |`)
  .replace(/^\| 실험·검증 중\s+\|.*$/m, `| 실험·검증 중 | ${validating}개 |`);
tracker = `${tracker.slice(0, summaryStart)}${summary}${tracker.slice(
  trackingStart,
)}`;
await writeFile(trackerPath, tracker, 'utf8');
const formatted = spawnSync(npxCommand, ['prettier', '--write', trackerPath], {
  cwd: root,
  stdio: 'inherit',
});
if (formatted.status !== 0) process.exit(formatted.status ?? 1);
console.info(
  `BASE-09 dialog shell DOM commit P95: ${ms(visualBefore)}ms → ${ms(
    visualAfter,
  )}ms (${percent(visualImprovement)})`,
);
