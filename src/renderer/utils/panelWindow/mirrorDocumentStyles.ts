// 메인 문서의 스타일시트를 자식 창 문서로 복제·추적한다.
// 자식 창(about:blank)은 opener가 DOM을 그리는 빈 문서라 Tailwind 번들·토큰·커스텀 CSS·
// dev HMR 스타일이 전부 메인 head에만 있다. 초기 복제 뒤 MutationObserver로
// 추가/제거/내용 변경(HMR은 <style> 텍스트를 갈아끼운다)을 따라간다

const MIRRORED_ATTR = 'data-dmn-mirrored-style';
const STYLE_SELECTOR = 'link[rel~="stylesheet"], style';
// prod의 <link>는 비동기 로드 - 무한정 기다리지 않는다
const LINK_LOAD_TIMEOUT_MS = 500;

export interface DocumentStyleMirror {
  // 초기 복제분의 <link>가 로드(또는 실패·타임아웃)되면 resolve
  ready: Promise<void>;
  dispose: () => void;
}

const isStyleNode = (node: Node): node is HTMLLinkElement | HTMLStyleElement =>
  node.nodeType === Node.ELEMENT_NODE &&
  (node as Element).matches(STYLE_SELECTOR);

const collectStyleNodes = (
  root: Node,
): Array<HTMLLinkElement | HTMLStyleElement> => {
  if (root.nodeType !== Node.ELEMENT_NODE) return [];
  const element = root as Element;
  const nodes = Array.from(element.querySelectorAll(STYLE_SELECTOR)) as Array<
    HTMLLinkElement | HTMLStyleElement
  >;
  if (isStyleNode(element)) nodes.unshift(element);
  return nodes;
};

const waitForLink = (link: HTMLLinkElement): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      link.removeEventListener('load', done);
      link.removeEventListener('error', done);
      resolve();
    };
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, LINK_LOAD_TIMEOUT_MS);
  });

// 이전 세션(dev reload로 opener가 바뀐 경우)이 남긴 복제본 정리
export const removeMirroredStyles = (target: Document): void => {
  target
    .querySelectorAll(`[${MIRRORED_ATTR}]`)
    .forEach((node) => node.remove());
};

export const mirrorDocumentStyles = (
  source: Document,
  target: Document,
): DocumentStyleMirror => {
  const mirrors = new Map<Node, HTMLLinkElement | HTMLStyleElement>();
  const pendingLinks: Promise<void>[] = [];

  const clone = (node: HTMLLinkElement | HTMLStyleElement) => {
    const copy = target.importNode(node, true) as
      | HTMLLinkElement
      | HTMLStyleElement;
    copy.setAttribute(MIRRORED_ATTR, '');
    if (copy.tagName === 'LINK') {
      // 상대 href는 opener 문서 기준으로 해석된 절대값을 쓴다
      (copy as HTMLLinkElement).href = (node as HTMLLinkElement).href;
    }
    return copy;
  };

  // 소스 순서를 유지해 캐스케이드가 같게 - 다음 형제 중 복제본이 있는 것 앞에 끼운다
  const insertInOrder = (
    node: HTMLLinkElement | HTMLStyleElement,
    copy: HTMLLinkElement | HTMLStyleElement,
  ) => {
    const ordered = collectStyleNodes(source.head);
    const index = ordered.indexOf(node);
    for (let i = index + 1; i < ordered.length; i += 1) {
      const nextMirror = mirrors.get(ordered[i]);
      if (nextMirror && nextMirror.parentNode === target.head) {
        target.head.insertBefore(copy, nextMirror);
        return;
      }
    }
    target.head.appendChild(copy);
  };

  const add = (node: HTMLLinkElement | HTMLStyleElement) => {
    if (mirrors.has(node)) return;
    const copy = clone(node);
    mirrors.set(node, copy);
    insertInOrder(node, copy);
    if (copy.tagName === 'LINK') {
      pendingLinks.push(waitForLink(copy as HTMLLinkElement));
    }
  };

  const remove = (node: Node) => {
    const copy = mirrors.get(node);
    if (!copy) return;
    mirrors.delete(node);
    copy.remove();
  };

  const refresh = (node: HTMLLinkElement | HTMLStyleElement) => {
    const copy = mirrors.get(node);
    if (!copy) return;
    if (node.tagName === 'STYLE') {
      if (copy.textContent !== node.textContent) {
        copy.textContent = node.textContent;
      }
      return;
    }
    // <link>는 속성 통째로 다시 맞춘다 (href·media·disabled)
    for (const { name, value } of Array.from(node.attributes)) {
      if (copy.getAttribute(name) !== value) copy.setAttribute(name, value);
    }
    for (const { name } of Array.from(copy.attributes)) {
      if (name !== MIRRORED_ATTR && !node.hasAttribute(name)) {
        copy.removeAttribute(name);
      }
    }
    (copy as HTMLLinkElement).href = (node as HTMLLinkElement).href;
  };

  collectStyleNodes(source.head).forEach(add);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.removedNodes.forEach((removed) => {
          collectStyleNodes(removed).forEach(remove);
          // <style> 안의 텍스트 노드 교체
          const owner = removed.parentNode ?? record.target;
          if (isStyleNode(owner)) refresh(owner);
        });
        record.addedNodes.forEach((added) => {
          collectStyleNodes(added).forEach(add);
          const owner = record.target;
          if (isStyleNode(owner)) refresh(owner);
        });
        continue;
      }
      if (record.type === 'characterData') {
        const owner = record.target.parentNode;
        if (owner && isStyleNode(owner)) refresh(owner);
        continue;
      }
      if (record.type === 'attributes' && isStyleNode(record.target)) {
        refresh(record.target);
      }
    }
  });
  observer.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  return {
    ready: Promise.all(pendingLinks).then(() => undefined),
    dispose: () => {
      observer.disconnect();
      mirrors.forEach((copy) => copy.remove());
      mirrors.clear();
    },
  };
};
