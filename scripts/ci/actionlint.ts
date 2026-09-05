import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = '1.7.12';
const checksums: Record<string, string> = {
  'linux-x64':
    '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'darwin-arm64':
    'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
};

const main = async () => {
  const checksum = checksums[`${process.platform}-${process.arch}`];
  if (!checksum)
    throw new Error('actionlint는 Linux x64 또는 macOS arm64에서 실행');
  const platform =
    process.platform === 'darwin' ? 'darwin_arm64' : 'linux_amd64';
  const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_${platform}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`actionlint 다운로드 실패: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== checksum) {
    throw new Error('actionlint checksum 불일치');
  }
  const directory = mkdtempSync(join(tmpdir(), 'dmnote-actionlint-'));
  try {
    const file = join(directory, 'actionlint.tar.gz');
    writeFileSync(file, archive);
    execFileSync('tar', ['-xzf', file, '-C', directory, 'actionlint']);
    // ShellCheck는 별도 도구로 분리, runner 설치 상태와 무관한 actionlint 판정
    execFileSync(join(directory, 'actionlint'), ['-color', '-shellcheck='], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
