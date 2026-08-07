import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const variants = [
  [
    'legacy',
    'legacy-baseline',
    'benchmarks/results/grid-05-middle-pan-baseline.json',
  ],
  ['frame', 'improved', 'benchmarks/results/grid-05-middle-pan-improved.json'],
];

for (const [strategy, variant, output] of variants) {
  const run = spawnSync(
    npmCommand,
    ['run', 'benchmark:interaction:grid-continuous-input:raw'],
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
        DMN_BENCHMARK_BURST_SIZE: process.env.DMN_BENCHMARK_BURST_SIZE ?? '20',
      },
      stdio: 'inherit',
    },
  );
  if (run.status !== 0) process.exit(run.status ?? 1);
}

const readResult = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const baseline = await readResult(variants[0][2]);
const improved = await readResult(variants[1][2]);
const beforeCase = baseline.cases.at(-1);
const afterCase = improved.cases.at(-1);
if (!beforeCase || !afterCase) throw new Error('GRID-05 측정 case 누락');
const improvement = (before, after) =>
  before === 0 ? null : ((before - after) / before) * 100;
const ms = (value) => value.toFixed(3);
const pct = (value) =>
  value === null
    ? '—'
    : `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;
const before = beforeCase.eventBlockingMs.p95;
const after = afterCase.eventBlockingMs.p95;
const gain = improvement(before, after);
if (gain === null || gain <= 0) {
  throw new Error(`GRID-05 event P95 미개선: ${ms(before)}ms → ${ms(after)}ms`);
}
const correctness = spawnSync(
  npxCommand,
  [
    'vitest',
    'run',
    'src/renderer/hooks/Grid/useGridZoomPan.test.tsx',
    'src/renderer/hooks/Grid/useDraggable.test.tsx',
    'src/renderer/hooks/Grid/useSelectionDrag.test.tsx',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (correctness.status !== 0) process.exit(correctness.status ?? 1);

const implementation = execFileSync(
  'git',
  [
    'log',
    '-1',
    '--format=%H',
    '--',
    'src/renderer/hooks/Grid/useGridZoomPan.ts',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
const short = implementation.slice(0, 8);
const date = improved.measuredAt.slice(0, 10);
const runtime = `${improved.runtime.kind}, ${improved.runtime.platform} ${improved.runtime.arch}, ${improved.runtime.node}`;
const resultBlock = `<!-- GRID-05:RESULT:START -->
#### GRID-05 미들 버튼 팬 연속 입력 최신 자동 측정

| 조건 | 값 |
| --- | --- |
| 측정 경로 | 실제 useGridZoomPan + 렌더 DOM ${
  beforeCase.itemCount
}개, mousemove ${beforeCase.burstSize}회 burst |
| 반복 | 기준선 ${beforeCase.iterations}회 / 개선 ${
  afterCase.iterations
}회, 워밍업 각 ${beforeCase.warmupIterations}회 |
| 구현 코드 커밋 | \`${implementation}\` |
| 측정 코드 커밋 | \`${improved.commit}\` |
| 비교 전략 | \`${baseline.strategy}\` → \`${improved.strategy}\` |
| 환경 | ${improved.runtime.platform} ${improved.runtime.arch}, ${
  improved.runtime.node
} |

| P95 지표 | legacy | frame coalescing | 개선율 |
| --- | ---: | ---: | ---: |
| burst event blocking | ${ms(before)}ms | ${ms(after)}ms | ${pct(gain)} |
| 최종 DOM commit | ${ms(beforeCase.visualDomCommitMs.p95)}ms | ${ms(
  afterCase.visualDomCommitMs.p95,
)}ms | ${pct(
  improvement(
    beforeCase.visualDomCommitMs.p95,
    afterCase.visualDomCommitMs.p95,
  ),
)} |
| React commit duration | ${ms(beforeCase.reactCommitDurationMs.p95)}ms | ${ms(
  afterCase.reactCommitDurationMs.p95,
)}ms | ${pct(
  improvement(
    beforeCase.reactCommitDurationMs.p95,
    afterCase.reactCommitDurationMs.p95,
  ),
)} |

- 원시 결과: [기준선](../${variants[0][2]}) · [개선](../${variants[1][2]})
- 정확성 게이트: wheel delta 누적·미들 팬 최신 좌표·드래그 프레임 병합 테스트 통과
<!-- GRID-05:RESULT:END -->`;
const session = (id, stage, result, data, output) =>
  `| ${id} | ${date} | GRID-05 | ${stage} | \`${result.commit.slice(
    0,
    8,
  )}\` | ${runtime} | DOM ${data.itemCount}개·mousemove ${data.burstSize}회 | ${
    data.iterations
  } | ${ms(data.eventBlockingMs.p50)} | ${ms(data.eventBlockingMs.p95)} | ${ms(
    data.eventBlockingMs.max,
  )} | DOM P95 ${ms(data.visualDomCommitMs.p95)}ms·React P95 ${ms(
    data.reactCommitDurationMs.p95,
  )}ms | [JSON](../${output}) | pointer burst proxy |`;
const sessionsBlock = `<!-- GRID-05:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${session('GRID-05-LEGACY', '기준선', baseline, beforeCase, variants[0][2])}
${session('GRID-05-FRAME', '개선', improved, afterCase, variants[1][2])}
<!-- GRID-05:SESSIONS:END -->`;
const experimentBlock = `<!-- GRID-05:EXPERIMENT:START -->
### EXP-016: Grid 연속 이동 입력 프레임 병합

| 필드 | 내용 |
| --- | --- |
| 항목 ID | GRID-03~05 |
| 변경 내용 | 휠·트랙패드 delta를 누적하고 미들 팬 최신 좌표를 프레임당 한 번 Store에 반영 |
| 구현 커밋 | \`${short}\` |
| P95 변화 | ${ms(before)}ms → ${ms(after)}ms (${pct(gain)}) |
| 정확성 검증 | 입력 손실 없는 delta 누적·mouseup flush·기존 단일·다중 드래그 병합 테스트 통과 |
| 결론 | jsdom burst proxy 검증, 실제 WebView F95 측정 전까지 검증 상태 유지 |
<!-- GRID-05:EXPERIMENT:END -->`;

let tracker = await readFile(trackerPath, 'utf8');
const rows = [
  ['GRID-03', 'Grid 패닝'],
  ['GRID-04', '휠·핀치 줌'],
  ['GRID-05', '미들 버튼 팬'],
];
for (const [id, label] of rows) {
  tracker = tracker.replace(
    new RegExp(`^\\| ${id}\\s+\\|.*$`, 'm'),
    `| ${id} | ${label} | P0 | F95 ms/frame | ${
      id === 'GRID-05' ? ms(before) : '—'
    } | ${id === 'GRID-05' ? ms(after) : '—'} | ${
      id === 'GRID-05' ? pct(gain) : '—'
    } | ${
      id === 'GRID-05' ? '검증' : '실험'
    } | \`${short}\`, frame coalescing 적용 |`,
  );
}
const upsert = (start, end, block, beforeText) => {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return pattern.test(tracker)
    ? tracker.replace(pattern, block)
    : tracker.replace(beforeText, `${block}\n\n${beforeText}`);
};
tracker = upsert(
  '<!-- GRID-05:RESULT:START -->',
  '<!-- GRID-05:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = upsert(
  '<!-- GRID-05:SESSIONS:START -->',
  '<!-- GRID-05:SESSIONS:END -->',
  sessionsBlock,
  '### 6.1 실제 브라우저 세션',
);
tracker = upsert(
  '<!-- GRID-05:EXPERIMENT:START -->',
  '<!-- GRID-05:EXPERIMENT:END -->',
  experimentBlock,
  '## 8. 완료 게이트',
);
const trackingStart = tracker.indexOf('## 5. 전수 성능 추적표');
const trackingEnd = tracker.indexOf('## 6. 측정 세션');
const summaryStart = tracker.indexOf('## 4. 핵심 현황');
const trackingRows = tracker.slice(trackingStart, trackingEnd);
const pending = (trackingRows.match(/\| 대기 \|/g) ?? []).length;
const validating = (trackingRows.match(/\| (?:실험|검증) \|/g) ?? []).length;
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
  `GRID-05 event P95: ${ms(before)}ms → ${ms(after)}ms (${pct(gain)})`,
);
