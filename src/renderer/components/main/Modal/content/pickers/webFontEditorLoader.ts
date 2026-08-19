// 웹폰트 편집기 청크의 import 프라미스. lazy 래퍼와 별개로 두는 이유는 로드 실패 뒤
// 다시 시도할 때 둘 다 새로 만들어야 하기 때문 - lazy는 실패를 영구히 기억한다
let webFontInputModalImport: Promise<
  typeof import('./WebFontInputModal')
> | null = null;

export const importWebFontInputModal = () => {
  if (!webFontInputModalImport) {
    webFontInputModalImport = import('./WebFontInputModal');
  }
  return webFontInputModalImport;
};

// 피커를 열 때 미리 당겨 둔다. 실패는 렌더 시점에 lazy가 다시 던지고 경계가 받으므로
// 여기선 로그 소음만 막는다
export const preloadWebFontEditor = () => {
  importWebFontInputModal().catch(() => {});
};

export const resetWebFontEditorLoader = () => {
  webFontInputModalImport = null;
};
