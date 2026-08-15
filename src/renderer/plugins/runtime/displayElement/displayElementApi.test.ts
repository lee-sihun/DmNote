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
  flushEditSession: vi.fn(),
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
  flushPluginInstancesEditSession: mocks.flushEditSession,
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
    mocks.flushEditSession.mockReset();
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
    // 플러그인 루프 add 스팸 방지 - add 경로는 debounce 유지
    expect(mocks.flushEditSession).not.toHaveBeenCalled();
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
    expect(mocks.flushEditSession).not.toHaveBeenCalled();
    expect(mocks.unregisterInstance).toHaveBeenCalledWith('plugin-a::missing');
    expect(mocks.removeElement).toHaveBeenCalledWith('plugin-a::missing');
  });

  it('사용자 remove는 제거 후 대상 플러그인 세션을 즉시 flush한다', () => {
    mocks.elements = [
      {
        fullId: 'plugin-a::element-one',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
      },
    ];

    displayElementApi.remove('plugin-a::element-one');

    expect(mocks.flushEditSession).toHaveBeenCalledOnce();
    expect(mocks.flushEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.flushEditSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.removeElement.mock.invocationCallOrder[0],
    );
  });

  it('clearMyElements는 일괄 제거 후 flush를 1회만 호출한다', () => {
    mocks.elements = [
      {
        fullId: 'plugin-a::element-one',
        pluginId: 'plugin-a',
        position: { x: 10, y: 20 },
      },
      {
        fullId: 'plugin-a::element-two',
        pluginId: 'plugin-a',
        position: { x: 30, y: 40 },
      },
    ];

    displayElementApi.clearMyElements();

    expect(mocks.removeElement).toHaveBeenCalledTimes(2);
    expect(mocks.flushEditSession).toHaveBeenCalledOnce();
    expect(mocks.flushEditSession).toHaveBeenCalledWith('plugin-a');
    expect(mocks.flushEditSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.removeElement.mock.invocationCallOrder[1],
    );
  });
});

describe('display element instance id issuance', () => {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const SAVED_INSTANCE_ID = '30000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    window.__dmn_window_type = 'main';
    window.__dmn_current_plugin_id = 'plugin-a';
    mocks.elements = [];
    mocks.addElement.mockReset();
    mocks.rotateEditSession.mockReset();
  });

  const addedElement = (index = 0) =>
    mocks.addElement.mock.calls[index]?.[0] as {
      id: string;
      fullId: string;
    };

  it('instanceId 미지정 시 UUID를 새로 발급한다', () => {
    displayElementApi.add({
      html: '<div />',
      position: { x: 0, y: 0 },
    } as Parameters<typeof displayElementApi.add>[0]);

    const element = addedElement();
    expect(element.id).toMatch(UUID_PATTERN);
    expect(element.fullId).toBe(`plugin-a::${element.id}`);
  });

  it('내부 복원 add는 저장된 instanceId를 요소 id로 사용한다', () => {
    addDisplayElementInternal({
      html: '<div />',
      position: { x: 0, y: 0 },
      instanceId: SAVED_INSTANCE_ID,
    } as Parameters<typeof addDisplayElementInternal>[0]);

    const element = addedElement();
    expect(element.id).toBe(SAVED_INSTANCE_ID);
    expect(element.fullId).toBe(`plugin-a::${SAVED_INSTANCE_ID}`);
  });

  it('플러그인 공개 add가 넘긴 instanceId는 무시하고 새로 발급한다', () => {
    displayElementApi.add({
      html: '<div />',
      position: { x: 0, y: 0 },
      instanceId: SAVED_INSTANCE_ID,
    } as unknown as Parameters<typeof displayElementApi.add>[0]);

    const element = addedElement();
    expect(element.id).not.toBe(SAVED_INSTANCE_ID);
    expect(element.id).toMatch(UUID_PATTERN);
    // 지정값은 요소 속성으로도 남기지 않는다
    expect('instanceId' in (element as Record<string, unknown>)).toBe(false);
  });

  it('플러그인 공개 add가 넘긴 groupId는 무시한다', () => {
    displayElementApi.add({
      html: '<div />',
      position: { x: 0, y: 0 },
      groupId: 'group-a',
    } as unknown as Parameters<typeof displayElementApi.add>[0]);

    // 저장 규칙 밖 dangling 소속 차단 - 속성 자체를 남기지 않는다
    const element = addedElement() as Record<string, unknown>;
    expect('groupId' in element).toBe(false);
  });

  it('내부 복원 add는 저장된 groupId 소속을 통과시킨다', () => {
    addDisplayElementInternal({
      html: '<div />',
      position: { x: 0, y: 0 },
      instanceId: SAVED_INSTANCE_ID,
      groupId: 'group-a',
    } as Parameters<typeof addDisplayElementInternal>[0]);

    const element = addedElement() as Record<string, unknown>;
    expect(element.groupId).toBe('group-a');
  });
});
