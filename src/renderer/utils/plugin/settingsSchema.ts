import type {
  PluginDefinitionInternal,
  PluginResolvedSettingSchema,
} from '@src/types/plugin/api';
import {
  isValueSetting,
  safeEvaluateVisibility,
} from '@plugins/runtime/settingsSections';

/** visible 함수를 주어진 values로 평가한 boolean 스키마로 치환 */
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
