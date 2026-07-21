import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TestElement {
  fullId: string;
  pluginId: string;
  position: { x: number; y: number };
}

const mocks = vi.hoisted(() => ({
  elements: [] as TestElement[],
  addElement: vi.fn(),
  removeElement: vi.fn(),
  rotateEditSession: vi.fn(),
  unregisterInstance: vi.fn(),
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      addElement: mocks.addElement,
      removeElement: mocks.removeElement,
    }),
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({ selectedKeyType: '4key' }),
  },
}));

vi.mock('@utils/displayElementInstance', () => ({
  DisplayElementInstance: class {
    id: string;

    constructor({ fullId }: { fullId: string }) {
      this.id = fullId;
    }

    setState() {}
  },
}));

vi.mock('@utils/core/templateEngine', () => ({ html: vi.fn() }));
vi.mock('@utils/plugin/pluginI18n', () => ({
  createPluginTranslator: () => vi.fn(),
}));
vi.mock('../handlers', () => ({
  handlerRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));
vi.mock('./instanceRegistry', () => ({
  registerDisplayElementInstance: vi.fn(),
  unregisterDisplayElementInstance: mocks.unregisterInstance,
}));
vi.mock('./targetResolver', () => ({
  resolveFullId: (target: unknown) =>
    typeof target === 'string' ? target : null,
  resolveInstance: vi.fn(),
  createNoopDisplayElementInstance: vi.fn(),
}));
vi.mock('./templateBuilder', () => ({
  buildDisplayElementTemplate: vi.fn(),
}));
vi.mock('./instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotateEditSession,
}));

import {
  addDisplayElementInternal,
  displayElementApi,
} from './displayElementApi';

describe('display element discrete edit boundaries', () => {
  beforeEach(() => {
    window.__dmn_window_type = 'main';
    window.__dmn_current_plugin_id = 'plugin-a';
    mocks.elements = [];
    mocks.addElement.mockReset().mockImplementation((element: TestElement) => {
      mocks.elements = [...mocks.elements, element];
    });
    mocks.removeElement.mockReset().mockImplementation((fullId: string) => {
      mocks.elements = mocks.elements.filter(
        (element) => element.fullId !== fullId,
      );
    });
    mocks.rotateEditSession.mockReset();
    mocks.unregisterInstance.mockReset();
  });

  it('사용자 add는 세션을 분리하고 복원용 internal add는 분리하지 않는다', () => {
    const element = {
      html: '<div />',
      position: { x: 10, y: 20 },
    } as Parameters<typeof displayElementApi.add>[0];

    displayElementApi.add(element);
    addDisplayElementInternal(element);

    expect(mocks.rotateEditSession).toHaveBeenCalledOnce();
    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.addElement).toHaveBeenCalledTimes(2);
  });

  it('사용자 remove는 mutation 전에 대상 플러그인 세션을 분리한다', () => {
    mocks.elements = [
      {
        fullId: 'plugin-a::element-one',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
      },
    ];

    displayElementApi.remove('plugin-a::element-one');

    expect(mocks.rotateEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.rotateEditSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeElement.mock.invocationCallOrder[0],
    );
  });

  it('store에서 사라진 요소도 stale instance registry를 정리한다', () => {
    displayElementApi.remove('plugin-a::missing');

    expect(mocks.rotateEditSession).not.toHaveBeenCalled();
    expect(mocks.unregisterInstance).toHaveBeenCalledWith('plugin-a::missing');
    expect(mocks.removeElement).toHaveBeenCalledWith('plugin-a::missing');
  });
});
