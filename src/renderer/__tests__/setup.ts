// jsdom에 없는 API stub

// Node 26의 실험 localStorage 글로벌(--localstorage-file 미지정 시 undefined)이
// jsdom 것을 가리므로, 동작하는 구현이 없으면 메모리 shim으로 대체한다
const hasWorkingLocalStorage = (() => {
  try {
    return typeof globalThis.localStorage?.getItem === 'function';
  } catch {
    return false;
  }
})();
if (!hasWorkingLocalStorage) {
  const store = new Map<string, string>();
  const shim: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
  });
}

if (!window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(
      type: string,
      init: MouseEventInit & {
        pointerId?: number;
        pointerType?: string;
        isPrimary?: boolean;
      } = {},
    ) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    value: PointerEventPolyfill,
  });
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventPolyfill,
  });
}

const capturedPointers = new WeakMap<Element, Set<number>>();

HTMLElement.prototype.setPointerCapture = function (pointerId: number) {
  const pointerIds = capturedPointers.get(this) ?? new Set<number>();
  pointerIds.add(pointerId);
  capturedPointers.set(this, pointerIds);
};

HTMLElement.prototype.releasePointerCapture = function (pointerId: number) {
  capturedPointers.get(this)?.delete(pointerId);
};

HTMLElement.prototype.hasPointerCapture = function (pointerId: number) {
  return capturedPointers.get(this)?.has(pointerId) ?? false;
};

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
