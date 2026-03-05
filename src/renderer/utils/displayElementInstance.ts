import type { PluginDisplayElement } from '@src/types/api';
import { renderToStaticMarkup } from 'react-dom/server';
import { html, styleMap, css } from '@src/renderer/utils/templateEngine';
import type {
  DisplayElementTemplate,
  DisplayElementTemplateHelpers,
  PluginTranslateFn,
} from '@src/types/api';

/**
 * 두 값이 동일한지 깊은 비교
 * 배열과 객체를 재귀적으로 비교하여 불필요한 업데이트 방지
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

interface DisplayElementInstanceOptions {
  fullId: string;
  pluginId: string;
  scoped?: boolean;
  initialState?: Record<string, any>;
  template?: DisplayElementTemplate;
  updateElement: (
    fullId: string,
    updates: Partial<PluginDisplayElement>,
  ) => void;
  removeElement: (fullId: string) => void;
  locale: string;
  t: PluginTranslateFn;
}

export class DisplayElementInstance extends String {
  public readonly id: string;
  public readonly pluginId: string;

  private readonly scoped: boolean;
  private readonly updateElement: (
    fullId: string,
    updates: Partial<PluginDisplayElement>,
  ) => void;
  private readonly removeElement: (fullId: string) => void;

  private destroyed = false;
  private state?: Record<string, any>;
  private template?: DisplayElementTemplate;
  private readonly templateHelpers: DisplayElementTemplateHelpers;

  constructor(options: DisplayElementInstanceOptions) {
    super(options.fullId);
    this.id = options.fullId;
    this.pluginId = options.pluginId;
    this.scoped = Boolean(options.scoped);
    this.updateElement = options.updateElement;
    this.removeElement = options.removeElement;
    this.template = options.template;
    this.templateHelpers = {
      html,
      styleMap,
      css,
      locale: options.locale,
      t: options.t,
    };

    if (options.initialState) {
      this.state = { ...options.initialState };
    } else if (options.template) {
      this.state = {};
    }
  }

  setState(updates: Record<string, any>): void {
    if (!this.ensureActive()) return;
    if (!updates || typeof updates !== 'object') return;

    const nextState = this.ensureState();

    // 깊은 비교: 배열/객체도 실제 값 변경 여부 확인
    let hasChanges = false;
    for (const key in updates) {
      if (!deepEqual(nextState[key], updates[key])) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) return; // 변경사항 없으면 스킵

    Object.assign(nextState, updates);
    this.renderFromTemplate();
  }

  setData(updates: Record<string, any>): void {
    this.setState(updates);
  }

  getState(): Record<string, any> {
    return { ...(this.state || {}) };
  }

  setText(selector: string = ':root', text: string): void {
    if (!this.ensureActive()) return;
    this.withTarget(selector, (target) => {
      target.textContent = text;
    });
  }

  setHTML(selector: string = ':root', html: string): void {
    if (!this.ensureActive()) return;
    this.withTarget(selector, (target) => {
      target.innerHTML = html;
    });
  }

  setStyle(selector: string = ':root', styles: Record<string, string>): void {
    if (!this.ensureActive()) return;
    this.withTarget(selector, (target) => {
      if (!(target instanceof HTMLElement)) return;
      Object.entries(styles || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        target.style.setProperty(key, value);
      });
    });
  }

  addClass(selector: string = ':root', ...classNames: string[]): void {
    if (!this.ensureActive()) return;
    if (!classNames.length) return;
    this.withTarget(selector, (target) => {
      if (!(target instanceof HTMLElement)) return;
      target.classList.add(...classNames);
    });
  }

  removeClass(selector: string = ':root', ...classNames: string[]): void {
    if (!this.ensureActive()) return;
    if (!classNames.length) return;
    this.withTarget(selector, (target) => {
      if (!(target instanceof HTMLElement)) return;
      target.classList.remove(...classNames);
    });
  }

  toggleClass(selector: string = ':root', className: string): void {
    if (!this.ensureActive()) return;
    if (!className) return;
    this.withTarget(selector, (target) => {
      if (!(target instanceof HTMLElement)) return;
      target.classList.toggle(className);
    });
  }

  query(selector: string = ':root'): Element | ShadowRoot | null {
    const resolved = this.resolveTarget(selector, { sync: false });
    if (!resolved) return null;
    return resolved.target;
  }

  update(updates: Partial<PluginDisplayElement>): void {
    if (!this.ensureActive()) return;
    this.updateElement(this.id, updates);
  }

  remove(): void {
    if (!this.ensureActive()) return;
    this.destroyed = true;
    this.removeElement(this.id);
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
  }

  toString(): string {
    return this.id;
  }

  valueOf(): string {
    return this.id;
  }

  [Symbol.toPrimitive](): string {
    return this.id;
  }

  private ensureActive(): boolean {
    if (this.destroyed) {
      console.warn(
        `[DisplayElement] '${this.id}'은 더 이상 사용할 수 없습니다.`,
      );
      return false;
    }
    return true;
  }

  private ensureState(): Record<string, any> {
    if (!this.state) {
      this.state = {};
    }
    return this.state;
  }

  private renderFromTemplate(): void {
    if (!this.template || !this.state) return;
    let output: any = '';
    try {
      output = this.template({ ...this.state }, this.templateHelpers);
    } catch (error) {
      console.error(
        `[DisplayElement] template 렌더링에 실패했습니다 (${this.id})`,
        error,
      );
      return;
    }

    if (typeof output === 'object' && output !== null) {
      const htmlString = renderToStaticMarkup(output);
      this.updateElement(this.id, { html: htmlString });
      return;
    }

    this.updateElement(this.id, {
      html: typeof output === 'string' ? output : String(output),
    });
  }

  private resolveHost(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector(
      `[data-plugin-element="${this.id}"]`,
    ) as HTMLElement | null;
  }

  private resolveRoot(host: HTMLElement): HTMLElement | ShadowRoot {
    if (this.scoped && host.shadowRoot) {
      return host.shadowRoot;
    }
    return host;
  }

  private resolveTarget(
    selector: string = ':root',
    options: { sync?: boolean } = {},
  ) {
    const host = this.resolveHost();
    if (!host) return null;
    const root = this.resolveRoot(host);

    let target: Element | ShadowRoot | null;
    if (!selector || selector === ':root') {
      target = root;
    } else if (selector === ':host') {
      target = host;
    } else {
      target =
        root instanceof ShadowRoot
          ? root.querySelector(selector)
          : (root as HTMLElement).querySelector(selector);
    }

    if (!target) return null;

    return { target, root, sync: options.sync !== false };
  }

  private withTarget(
    selector: string,
    fn: (target: Element | ShadowRoot) => void,
    options: { sync?: boolean } = {},
  ): void {
    const resolved = this.resolveTarget(selector, options);
    if (!resolved) return;

    fn(resolved.target);

    if (resolved.sync) {
      this.syncDom(resolved.root);
    }
  }

  private syncDom(root: HTMLElement | ShadowRoot): void {
    if (this.destroyed) return;
    const html = root instanceof ShadowRoot ? root.innerHTML : root.innerHTML;
    this.updateElement(this.id, { html });
  }

  private resolveRenderingRoot(): {
    host: HTMLElement;
    root: HTMLElement | ShadowRoot;
  } | null {
    const host = this.resolveHost();
    if (!host) return null;
    return { host, root: this.resolveRoot(host) };
  }
}
