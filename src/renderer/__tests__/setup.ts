// jsdom에 없는 API stub

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
