export type ValidationMode = 'draft' | 'docs' | 'full';
export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped';

export interface Change {
  status: string;
  paths: string[];
}

export interface ValidationPlan {
  mode: ValidationMode;
  reason: string;
}

// rename 양쪽 경로와 개행이 포함된 파일명 보존
export const parseChanges = (diff: string): Change[] => {
  if (diff === '') return [];
  if (!diff.endsWith('\0')) throw new Error('잘린 Git diff');
  const fields = diff.slice(0, -1).split('\0');
  const changes: Change[] = [];
  while (fields.length > 0) {
    const status = fields.shift()!;
    if (!/^(?:[AMDUT]|[RC]\d{1,3})$/.test(status)) {
      throw new Error(`알 수 없는 Git 상태: ${status}`);
    }
    const paths = fields.splice(0, /^[RC]/.test(status) ? 2 : 1);
    if (
      paths.length !== (/^[RC]/.test(status) ? 2 : 1) ||
      paths.some((p) => !p)
    ) {
      throw new Error('누락된 Git 경로');
    }
    changes.push({ status, paths });
  }
  return changes;
};

const isDocumentation = (path: string): boolean => {
  if (path.includes('\\') || path.split('/').includes('..')) return false;
  return (
    path === 'README.md' ||
    path === 'AGENTS.md' ||
    /^docs\/.+\.md$/.test(path) ||
    /^docs\/content\/.+\.mdx$/.test(path)
  );
};

export const planValidation = (
  eventName: string,
  draft: unknown,
  changes: Change[] | null,
  forceFull = false,
): ValidationPlan => {
  if (forceFull || eventName !== 'pull_request') {
    return { mode: 'full', reason: '수동·정기·릴리즈 전체 검증' };
  }
  if (draft === true) return { mode: 'draft', reason: 'Draft PR: 빠른 검사' };
  if (draft !== false || changes === null || changes.length === 0) {
    return { mode: 'full', reason: '변경 범위 불확실: 전체 검증' };
  }
  // 파일 형식 변경·충돌은 문서 경로라도 전체 검사
  if (
    changes.every(
      ({ status, paths }) =>
        /^(?:[AMD]|[RC]\d{1,3})$/.test(status) &&
        paths.length > 0 &&
        paths.every(isDocumentation),
    )
  ) {
    return { mode: 'docs', reason: '문서 전용 PR: 문서·공유 계약 검사' };
  }
  return { mode: 'full', reason: '코드·설정·미분류 경로 변경' };
};

export const gateErrors = (
  mode: unknown,
  results: Record<string, unknown>,
): string[] => {
  if (!['draft', 'docs', 'full'].includes(String(mode))) {
    return ['검증 모드 누락 또는 오류'];
  }
  const errors: string[] = [];
  for (const job of ['changes', 'quality']) {
    if (results[job] !== 'success') errors.push(`${job}: ${results[job]}`);
  }
  for (const job of ['frontend', 'windows', 'macos']) {
    const expected = mode === 'full' ? 'success' : 'skipped';
    if (results[job] !== expected)
      errors.push(`${job}: ${results[job]} (필요: ${expected})`);
  }
  return errors;
};
