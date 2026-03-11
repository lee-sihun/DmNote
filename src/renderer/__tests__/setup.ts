// jsdom에 없는 API stub

// colorUtils의 parseHexColor에서 사용
if (!window.CSS) {
  Object.defineProperty(window, 'CSS', {
    value: {
      supports: () => true,
    },
  });
} else if (!window.CSS.supports) {
  window.CSS.supports = () => true;
}

// Tauri 런타임 stub (향후 API 계층 테스트 확장용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__TAURI_INTERNALS__ = {
  invoke: async () => undefined,
  transformCallback: () => 0,
  convertFileSrc: (src: string) => src,
  metadata: {
    currentWindow: { label: 'main', kind: 'Main' },
    currentWebview: { label: 'main', windowLabel: 'main' },
  },
};
