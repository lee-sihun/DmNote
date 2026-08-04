import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFocusableElements } from './focusableElements';

describe('getFocusableElements', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      document.createElement('div').getBoundingClientRect(),
    ] as unknown as DOMRectList);
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('returns only rendered and available focus targets', () => {
    const visible = document.createElement('button');
    const displayNone = document.createElement('button');
    displayNone.style.display = 'none';
    const visibilityHidden = document.createElement('button');
    visibilityHidden.style.visibility = 'hidden';
    const ariaDisabled = document.createElement('button');
    ariaDisabled.setAttribute('aria-disabled', 'true');
    const noLayoutBox = document.createElement('button');
    noLayoutBox.getClientRects = () => [] as unknown as DOMRectList;
    const hiddenGroup = document.createElement('div');
    hiddenGroup.setAttribute('aria-hidden', 'true');
    const hiddenDescendant = document.createElement('button');
    hiddenGroup.appendChild(hiddenDescendant);

    root.append(
      displayNone,
      visibilityHidden,
      ariaDisabled,
      noLayoutBox,
      hiddenGroup,
      visible,
    );

    expect(getFocusableElements(root)).toEqual([visible]);
  });
});
