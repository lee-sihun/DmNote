import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('macOS WKWebView 측정은 macOS에서만 실행할 수 있습니다.');
}

const root = process.cwd();
const outputPath = resolve(
  root,
  'benchmarks/results/interaction-macos-wkwebview-matrix.json',
);
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const iterations = Number(process.env.DMN_WEBVIEW_MATRIX_ITERATIONS ?? 2);
const warmupIterations = Number(process.env.DMN_WEBVIEW_MATRIX_WARMUP ?? 1);
const rounds = Number(process.env.DMN_WEBVIEW_MATRIX_ROUNDS ?? 1);
const itemCount = Number(process.env.DMN_WEBVIEW_MATRIX_ITEM_COUNT ?? 500);
const burstSize = Number(process.env.DMN_WEBVIEW_MATRIX_BURST_SIZE ?? 100);
const token = `${process.pid}-${Date.now()}`;

const allScenarios = [
  { id: 'BASE-03', name: 'Dropdown', kind: 'discrete' },
  { id: 'BASE-04', name: 'NumberInput', kind: 'discrete' },
  { id: 'BASE-05', name: 'TextInput', kind: 'discrete' },
  { id: 'BASE-06', name: 'ColorInput', kind: 'discrete' },
  { id: 'BASE-07', name: 'TabSwitch', kind: 'discrete' },
  { id: 'BASE-08', name: 'FloatingPopup', kind: 'discrete' },
  { id: 'BASE-09', name: 'Modal', kind: 'discrete' },
  { id: 'BASE-11', name: 'PanelToggleButton', kind: 'discrete' },
  { id: 'GRID-05', name: '미들 버튼 팬', kind: 'continuous' },
  { id: 'GRID-06', name: '단일 리사이즈', kind: 'continuous' },
  { id: 'GRID-21', name: '방향키 이동', kind: 'keyboard' },
];
const requestedScenarioIds = new Set(
  (process.env.DMN_WEBVIEW_MATRIX_SCENARIOS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const scenarios =
  requestedScenarioIds.size === 0
    ? allScenarios
    : allScenarios.filter((scenario) => requestedScenarioIds.has(scenario.id));
if (scenarios.length === 0) {
  throw new Error('DMN_WEBVIEW_MATRIX_SCENARIOS에 유효한 ID가 없습니다.');
}

const cases = scenarios.flatMap((scenario) => {
  const strategies =
    scenario.kind === 'discrete'
      ? ['sync', 'after-paint']
      : scenario.kind === 'keyboard'
      ? ['sync', 'frame']
      : ['legacy', 'frame'];
  return strategies.flatMap((strategy) =>
    Array.from({ length: rounds }, (_, roundIndex) => ({
      ...scenario,
      strategy,
      round: roundIndex + 1,
    })),
  );
});

let resolveResults;
let rejectResults;
let settled = false;
const collected = [];
const resultsPromise = new Promise((resolvePromise, rejectPromise) => {
  resolveResults = resolvePromise;
  rejectResults = rejectPromise;
});
const finishWithError = (error) => {
  if (settled) return;
  settled = true;
  rejectResults(error);
};

let reportUrl = '';
const queryFor = (index) => {
  const benchmarkCase = cases[index];
  const query = new URLSearchParams({
    benchmark: 'webview-interactions',
    scenario: benchmarkCase.id,
    strategy: benchmarkCase.strategy,
    iterations: String(iterations),
    warmup: String(warmupIterations),
    items: String(itemCount),
    burst: String(burstSize),
    frameDriver: 'timer',
    round: String(benchmarkCase.round),
    report: reportUrl,
  });
  return `?${query.toString()}`;
};

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== `/result/${token}`) {
    response.writeHead(404).end();
    return;
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });
  request.on('end', () => {
    try {
      const result = JSON.parse(body);
      const expected = cases[collected.length];
      if (result.progress) {
        console.info(
          `[시작] ${result.benchmark} ${result.strategy}: ${result.progress}`,
        );
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ acknowledged: true }));
        return;
      }
      if (result.error) {
        throw new Error(
          `${result.benchmark}/${result.strategy}: ${result.error}`,
        );
      }
      if (
        result.benchmark !== expected.id ||
        result.strategy !== expected.strategy ||
        result.round !== expected.round
      ) {
        throw new Error(
          `측정 case 불일치: ${result.benchmark}/${result.strategy}`,
        );
      }
      collected.push(result);
      console.info(
        `[${collected.length}/${cases.length}] ${result.benchmark} ${result.strategy} ${result.round}/${rounds}`,
      );
      response.setHeader('Content-Type', 'application/json');
      if (collected.length < cases.length) {
        response.end(
          JSON.stringify({ nextSearch: queryFor(collected.length) }),
        );
        return;
      }
      response.end(JSON.stringify({ complete: true }));
      if (!settled) {
        settled = true;
        resolveResults(collected);
      }
    } catch (error) {
      response.writeHead(400).end(String(error));
      finishWithError(error);
    }
  });
});

await new Promise((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise);
  server.listen(0, '127.0.0.1', resolvePromise);
});
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('로컬 결과 수집 포트를 확인할 수 없습니다.');
}
reportUrl = `http://127.0.0.1:${address.port}/result/${token}`;

const portProbe = createServer();
await new Promise((resolvePromise, rejectPromise) => {
  portProbe.once('error', rejectPromise);
  portProbe.listen(0, '127.0.0.1', resolvePromise);
});
const portAddress = portProbe.address();
if (!portAddress || typeof portAddress === 'string') {
  throw new Error('Vite 개발 서버 포트를 확인할 수 없습니다.');
}
const devServerPort = portAddress.port;
await new Promise((resolvePromise) => portProbe.close(resolvePromise));

const temporaryRoot = await mkdtemp(join(tmpdir(), 'dmnote-wkwebview-matrix-'));
const configPath = join(temporaryRoot, 'tauri.benchmark.json');
await writeFile(
  configPath,
  JSON.stringify(
    {
      productName: 'DM NOTE Interaction Matrix',
      identifier: 'com.dmnote.desktop.interaction-matrix',
      build: { devUrl: `http://localhost:${devServerPort}` },
      app: {
        windows: [
          {
            label: 'main',
            title: 'DM Note WKWebView Interaction Matrix',
            width: 902,
            height: 620,
            resizable: false,
            maximizable: false,
            fullscreen: false,
            center: true,
            transparent: false,
            decorations: true,
            visible: true,
            backgroundColor: '#0B0B0D',
            url: `main/index.html${queryFor(0)}`,
          },
        ],
      },
    },
    null,
    2,
  ),
  'utf8',
);

console.info(
  `macOS WKWebView 매트릭스 시작: ${scenarios.length}개 상호작용, ${cases.length}개 run`,
);
const child = spawn(
  npx,
  ['tauri', 'dev', '--no-watch', '--config', configPath],
  {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      DMN_INTERACTION_WEBVIEW_BENCHMARK: '1',
      DMN_VITE_PORT: String(devServerPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.once('error', finishWithError);
child.once('exit', (code, signal) => {
  if (!settled) {
    finishWithError(
      new Error(`Tauri benchmark 조기 종료: code=${code}, signal=${signal}`),
    );
  }
});

const timeout = setTimeout(
  () => finishWithError(new Error('WKWebView 매트릭스 10분 timeout')),
  600_000,
);

let measuredCases;
try {
  measuredCases = await resultsPromise;
} finally {
  clearTimeout(timeout);
  server.close();
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const systemValue = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();
const osVersion = systemValue('/usr/bin/sw_vers', ['-productVersion']);
const cpuModel = systemValue('/usr/sbin/sysctl', [
  '-n',
  'machdep.cpu.brand_string',
]);
const memoryBytes = Number(
  systemValue('/usr/sbin/sysctl', ['-n', 'hw.memsize']),
);
const userAgent = measuredCases[0].userAgent;
if (
  measuredCases.length !== cases.length ||
  !measuredCases.every(
    (entry) =>
      entry.kind === 'browser-render-path' &&
      entry.userAgent === userAgent &&
      entry.frameDriver === 'timer-0ms' &&
      entry.iterations === iterations &&
      entry.samples?.length === iterations,
  )
) {
  throw new Error('WKWebView 매트릭스 측정 메타데이터 불일치');
}
if (!/AppleWebKit/i.test(userAgent) || /Chrome|Chromium/i.test(userAgent)) {
  throw new Error(`WKWebView user agent 검증 실패: ${userAgent}`);
}

const primaryMetricFor = (scenario) =>
  scenario.kind === 'discrete' ? 'visualDomCommitMs' : 'eventBlockingMs';
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ??
    0;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
};
const metricNames = [
  'eventBlockingMs',
  'visualDomCommitMs',
  'completionDomCommitMs',
  'clickToPaintOpportunityMs',
  'reactCommitDurationMs',
];
const aggregatedCases = scenarios.flatMap((scenario) => {
  const strategies =
    scenario.kind === 'discrete'
      ? ['sync', 'after-paint']
      : scenario.kind === 'keyboard'
      ? ['sync', 'frame']
      : ['legacy', 'frame'];
  return strategies.map((strategy) => {
    const runs = measuredCases.filter(
      (entry) => entry.benchmark === scenario.id && entry.strategy === strategy,
    );
    const samples = runs.flatMap((entry) => entry.samples);
    const aggregated = {
      ...runs[0],
      iterations: samples.length,
      rounds: runs.length,
      measuredAt: runs.at(-1).measuredAt,
    };
    delete aggregated.round;
    delete aggregated.samples;
    for (const metric of metricNames) {
      aggregated[metric] = summarize(samples.map((sample) => sample[metric]));
    }
    return aggregated;
  });
});
const comparisons = scenarios.map((scenario) => {
  const entries = aggregatedCases.filter(
    (entry) => entry.benchmark === scenario.id,
  );
  const beforeStrategy =
    scenario.kind === 'discrete'
      ? 'sync'
      : scenario.kind === 'keyboard'
      ? 'sync'
      : 'legacy';
  const afterStrategy = scenario.kind === 'discrete' ? 'after-paint' : 'frame';
  const before = entries.find((entry) => entry.strategy === beforeStrategy);
  const after = entries.find((entry) => entry.strategy === afterStrategy);
  if (!before || !after) throw new Error(`${scenario.id} 비교 case 누락`);
  const metric = primaryMetricFor(scenario);
  const beforeP95 = before[metric].p95;
  const afterP95 = after[metric].p95;
  const improvementPercent =
    beforeP95 > 0 ? ((beforeP95 - afterP95) / beforeP95) * 100 : null;
  return {
    ...scenario,
    metric,
    beforeStrategy,
    afterStrategy,
    beforeP95,
    afterP95,
    improvementPercent,
  };
});

const result = {
  schemaVersion: 1,
  benchmarkId: 'MACOS-WEBVIEW-INTERACTION-MATRIX',
  kind: 'tauri-wkwebview-render-path',
  measuredAt: new Date().toISOString(),
  commit,
  runtime: {
    engine: 'WKWebView',
    platform: process.platform,
    arch: process.arch,
    osVersion,
    cpuModel,
    memoryBytes,
    launchMode: 'tauri-dev-isolated-benchmark',
    userAgent,
  },
  scenario: {
    itemCount,
    burstSize,
    iterations: iterations * rounds,
    iterationsPerRound: iterations,
    warmupIterationsPerRound: warmupIterations,
    rounds,
  },
  frameDriver: 'timer-0ms',
  comparisons,
  cases: aggregatedCases,
  runs: measuredCases,
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const ms = (value) => value.toFixed(3);
const pct = (value) => (value === null ? '—' : `${value.toFixed(1)}%`);
const resultRows = comparisons
  .map(
    (entry) =>
      `| ${entry.id} | ${entry.name} | ${
        entry.metric === 'visualDomCommitMs'
          ? 'visual DOM P95'
          : 'event blocking P95'
      } | ${entry.beforeStrategy} ${ms(entry.beforeP95)}ms | ${
        entry.afterStrategy
      } ${ms(entry.afterP95)}ms | ${pct(entry.improvementPercent)} |`,
  )
  .join('\n');
const resultBlock = `<!-- MACOS-WEBVIEW-MATRIX:RESULT:START -->
#### macOS WKWebView 주요 비토글 상호작용 스모크 매트릭스

| 조건 | 값 |
| --- | --- |
| 실행 명령 | \`npm run benchmark:interaction:webview:matrix:macos\` |
| 실행 경로 | Tauri 격리 benchmark 모드·WKWebView·Vite dev server |
| 프레임 드라이버 | 0ms timer 기반 rAF — 무인 macOS 창의 native rAF 정지 방지 |
| 범위 | 클릭형 8개·포인터 연속 입력 2개·키보드 연속 입력 1개 |
| 부하 | 일반 DOM ${itemCount}개·연속 입력 ${burstSize}회 |
| 반복 | 각 전략 ${
  iterations * rounds
}회 (${iterations}회 × ${rounds}개 자동 재로드), 재로드당 워밍업 ${warmupIterations}회 |
| 측정 대상 커밋 | \`${commit}\` |
| 환경 | macOS ${osVersion}·${cpuModel}·${(memoryBytes / 1024 ** 3).toFixed(
  0,
)}GB |

| ID | 상호작용 | 주 지표 | 기준선 | 개선 | 개선율 |
| --- | --- | --- | ---: | ---: | ---: |
${resultRows}

- 원시 결과: [JSON](../benchmarks/results/interaction-macos-wkwebview-matrix.json)
- 정확성 게이트: WKWebView user agent·case 순서·전략 쌍·반복 수·DOM 최종 상태 자동 검증
- 수치 해석: 클릭형은 즉시 보이는 DOM 반영, 연속 입력은 event burst 차단 시간을 주 지표로 사용
- paint opportunity는 자동 실행용 프레임 드라이버 수치이므로 성능 판정에서 제외
- 전략당 2표본의 실제 엔진 스모크 검증이며 통계적 판정은 각 항목의 jsdom 30회 결과를 사용
- 제외: GRID-08·09·11·EDIT-01은 WKWebView가 무인 합성 drag를 안정적으로 처리하지 않아 기존 jsdom burst 측정을 유지
- 남은 플랫폼: Windows WebView2
<!-- MACOS-WEBVIEW-MATRIX:RESULT:END -->`;

const upsert = (source, start, end, block, before) => {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return pattern.test(source)
    ? source.replace(pattern, block)
    : source.replace(before, `${block}\n\n${before}`);
};
let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^> 상태:.*$/m,
  '> 상태: 전수 구현·감사·macOS WKWebView 주요 비토글 상호작용 검증 완료, Windows WebView2 대기',
);
tracker = upsert(
  tracker,
  '<!-- MACOS-WEBVIEW-MATRIX:RESULT:START -->',
  '<!-- MACOS-WEBVIEW-MATRIX:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
await writeFile(trackerPath, tracker, 'utf8');
const formatted = spawnSync(
  npx,
  ['prettier', '--write', 'docs/interaction-performance-tracker.md'],
  { cwd: root, stdio: 'inherit' },
);
if (formatted.status !== 0) process.exit(formatted.status ?? 1);

console.info('macOS WKWebView 상호작용 매트릭스 완료');
for (const entry of comparisons) {
  console.info(
    `${entry.id} ${entry.beforeStrategy} ${ms(entry.beforeP95)}ms → ${
      entry.afterStrategy
    } ${ms(entry.afterP95)}ms (${pct(entry.improvementPercent)})`,
  );
}
