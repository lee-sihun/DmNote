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
  handlerGet: vi.fn(),
  handlerRegister: vi.fn(),
  handlerUnregister: vi.fn(),
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
    register: mocks.handlerRegister,
    unregister: mocks.handlerUnregister,
    get: mocks.handlerGet,
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
  reissueDisplayElementHandlers,
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

describe('display element handler reissue', () => {
  beforeEach(() => {
    mocks.handlerGet.mockReset();
    mocks.handlerRegister.mockReset();
    mocks.handlerUnregister.mockReset();
  });

  const baseElement = () => ({
    pluginId: 'plugin-a',
    onClick: 'owned-click' as string | undefined,
    _onClickId: 'owned-click' as string | undefined,
    onPositionChange: undefined,
    onDelete: undefined,
    _onPositionChangeId: undefined,
    _onDeleteId: undefined,
  });

  it('소유 등록이 살아 있으면 같은 콜백을 새 id로 재등록한다', () => {
    const callback = vi.fn();
    mocks.handlerGet.mockReturnValue(callback);
    mocks.handlerRegister.mockReturnValue('reissued-click');

    const copy = reissueDisplayElementHandlers(baseElement());

    expect(mocks.handlerRegister).toHaveBeenCalledWith('plugin-a', callback);
    expect(copy._onClickId).toBe('reissued-click');
    expect(copy.onClick).toBe('reissued-click');
  });

  it('원본 등록이 이미 해제됐으면 dangling 참조 없이 핸들러를 비운다', () => {
    mocks.handlerGet.mockReturnValue(undefined);

    const copy = reissueDisplayElementHandlers(baseElement());

    expect(mocks.handlerRegister).not.toHaveBeenCalled();
    expect(copy._onClickId).toBeUndefined();
    expect(copy.onClick).toBeUndefined();
  });

  it('소유 등록이 없는 문자열 핸들러는 그대로 둔다', () => {
    const copy = reissueDisplayElementHandlers({
      ...baseElement(),
      onClick: 'plugin-managed-handler',
      _onClickId: undefined,
    });

    expect(mocks.handlerGet).not.toHaveBeenCalled();
    expect(mocks.handlerRegister).not.toHaveBeenCalled();
    expect(copy.onClick).toBe('plugin-managed-handler');
    expect(copy._onClickId).toBeUndefined();
  });

  it('세 핸들러 쌍을 각각 독립으로 재발급한다', () => {
    const clickFn = vi.fn();
    const deleteFn = vi.fn();
    mocks.handlerGet.mockImplementation((id: unknown) =>
      id === 'owned-click'
        ? clickFn
        : id === 'owned-delete'
        ? deleteFn
        : undefined,
    );
    let serial = 0;
    mocks.handlerRegister.mockImplementation(() => `reissued-${++serial}`);

    const copy = reissueDisplayElementHandlers({
      ...baseElement(),
      onPositionChange: 'owned-move' as string | undefined,
      _onPositionChangeId: 'owned-move' as string | undefined,
      onDelete: 'owned-delete' as string | undefined,
      _onDeleteId: 'owned-delete' as string | undefined,
    });

    expect(copy._onClickId).toBe('reissued-1');
    expect(copy.onClick).toBe('reissued-1');
    // 등록이 사라진 move 쌍만 비움
    expect(copy._onPositionChangeId).toBeUndefined();
    expect(copy.onPositionChange).toBeUndefined();
    expect(copy._onDeleteId).toBe('reissued-2');
    expect(copy.onDelete).toBe('reissued-2');
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

  it('플러그인 공개 add가 넘긴 타 플러그인 definitionId는 무시한다', () => {
    displayElementApi.add({
      html: '<div />',
      position: { x: 0, y: 0 },
      definitionId: 'plugin-b',
    } as Parameters<typeof displayElementApi.add>[0]);

    // 위조 definitionId가 타 플러그인 저장 모집단에 편입되는 것을 차단 -
    // 속성 자체를 남기지 않는다
    const element = addedElement() as Record<string, unknown>;
    expect('definitionId' in element).toBe(false);
  });

  it('공개 add의 자기 플러그인 definitionId(defId === pluginId)는 수용한다', () => {
    // 그리드 컨텍스트 메뉴 생성 경로가 공개 add로 자기 defId를 넘긴다
    displayElementApi.add({
      html: '<div />',
      position: { x: 0, y: 0 },
      definitionId: 'plugin-a',
    } as Parameters<typeof displayElementApi.add>[0]);

    const element = addedElement() as Record<string, unknown>;
    expect(element.definitionId).toBe('plugin-a');
  });

  it('내부 복원 add는 저장된 definitionId를 그대로 통과시킨다', () => {
    addDisplayElementInternal({
      html: '<div />',
      position: { x: 0, y: 0 },
      instanceId: SAVED_INSTANCE_ID,
      definitionId: 'legacy-def',
    } as Parameters<typeof addDisplayElementInternal>[0]);

    const element = addedElement() as Record<string, unknown>;
    expect(element.definitionId).toBe('legacy-def');
  });
});
