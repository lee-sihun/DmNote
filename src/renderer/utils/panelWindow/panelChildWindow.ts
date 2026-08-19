import { panelWindowApi } from '@api/modules/panelWindowApi';

import {
  mirrorDocumentStyles,
  removeMirroredStyles,
  type DocumentStyleMirror,
} from './mirrorDocumentStyles';

// 분리 패널 창 = 메인 웹뷰가 window.open으로 여는 opener 자식.
// 백엔드 on_new_window 훅이 arm 토큰을 확인하고 about:blank 창(라벨 panel)을 만들어 준다.
// 자식은 opener와 같은 JS 힙·오리진을 쓰므로 메인이 DOM을 직접 옮겨 그린다.
// 창은 프로세스 수명 동안 하나 - 도킹은 백엔드 hide, 파괴는 종료 시만
// (자식 웹뷰를 파괴하면 공유 WKUserContentController에서 메인 IPC 핸들러까지 빠진다)

const PANEL_WINDOW_NAME = 'dmn-panel';
// 크기·위치는 백엔드가 저장값으로 덮어쓴다 - 여기 값은 popup 힌트일 뿐
const PANEL_WINDOW_FEATURES = 'popup=yes,width=240,height=712';
const PREPARED_MARK = 'dmnPanelPrepared';

export interface PanelChildWindow {
  window: Window;
  document: Document;
  styles: DocumentStyleMirror;
}

export class PanelChildWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelChildWindowError';
  }
}

let current: PanelChildWindow | null = null;

export const getPanelChildWindow = (): PanelChildWindow | null =>
  current && !current.window.closed ? current : null;

// 자식 문서의 기본 골격. about:blank라 charset·color-scheme·base가 없다.
// dev reload로 opener가 바뀌면 같은 이름의 기존 창이 돌아올 수 있어 이전 흔적을 걷어낸다
const prepareChildDocument = (source: Document, target: Document) => {
  const alreadyPrepared = target.documentElement.dataset[PREPARED_MARK] === '1';
  if (alreadyPrepared) {
    removeMirroredStyles(target);
    target.body.replaceChildren();
  }
  target.documentElement.dataset[PREPARED_MARK] = '1';
  target.documentElement.lang = source.documentElement.lang;
  target.title = 'DM Note - Panel';

  if (!target.querySelector('meta[charset]')) {
    const charset = target.createElement('meta');
    charset.setAttribute('charset', 'UTF-8');
    target.head.appendChild(charset);
  }
  if (!target.querySelector('meta[name="color-scheme"]')) {
    const colorScheme = target.createElement('meta');
    colorScheme.name = 'color-scheme';
    colorScheme.content = 'dark';
    target.head.appendChild(colorScheme);
  }
  if (!target.querySelector('base')) {
    // 상대 url()·폰트 경로가 opener 문서 기준으로 풀리게
    const base = target.createElement('base');
    base.href = source.baseURI;
    target.head.appendChild(base);
  }
  // 창 자체가 패널 - 문서 여백 없이 투명 바탕(모서리 라운딩은 콘텐츠가 그린다)
  target.body.style.margin = '0';
  target.body.style.background = 'transparent';
  target.body.style.overflow = 'hidden';
};

/**
 * 자식 창을 연다(이미 있으면 재사용). 반환 시점에 문서 골격과 스타일 복제가 끝나 있다.
 * 창은 숨김 상태 - DOM을 옮긴 뒤 panelWindowApi.present()로 드러낸다
 */
export const openPanelChildWindow = async (): Promise<PanelChildWindow> => {
  const existing = getPanelChildWindow();
  if (existing) return existing;
  current = null;

  await panelWindowApi.armOpen();
  const child = window.open('', PANEL_WINDOW_NAME, PANEL_WINDOW_FEATURES);
  if (!child) {
    throw new PanelChildWindowError(
      'window.open returned null - the panel window request was denied',
    );
  }
  const doc = child.document;
  prepareChildDocument(document, doc);
  const styles = mirrorDocumentStyles(document, doc);
  await styles.ready;
  if (child.closed) {
    styles.dispose();
    throw new PanelChildWindowError('panel window closed while preparing');
  }
  current = { window: child, document: doc, styles };
  return current;
};

// 테스트·재시작 경로용 - 참조만 버린다 (창은 백엔드가 소유)
export const resetPanelChildWindow = (): void => {
  current?.styles.dispose();
  current = null;
};
