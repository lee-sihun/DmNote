import { useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore, syncFontCSS } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/settings/fonts';
import {
  extractFontFamilyFromCSS,
  generateFontId,
  normalizeFontFamilyName,
} from '@src/types/settings/fonts';

// 폰트 라이브러리 CRUD — 낙관적 스토어 갱신 + 설정 영속화
// CSS 반영은 settings:changed 라운드트립(useAppBootstrap의 syncFontCSS)이 담당
export const useFontLibrary = () => {
  const { t } = useTranslation();
  const { setAll } = useFontStore();
  const isAddingRef = useRef(false);
  const pendingFontsRef = useRef<CustomFont[] | null>(null);
  const isPersistingRef = useRef(false);

  const persistFonts = (nextFonts: CustomFont[]) => {
    setAll(nextFonts);
    pendingFontsRef.current = nextFonts;
    if (isPersistingRef.current) return;

    isPersistingRef.current = true;
    void (async () => {
      while (pendingFontsRef.current) {
        const pending = pendingFontsRef.current;
        pendingFontsRef.current = null;
        try {
          await window.api.settings.update({
            fontSettings: { customFonts: pending },
          });
        } catch (error) {
          console.error('Failed to persist font settings:', error);
          // 최신 저장 실패만 authoritative 상태로 조정. 뒤에 더 최신 의도가
          // 대기 중이면 먼저 적용해 이전 실패가 새 선택을 되덮지 않게 한다.
          if (!pendingFontsRef.current) {
            try {
              const settings = await window.api.settings.get();
              if (!pendingFontsRef.current) {
                useFontStore
                  .getState()
                  .setAll(settings.fontSettings.customFonts);
                syncFontCSS();
              }
            } catch (syncError) {
              console.error('Failed to resync font settings:', syncError);
            }
            void window.api.ui.dialog
              .alert(
                t('fontPicker.saveFailed') || '폰트 설정 저장에 실패했습니다.',
                { confirmText: t('common.ok') || '확인' },
              )
              .catch(() => {});
          }
        }
      }
      isPersistingRef.current = false;
    })();
  };

  const isDuplicateFontFamily = (
    fontFamily: string,
    options?: { excludeId?: string | null },
  ) => {
    const normalizedFamily = normalizeFontFamilyName(fontFamily);
    if (!normalizedFamily) return false;

    const allFonts = useFontStore.getState().getAllFonts();
    return allFonts.some((font) => {
      if (options?.excludeId && font.id === options.excludeId) {
        return false;
      }
      return normalizeFontFamilyName(font.name) === normalizedFamily;
    });
  };

  const showDuplicateFontFamilyAlert = (fontFamily: string) => {
    const message =
      t('webFontInput.duplicateFontFamilyAlert', { name: fontFamily }) ||
      `"${fontFamily}" 폰트가 이미 등록되어 있습니다.`;

    void window.api.ui.dialog
      .alert(message, { confirmText: t('common.ok') || '확인' })
      .catch((error) => {
        console.error('Failed to open duplicate font alert:', error);
      });
  };

  const addLocalFont = async () => {
    if (isAddingRef.current) return;
    isAddingRef.current = true;
    try {
      const result = await window.api.font.load();

      if (result.success && result.fontName && result.fontPath) {
        if (isDuplicateFontFamily(result.fontName)) {
          showDuplicateFontFamilyAlert(result.fontName);
          return;
        }

        const newFont: CustomFont = {
          id: generateFontId(),
          type: 'local',
          name: result.fontName,
          displayName: result.fontName,
          enabled: true,
          localPath: result.fontPath,
        };
        const nextFonts = [...useFontStore.getState().customFonts, newFont];
        persistFonts(nextFonts);
      } else if (result.error) {
        console.error('Failed to load font:', result.error);
      }
    } catch (error) {
      console.error('Failed to add local font:', error);
    } finally {
      isAddingRef.current = false;
    }
  };

  // 성공 시 true 반환 (호출부에서 모달 닫기 판단)
  const submitWebFont = (
    css: string,
    displayName: string,
    editingWebFontId: string | null,
  ): boolean => {
    const fontFamily = extractFontFamilyFromCSS(css);
    if (!fontFamily) {
      console.error('Failed to extract font-family from CSS');
      return false;
    }

    if (isDuplicateFontFamily(fontFamily, { excludeId: editingWebFontId })) {
      showDuplicateFontFamilyAlert(fontFamily);
      return false;
    }

    const currentCustomFonts = useFontStore.getState().customFonts;
    const newWebFont: CustomFont = {
      id: generateFontId(),
      type: 'web',
      name: fontFamily,
      displayName: displayName || fontFamily,
      enabled: true,
      cssContent: css,
    };

    const nextFonts: CustomFont[] = editingWebFontId
      ? currentCustomFonts.map((font) =>
          font.id === editingWebFontId
            ? {
                ...font,
                name: fontFamily,
                displayName: displayName || fontFamily,
                cssContent: css,
              }
            : font,
        )
      : [...currentCustomFonts, newWebFont];

    persistFonts(nextFonts);
    return true;
  };

  const removeFont = (id: string) => {
    const nextFonts = useFontStore
      .getState()
      .customFonts.filter((font) => font.id !== id);
    persistFonts(nextFonts);
  };

  const toggleFont = (id: string, enabled: boolean) => {
    const nextFonts = useFontStore
      .getState()
      .customFonts.map((font) =>
        font.id === id ? { ...font, enabled } : font,
      );
    persistFonts(nextFonts);
  };

  // 표시 이름만 변경 (font-family 참조는 유지)
  const renameFont = (id: string, displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    const nextFonts = useFontStore
      .getState()
      .customFonts.map((font) =>
        font.id === id ? { ...font, displayName: trimmed } : font,
      );
    persistFonts(nextFonts);
  };

  return {
    addLocalFont,
    submitWebFont,
    removeFont,
    toggleFont,
    renameFont,
    isDuplicateFontFamily,
  };
};
