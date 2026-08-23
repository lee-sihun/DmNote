import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const TOKENS = readSource('src/renderer/styles/tokens.css');

const tokenValue = (name: string): number => {
  const match = TOKENS.match(new RegExp(`--${name}:\\s*(-?\\d+);`));
  if (!match) throw new Error(`토큰 없음: --${name}`);
  return Number(match[1]);
};

// 캔버스 값은 인라인 style의 var()로 들어가므로 토큰이 사라지면 z-index가 조용히
// auto로 떨어진다. 값이 아니라 존재와 순서를 계약으로 삼는다
const CANVAS_TOKENS = [
  'z-canvas-counter-preview',
  'z-canvas-selection-outline',
  'z-canvas-selection-handle',
  'z-canvas-group-outline',
  'z-canvas-group-handle',
  'z-canvas-gradient-editor',
  'z-canvas-drag-preview',
  'z-canvas-marquee',
  'z-canvas-smart-guides',
];

const CHROME_LADDER = [
  'z-chrome-panel',
  'z-chrome-popup',
  'z-chrome-modal',
  'z-chrome-submenu',
  'z-chrome-tooltip',
];

const SOURCE_PATTERN = /\.(tsx?|css|html)$/;
const TEST_PATTERN = /\.test\.tsx?$/;

const collectSources = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(resolve(process.cwd(), dir))) {
    const path = join(dir, entry);
    if (statSync(resolve(process.cwd(), path)).isDirectory()) {
      if (entry !== '__tests__') collectSources(path, found);
    } else if (SOURCE_PATTERN.test(entry) && !TEST_PATTERN.test(entry)) {
      found.push(path);
    }
  }
  return found;
};

// 주석 속 설명문의 z-40까지 위반으로 세면 문서를 못 쓴다
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// 크롬 사다리 구간(30~99). 표기 형태와 무관하게 잡는다 - Tailwind 클래스,
// 객체 리터럴, style 대입, setProperty, CSS 선언이 전부 같은 회귀다
const LADDER = '(?:3[0-9]|[4-9][0-9])';
const LADDER_LITERALS = [
  new RegExp(`\\bz-\\[?${LADDER}\\]?(?![0-9])`),
  new RegExp(`\\bzIndex\\s*[:=]\\s*['"\`]?${LADDER}['"\`]?(?![0-9])`),
  new RegExp(`z-index['"]?\\s*[:,]\\s*['"]?${LADDER}(?![0-9])`),
];

describe('z-index 층 계약', () => {
  it('그리드 컨테이너가 캔버스 스택을 격리한다', () => {
    const gridSource = readSource(
      'src/renderer/components/main/Grid/core/Grid.tsx',
    );
    const container = gridSource.slice(
      gridSource.indexOf('data-grid-container'),
    );
    // className 속성만 본다 - 태그 끝을 문자로 찾으면 화살표 함수의 >에 걸린다
    const className = container.match(/className="([^"]*)"/)?.[1] ?? '';

    expect(className.split(/\s+/)).toContain('isolate');
  });

  it('크롬 사다리는 아래에서 위로 순서를 지킨다', () => {
    const values = CHROME_LADDER.map(tokenValue);

    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it('캔버스 토큰이 모두 살아 있고 서로 순서를 지킨다', () => {
    const values = CANVAS_TOKENS.map(tokenValue);

    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  // 컴포넌트 안에서만 겨루는 작은 값(z-10 등)은 계약 밖이다.
  // 사다리 구간을 맨숫자로 쓰면 tokens.css가 단일 소스가 아니게 된다
  it('크롬 사다리 구간을 맨숫자로 쓰지 않는다', () => {
    const offenders = collectSources('src/renderer').filter((path) => {
      const source = stripComments(readSource(path));
      return LADDER_LITERALS.some((pattern) => pattern.test(source));
    });

    expect(offenders).toEqual([]);
  });

  // 위 검사가 스스로 새지 않는지 - 표기만 바꾼 우회를 실제로 잡는지 고정한다.
  // 실제 검사와 같은 파이프라인(주석 제거 포함)을 태운다
  it('맨숫자 검사가 표기 우회를 놓치지 않는다', () => {
    const caught = (source: string) =>
      LADDER_LITERALS.some((pattern) => pattern.test(stripComments(source)));

    expect(caught('className="z-40"')).toBe(true);
    expect(caught('className="z-[45]"')).toBe(true);
    expect(caught('style={{ zIndex: 50 }}')).toBe(true);
    expect(caught("el.style.zIndex = '60';")).toBe(true);
    expect(caught("el.style.setProperty('z-index', '55');")).toBe(true);
    expect(caught('.surface { z-index: 45; }')).toBe(true);

    expect(caught('className="z-[var(--z-chrome-modal)]"')).toBe(false);
    expect(caught("zIndex: 'var(--z-canvas-marquee)'")).toBe(false);
    expect(caught('className="z-10"')).toBe(false);
    expect(caught('zIndex: 1000')).toBe(false);
    expect(caught('--z-chrome-panel: 30;')).toBe(false);

    // 주석은 설명문이라 위반이 아니다 - 제거가 실제로 걸리는지 확인
    expect(caught('// 사이드 패널(z-30) 위에 둔다')).toBe(false);
    expect(caught('/* 팝업은 z-40 */')).toBe(false);
    expect(caught('const a = 1; // z-40\nclassName="z-40"')).toBe(true);
  });
});
