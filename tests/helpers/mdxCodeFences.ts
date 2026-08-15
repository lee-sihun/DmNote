import ts from 'typescript';
import postcss from 'postcss';

// 문서 코드 펜스 구문 검사 헬퍼
// 프래그먼트는 펜스 메타(```javascript fragment=object-members)로 표시 —
// CommonMark info string은 렌더링되지 않으므로 독자에게 노출되지 않음

export type FragmentKind =
  | 'object-members'
  | 'expression'
  | 'type-members'
  | 'signature';

export interface MdxCodeFence {
  lang: string;
  fragment: FragmentKind | null;
  code: string;
  /** 펜스 여는 줄의 1-기반 라인 번호 */
  startLine: number;
}

const FRAGMENT_KINDS: ReadonlySet<string> = new Set([
  'object-members',
  'expression',
  'type-members',
  'signature',
]);

export const extractMdxCodeFences = (content: string): MdxCodeFence[] => {
  const fences: MdxCodeFence[] = [];
  const lines = content.split('\n');

  let open: {
    lang: string;
    fragment: FragmentKind | null;
    start: number;
  } | null = null;
  let buffer: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*```(\S*)\s*(.*)$/);

    if (!open) {
      if (match) {
        const meta = match[2].trim();
        const fragmentMatch = meta.match(/(?:^|\s)fragment=(\S+)/);
        const fragment = fragmentMatch ? fragmentMatch[1] : null;
        if (fragment && !FRAGMENT_KINDS.has(fragment)) {
          throw new Error(
            `Unknown fragment kind "${fragment}" at line ${i + 1}`,
          );
        }
        open = {
          lang: match[1],
          fragment: (fragment as FragmentKind) ?? null,
          start: i + 1,
        };
        buffer = [];
      }
      continue;
    }

    // 닫는 펜스 — 언어 태그 없는 ``` 만 인정
    if (match && match[1] === '' && match[2] === '') {
      fences.push({
        lang: open.lang,
        fragment: open.fragment,
        code: buffer.join('\n'),
        startLine: open.start,
      });
      open = null;
      continue;
    }

    buffer.push(line);
  }

  if (open) {
    throw new Error(`Unclosed code fence at line ${open.start}`);
  }

  return fences;
};

// 프래그먼트를 종류별 고정 컨텍스트로 래핑 — 여러 래핑을 시도하지 않고
// 결정적으로 검사해 라벨 문장 오인(template: ...) 같은 미탐을 방지
export const wrapFragment = (kind: FragmentKind, code: string): string => {
  switch (kind) {
    case 'object-members':
      return `const __docFragment = ({\n${code}\n});`;
    case 'expression':
      return `const __docFragment = (\n${code}\n);`;
    case 'type-members':
      return `type __DocFragment = {\n${code}\n};`;
    case 'signature': {
      // dmn.plugin.defineSettings(...): R 표기를 타입 멤버로 변환해 검사
      // 제네릭 시그니처(storage.get<T>(...)) 포함
      const quoted = code.replace(
        /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(<[^>\n]*>)?\(/gm,
        '"$1"$2(',
      );
      return `type __DocSignature = {\n${quoted}\n};`;
    }
  }
};

export interface FenceCheckFailure {
  line: number;
  lang: string;
  message: string;
}

const SKIPPED_LANGS: ReadonlySet<string> = new Set(['text', 'bash', 'json']);

export const checkFence = (fence: MdxCodeFence): FenceCheckFailure | null => {
  const { lang, fragment, code, startLine } = fence;

  if (SKIPPED_LANGS.has(lang)) return null;

  if (lang === 'css') {
    try {
      postcss.parse(code);
      return null;
    } catch (error) {
      return {
        line: startLine,
        lang,
        message: `CSS parse error: ${(error as Error).message}`,
      };
    }
  }

  if (lang === 'javascript' || lang === 'typescript') {
    const source = fragment ? wrapFragment(fragment, code) : code;
    const fileName = lang === 'typescript' ? 'block.ts' : 'block.js';
    const result = ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        allowJs: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    });
    const syntactic = (result.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (syntactic.length === 0) return null;

    const first = syntactic[0];
    const detail = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    return {
      line: startLine,
      lang,
      message: `${fragment ? `[fragment=${fragment}] ` : ''}${detail}`,
    };
  }

  // 알 수 없는 언어 태그는 조용히 넘기지 않음 — 검사 사각지대 방지
  return {
    line: startLine,
    lang: lang || '(untagged)',
    message: `Unknown or missing fence language tag "${lang}". Tag it (javascript/typescript/css) or use "text".`,
  };
};
