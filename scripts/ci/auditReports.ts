import { appendFileSync, readFileSync } from 'node:fs';

const npm = JSON.parse(readFileSync('npm-audit.json', 'utf8'));
const cargo = JSON.parse(readFileSync('cargo-audit.json', 'utf8'));
// 취약점 기준선과 조회·실행 오류 구분
if (npm.error || typeof npm.metadata?.vulnerabilities?.total !== 'number') {
  throw new Error('npm audit 보고서 조회 실패: 단계 로그 확인 필요');
}
if (
  typeof cargo.vulnerabilities?.found !== 'boolean' ||
  !Array.isArray(cargo.vulnerabilities?.list)
) {
  throw new Error('cargo audit 보고서 조회 실패: 단계 로그 확인 필요');
}
const summary = `### 의존성 기준선\n\n- npm 취약점: ${npm.metadata.vulnerabilities.total}\n- Cargo 취약점: ${cargo.vulnerabilities.list.length}\n- 취약점은 초기 비차단 보고이며 상세 내용은 artifact에서 확인\n`;
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
