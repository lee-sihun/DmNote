import type {
  PluginDefinitionInternal,
  PluginDefinitionView,
  PluginDisplayElementInternal,
  PluginPanelElementView,
  PluginPanelModelSnapshot,
  PluginResolvedSettingSchema,
} from '@src/types/plugin/api';
import {
  getDefaultSettings,
  isValueSetting,
  safeEvaluateVisibility,
} from '@plugins/runtime/settingsSections';
import { usePanelWindowStore } from '@stores/grid/usePanelWindowStore';
import type { PanelWindowStatus } from '@stores/grid/usePanelWindowStore';
import { getPluginAuthorityGeneration } from '@plugins/rpc/pluginRpcClient';
import { getBackendPluginRevision } from '@plugins/rpc/pluginModelRevision';
import { sendBridgeMessageBestEffort } from './bridgeMessages';

export const PANEL_MODEL_SYNC_MESSAGE = 'plugin:panelModel:sync';
export const PANEL_MODEL_REQUEST_MESSAGE = 'plugin:panelModel:request';

const SYNC_THROTTLE_MS = 16; // 오버레이 sync와 동일 주기

// push 순서 시퀀스 (renderer-only 필드 변경도 전진 - backend revision과 별개)
let pushSeq = 0;
let syncScheduled = false;
let pendingElements: PluginDisplayElementInternal[] | null = null;
let pendingDefinitions: Map<string, PluginDefinitionInternal> | null = null;
let pendingForce = false;

export const shouldSendPanelModel = (
  status: PanelWindowStatus,
  force: boolean,
): boolean => force || status === 'detached';

// JSON 직렬화 보장 - 함수 값 필드 제거 (중첩 객체·배열 포함, 순환 참조는 절단)
// seen은 현재 경로 기준 - 형제가 같은 객체를 공유하는 DAG는 그대로 직렬화
const stripFunctionsDeep = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value
        .map((item) => stripFunctionsDeep(item, seen))
        .filter((item) => item !== undefined);
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const stripped = stripFunctionsDeep(entry, seen);
      if (stripped !== undefined) result[key] = stripped;
    }
    return result;
  } finally {
    seen.delete(value);
  }
};

/** 창 경계 push용 패널 요소 투영 - 렌더 전용 HTML·state·handler 제외 */
export const toPluginPanelElementView = (
  element: PluginDisplayElementInternal,
): PluginPanelElementView => ({
  id: element.id,
  fullId: element.fullId,
  pluginId: element.pluginId,
  definitionId: element.definitionId,
  position: element.position,
  settings: stripFunctionsDeep(element.settings, new WeakSet()) as
    | Record<string, unknown>
    | undefined,
  measuredSize: element.measuredSize,
  estimatedSize: element.estimatedSize,
  resizeAnchor: element.resizeAnchor,
  zIndex: element.zIndex,
  hidden: element.hidden,
  width: element.width,
  height: element.height,
  tabId: element.tabId,
});

/** visible 함수를 주어진 values로 평가한 boolean 스키마로 치환 (창 경계 직렬화용) */
export const resolveSettingsSchemaForValues = (
  settings: PluginDefinitionInternal['settings'],
  values: Record<string, unknown>,
): Record<string, PluginResolvedSettingSchema> => {
  const resolved: Record<string, PluginResolvedSettingSchema> = {};

  for (const [key, schema] of Object.entries(settings ?? {})) {
    if (schema.type === 'section') {
      resolved[key] = {
        type: 'section',
        label: schema.label,
        visible: safeEvaluateVisibility(schema.visible, values),
      };
      continue;
    }
    // 미지원 타입은 fail-closed 제외 (normalizeSettingsSections와 동일 규칙)
    if (!isValueSetting(schema)) continue;
    const { visible, ...valueSchema } = schema;
    resolved[key] = {
      ...valueSchema,
      visible: safeEvaluateVisibility(visible, values),
    };
  }

  return resolved;
};

const buildDefinitionView = (
  definition: PluginDefinitionInternal,
): PluginDefinitionView => {
  const resolvedSettingsSchema = resolveSettingsSchemaForValues(
    definition.settings,
    getDefaultSettings(definition.settings),
  );

  return {
    definitionId: definition.id,
    name: definition.name,
    resizable: definition.resizable,
    preserveAxis: definition.preserveAxis,
    resizeAnchor: definition.resizeAnchor,
    settingsUI: definition.settingsUI,
    resolvedSettingsSchema,
    messages: definition.messages,
  };
};

const flushPanelModelSync = () => {
  const elements = pendingElements;
  const definitions = pendingDefinitions;
  const force = pendingForce;
  pendingElements = null;
  pendingDefinitions = null;
  pendingForce = false;
  if (!elements || !definitions) return;

  // 패널 창이 없으면 push 생략 - 재열림 시 request로 전체 스냅샷 복구
  if (!shouldSendPanelModel(usePanelWindowStore.getState().status, force))
    return;

  // 요소별 현재 settings 기준 visibility만 평가 - 스키마 본문 복제 없이 O(E×키 수) boolean
  const elementVisibility: PluginPanelModelSnapshot['elementVisibility'] = {};
  for (const element of elements) {
    const definition = definitions.get(element.definitionId);
    if (!definition?.settings) continue;
    const values = {
      ...getDefaultSettings(definition.settings),
      ...(element.settings ?? {}),
    };
    const visibility: Record<string, boolean> = {};
    for (const [key, schema] of Object.entries(definition.settings)) {
      if (schema.type !== 'section' && !isValueSetting(schema)) continue;
      visibility[key] = safeEvaluateVisibility(schema.visible, values);
    }
    elementVisibility[element.fullId] = visibility;
  }

  pushSeq += 1;
  const snapshot: PluginPanelModelSnapshot = {
    modelRevision: getBackendPluginRevision(),
    pushSeq,
    authorityGeneration: getPluginAuthorityGeneration(),
    elements: elements.map(toPluginPanelElementView),
    definitions: [...definitions.values()].map(buildDefinitionView),
    elementVisibility,
  };
  sendBridgeMessageBestEffort('panel', PANEL_MODEL_SYNC_MESSAGE, snapshot);
};

/** RPC 응답·미러 검증용 현재 backend revision */
export const getPluginPanelModelRevision = (): number =>
  getBackendPluginRevision();

/**
 * 패널발 mutation 적용 직후 동기 flush - 응답이 전진된 revision을 실어
 * 패널의 후속 요청이 stale 거절 루프에 빠지지 않게 함
 */
export const flushPluginPanelModelSyncNow = (): void => {
  if (pendingElements === null || pendingDefinitions === null) return;
  syncScheduled = false;
  flushPanelModelSync();
};

/** main → panel read-model push 예약 (쓰로틀, 최신 스냅샷만 유지) */
export const schedulePluginPanelModelSync = (
  elements: PluginDisplayElementInternal[],
  definitions: Map<string, PluginDefinitionInternal>,
  force = false,
): void => {
  pendingElements = elements;
  pendingDefinitions = definitions;
  pendingForce ||= force;

  if (syncScheduled) return;
  syncScheduled = true;
  setTimeout(() => {
    syncScheduled = false;
    flushPanelModelSync();
  }, SYNC_THROTTLE_MS);
};
