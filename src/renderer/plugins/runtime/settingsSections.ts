import type {
  PluginSettingSchema,
  PluginSettingValue,
  PluginValueSettingType,
} from '@src/types/plugin/api';

const VALUE_SETTING_TYPES = new Set<PluginValueSettingType>([
  'boolean',
  'color',
  'number',
  'string',
  'select',
]);

export type PluginValueSettingSchema = Extract<
  PluginSettingSchema,
  { type: PluginValueSettingType }
>;

interface NormalizedSettingEntry {
  key: string;
  schema: PluginValueSettingSchema;
  renderVisible: boolean;
}

interface NormalizedSection {
  key: string | null;
  label?: string;
  markerVisible: boolean;
  renderVisible: boolean;
  entries: NormalizedSettingEntry[];
}

export type SettingsNormalizationErrorKind = 'visibility' | 'unsupported-type';
type SettingsNormalizationErrorHandler = (
  key: string,
  error: unknown,
  kind: SettingsNormalizationErrorKind,
) => void;

export const isValueSetting = (
  schema: PluginSettingSchema,
): schema is PluginValueSettingSchema =>
  VALUE_SETTING_TYPES.has(schema.type as PluginValueSettingType);

export const safeEvaluateVisibility = (
  visible:
    | boolean
    | ((settings: Record<string, unknown>) => boolean)
    | undefined,
  values: Record<string, unknown>,
  onError?: (error: unknown) => void,
): boolean => {
  if (visible === undefined) return true;
  if (typeof visible !== 'function') return Boolean(visible);

  try {
    return Boolean(visible(values));
  } catch (error) {
    onError?.(error);
    return false;
  }
};

// 모달 DOM 콜백의 문자열 값을 스키마 타입으로 복원 — 패널 경로와 동일 의미
// (패널: NumberInput은 number, select는 optionMap으로 원본 타입 보존)
// 복원 불가한 number 입력은 null 반환 → 커밋 스킵 (패널도 무효 입력은 onChange 미호출)
export const coerceSettingValue = (
  schema: PluginValueSettingSchema,
  raw: unknown,
): PluginSettingValue | null => {
  if (schema.type === 'number') {
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
    if (!Number.isFinite(parsed)) return null;

    // 스키마에 명시된 범위만 클램프 (Enter 등 blur를 거치지 않는 change 대비)
    let value = parsed;
    if (schema.min !== undefined && value < schema.min) value = schema.min;
    if (schema.max !== undefined && value > schema.max) value = schema.max;
    return value;
  }

  if (schema.type === 'select') {
    // 문자열 표현이 겹치면 마지막 옵션 — 패널 optionMap(Map 덮어쓰기) 규칙과 동일
    const matched = (schema.options ?? [])
      .filter((option) => String(option.value) === String(raw))
      .pop();
    return matched ? matched.value : (raw as PluginSettingValue);
  }

  return raw as PluginSettingValue;
};

export const getDefaultSettings = (
  schema: Record<string, PluginSettingSchema> | undefined,
): Record<string, PluginSettingValue> => {
  if (!schema) return {};

  const defaults: Record<string, PluginSettingValue> = {};
  for (const [key, setting] of Object.entries(schema)) {
    if (isValueSetting(setting)) defaults[key] = setting.default;
  }
  return defaults;
};

export const omitLayoutSettingValues = (
  schema: Record<string, PluginSettingSchema> | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).filter(([key]) => {
      const setting = schema?.[key];
      return setting === undefined || isValueSetting(setting);
    }),
  );

// 렌더 가능한 값 설정이 하나라도 있는가 — 빈 상태/중앙 정렬 판정용
// empty-state로 단락되면 폼 렌더가 실행되지 않으므로, 진단 누락을 막으려면
// 호출부가 폼 렌더와 같은 리포터를 전달해야 함 (중복은 리포터가 dedup)
export const hasRenderableSettings = (
  schema: Record<string, PluginSettingSchema> | undefined,
  values: Record<string, unknown>,
  onNormalizationError?: SettingsNormalizationErrorHandler,
): boolean =>
  normalizeSettingsSections(schema, values, onNormalizationError).some(
    (section) => section.renderVisible,
  );

export const normalizeSettingsSections = (
  schema: Record<string, PluginSettingSchema> | undefined,
  values: Record<string, unknown>,
  onNormalizationError?: SettingsNormalizationErrorHandler,
): NormalizedSection[] => {
  if (!schema) return [];

  const sections: NormalizedSection[] = [];
  let currentSection: NormalizedSection = {
    key: null,
    markerVisible: true,
    renderVisible: false,
    entries: [],
  };

  const pushCurrentSection = () => {
    if (currentSection.entries.length > 0) sections.push(currentSection);
  };

  for (const [key, setting] of Object.entries(schema)) {
    const settingType = (setting as { type?: unknown }).type;
    if (setting.type === 'section') {
      pushCurrentSection();
      currentSection = {
        key,
        label: setting.label,
        markerVisible: safeEvaluateVisibility(
          setting.visible,
          values,
          (error) => onNormalizationError?.(key, error, 'visibility'),
        ),
        renderVisible: false,
        entries: [],
      };
      continue;
    }

    // 미지원 타입(제거된 divider 포함)은 fail-closed로 제외 + 1회 진단
    if (!isValueSetting(setting)) {
      onNormalizationError?.(
        key,
        new Error(`Unsupported setting type: ${String(settingType)}`),
        'unsupported-type',
      );
      continue;
    }

    const renderVisible = safeEvaluateVisibility(
      setting.visible,
      values,
      (error) => onNormalizationError?.(key, error, 'visibility'),
    );
    currentSection.entries.push({ key, schema: setting, renderVisible });
    if (renderVisible) currentSection.renderVisible = true;
  }
  pushCurrentSection();

  for (const section of sections) {
    section.renderVisible =
      section.markerVisible &&
      section.entries.some((entry) => entry.renderVisible);
  }

  return sections;
};
