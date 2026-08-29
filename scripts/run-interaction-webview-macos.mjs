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
  'benchmarks/results/pilot-macos-wkwebview.json',
);
const trackerPath = resolve(root, 'docs/interaction-performance-tracker.md');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const iterations = Number(process.env.DMN_WEBVIEW_ITERATIONS ?? 40);
const warmupIterations = Number(process.env.DMN_WEBVIEW_WARMUP ?? 5);
const elementCount = Number(process.env.DMN_WEBVIEW_ELEMENT_COUNT ?? 500);
const token = `${process.pid}-${Date.now()}`;
const cases = [
  { selectionMode: 'single', enabledCommitStrategy: 'sync' },
  { selectionMode: 'single', enabledCommitStrategy: 'after-paint' },
  { selectionMode: 'batch', enabledCommitStrategy: 'sync' },
  { selectionMode: 'batch', enabledCommitStrategy: 'after-paint' },
];

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
    benchmark: 'shadow-toggle',
    selection: benchmarkCase.selectionMode,
    strategy: benchmarkCase.enabledCommitStrategy,
    iterations: String(iterations),
    warmup: String(warmupIterations),
    elements: String(elementCount),
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
      if (
        result.selectionMode !== expected.selectionMode ||
        result.enabledCommitStrategy !== expected.enabledCommitStrategy
      ) {
        throw new Error(
          `측정 case 불일치: ${result.selectionMode}/${result.enabledCommitStrategy}`,
        );
      }
      collected.push(result);
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

const devPortProbe = createServer();
await new Promise((resolvePromise, rejectPromise) => {
  devPortProbe.once('error', rejectPromise);
  devPortProbe.listen(0, '127.0.0.1', resolvePromise);
});
const devAddress = devPortProbe.address();
if (!devAddress || typeof devAddress === 'string') {
  throw new Error('Vite 개발 서버 포트를 확인할 수 없습니다.');
}
const devServerPort = devAddress.port;
await new Promise((resolvePromise) => devPortProbe.close(resolvePromise));

const temporaryRoot = await mkdtemp(
  join(tmpdir(), 'dmnote-wkwebview-benchmark-'),
);
const configPath = join(temporaryRoot, 'tauri.benchmark.json');
const initialQuery = queryFor(0);
await writeFile(
  configPath,
  JSON.stringify(
    {
      productName: 'DM NOTE Benchmark',
      identifier: 'com.dmnote.desktop.interaction-benchmark',
      build: {
        devUrl: `http://localhost:${devServerPort}`,
      },
      app: {
        windows: [
          {
            label: 'main',
            create: false,
            title: 'DM Note WKWebView Benchmark',
            width: 902,
            height: 488,
            resizable: false,
            maximizable: false,
            fullscreen: false,
            center: true,
            transparent: false,
            decorations: true,
            visible: true,
            backgroundColor: '#0B0B0D',
            url: `main/index.html${initialQuery}`,
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
  `macOS WKWebView 측정 시작: ${cases.length}개 case, DOM ${elementCount}개, ${iterations}회`,
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
  () => finishWithError(new Error('WKWebView 측정 240초 timeout')),
  240_000,
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
  !measuredCases.every(
    (result) =>
      result.kind === 'browser-render-path' &&
      result.userAgent === userAgent &&
      result.iterations === iterations &&
      result.elementCount === elementCount,
  )
) {
  throw new Error('WKWebView 측정 메타데이터 불일치');
}
if (!/AppleWebKit/i.test(userAgent) || /Chrome|Chromium/i.test(userAgent)) {
  throw new Error(`WKWebView user agent 검증 실패: ${userAgent}`);
}

const result = {
  schemaVersion: 1,
  benchmarkId: 'MACOS-WEBVIEW-PILOT',
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
  scenario: { elementCount, iterations, warmupIterations },
  cases: measuredCases,
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const findCase = (selectionMode, enabledCommitStrategy) =>
  measuredCases.find(
    (entry) =>
      entry.selectionMode === selectionMode &&
      entry.enabledCommitStrategy === enabledCommitStrategy,
  );
const singleBefore = findCase('single', 'sync');
const singleAfter = findCase('single', 'after-paint');
const batchBefore = findCase('batch', 'sync');
const batchAfter = findCase('batch', 'after-paint');
const improvement = (before, after) => ((before - after) / before) * 100;
const singleRate = improvement(
  singleBefore.visualDomCommitMs.p95,
  singleAfter.visualDomCommitMs.p95,
);
const batchRate = improvement(
  batchBefore.visualDomCommitMs.p95,
  batchAfter.visualDomCommitMs.p95,
);
if (singleRate <= 0 || batchRate <= 0) {
  throw new Error(
    `WKWebView 회귀: single ${singleRate.toFixed(
      1,
    )}%, batch ${batchRate.toFixed(1)}%`,
  );
}

const ms = (value) => value.toFixed(3);
const pct = (value) => `${value.toFixed(1)}%`;
const date = result.measuredAt.slice(0, 10);
const shortCommit = commit.slice(0, 8);
const outputRelative = 'benchmarks/results/pilot-macos-wkwebview.json';
const resultBlock = `<!-- MACOS-WEBVIEW:RESULT:START -->
#### macOS WKWebView 실제 렌더 경로 자동 측정

| 조건 | 값 |
| --- | --- |
| 실행 명령 | \`npm run benchmark:interaction:webview:macos\` |
| 실행 경로 | Tauri 격리 benchmark 모드·WKWebView·Vite dev server |
| 시나리오 | 단일·다중 선택 그림자 토글, DOM ${elementCount}개 |
| 반복 | 각 case ${iterations}회, 워밍업 ${warmupIterations}회 |
| 측정 대상 커밋 | \`${commit}\` |
| 환경 | macOS ${osVersion}·${cpuModel}·${(memoryBytes / 1024 ** 3).toFixed(
  0,
)}GB |
| 엔진 | ${userAgent.replaceAll('|', '\\|')} |

| 선택 | P95 지표 | sync | after-paint | 개선율 |
| --- | --- | ---: | ---: | ---: |
| 단일 | visual DOM commit | ${ms(singleBefore.visualDomCommitMs.p95)}ms | ${ms(
  singleAfter.visualDomCommitMs.p95,
)}ms | ${pct(singleRate)} |
| 단일 | paint opportunity | ${ms(
  singleBefore.clickToPaintOpportunityMs.p95,
)}ms | ${ms(singleAfter.clickToPaintOpportunityMs.p95)}ms | ${pct(
  improvement(
    singleBefore.clickToPaintOpportunityMs.p95,
    singleAfter.clickToPaintOpportunityMs.p95,
  ),
)} |
| 다중 | visual DOM commit | ${ms(batchBefore.visualDomCommitMs.p95)}ms | ${ms(
  batchAfter.visualDomCommitMs.p95,
)}ms | ${pct(batchRate)} |
| 다중 | paint opportunity | ${ms(
  batchBefore.clickToPaintOpportunityMs.p95,
)}ms | ${ms(batchAfter.clickToPaintOpportunityMs.p95)}ms | ${pct(
  improvement(
    batchBefore.clickToPaintOpportunityMs.p95,
    batchAfter.clickToPaintOpportunityMs.p95,
  ),
)} |

- 원시 결과: [JSON](../${outputRelative})
- 게이트: WKWebView user agent·case 순서·반복 수·단일/다중 visual P95 개선 자동 검증
- 남은 플랫폼: Windows WebView2
<!-- MACOS-WEBVIEW:RESULT:END -->`;

const sessionRow = (id, stage, entry) =>
  `| ${id} | ${date} | ${
    entry.selectionMode === 'single' ? 'PILOT-01' : 'PILOT-02'
  } | ${stage} | \`${shortCommit}\` | Tauri WKWebView, macOS ${osVersion}, ${cpuModel} | ${
    entry.selectionMode === 'single' ? '단일' : '다중'
  } 선택·DOM ${elementCount}개 | ${iterations} | ${ms(
    entry.visualDomCommitMs.p50,
  )} | ${ms(entry.visualDomCommitMs.p95)} | ${ms(
    entry.visualDomCommitMs.max,
  )} | paint P95 ${ms(entry.clickToPaintOpportunityMs.p95)}ms·React P95 ${ms(
    entry.reactCommitDurationMs.p95,
  )}ms | [JSON](../${outputRelative}) | 실제 WKWebView 렌더 경로 |`;
const sessionsBlock = `<!-- MACOS-WEBVIEW:SESSIONS:START -->
| 세션 ID | 날짜 | 항목 ID | 단계 | 빌드·커밋 | 환경 | 시나리오·데이터 크기 | 반복 | P50 | P95 | 최대 | 보조 지표 | 원시 자료 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${sessionRow('PILOT-01-WK-SYNC', '기준선', singleBefore)}
${sessionRow('PILOT-01-WK-PAINT', '개선', singleAfter)}
${sessionRow('PILOT-02-WK-SYNC', '기준선', batchBefore)}
${sessionRow('PILOT-02-WK-PAINT', '개선', batchAfter)}
<!-- MACOS-WEBVIEW:SESSIONS:END -->`;

const upsert = (source, start, end, block, before) => {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return pattern.test(source)
    ? source.replace(pattern, block)
    : source.replace(before, `${block}\n\n${before}`);
};
let tracker = await readFile(trackerPath, 'utf8');
tracker = tracker.replace(
  /^> 상태:.*$/m,
  '> 상태: 전수 구현·감사·macOS WKWebView 파일럿 검증 완료, Windows WebView2 대기',
);
tracker = upsert(
  tracker,
  '<!-- MACOS-WEBVIEW:RESULT:START -->',
  '<!-- MACOS-WEBVIEW:RESULT:END -->',
  resultBlock,
  '### 5.1 파일럿·공통 기반',
);
tracker = upsert(
  tracker,
  '<!-- MACOS-WEBVIEW:SESSIONS:START -->',
  '<!-- MACOS-WEBVIEW:SESSIONS:END -->',
  sessionsBlock,
  '<!-- PILOT-02:SESSIONS:START -->',
);
tracker = tracker
  .replace(/^\| PILOT-01\s+\|.*$/m, (line) =>
    line.replace(
      /\| 검증 \|.*\|$/,
      `| 검증 | macOS WKWebView ${ms(
        singleBefore.visualDomCommitMs.p95,
      )}ms → ${ms(singleAfter.visualDomCommitMs.p95)}ms (${pct(
        singleRate,
      )}), Windows 대기 |`,
    ),
  )
  .replace(/^\| PILOT-02\s+\|.*$/m, (line) =>
    line.replace(
      /\| 검증 \|.*\|$/,
      `| 검증 | macOS WKWebView ${ms(
        batchBefore.visualDomCommitMs.p95,
      )}ms → ${ms(batchAfter.visualDomCommitMs.p95)}ms (${pct(
        batchRate,
      )}), Windows 대기 |`,
    ),
  );
await writeFile(trackerPath, tracker, 'utf8');
const formatted = spawnSync(
  npx,
  ['prettier', '--write', 'docs/interaction-performance-tracker.md'],
  { cwd: root, stdio: 'inherit' },
);
if (formatted.status !== 0) process.exit(formatted.status ?? 1);

console.info(
  `WKWebView visual P95 single ${ms(
    singleBefore.visualDomCommitMs.p95,
  )}ms → ${ms(singleAfter.visualDomCommitMs.p95)}ms (${pct(singleRate)})`,
);
console.info(
  `WKWebView visual P95 batch ${ms(batchBefore.visualDomCommitMs.p95)}ms → ${ms(
    batchAfter.visualDomCommitMs.p95,
  )}ms (${pct(batchRate)})`,
);
