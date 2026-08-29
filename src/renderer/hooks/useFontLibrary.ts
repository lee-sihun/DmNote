import { useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore, syncFontCSS } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/settings/fonts';
import {
  generateFontId,
  normalizeFontFamilyName,
  validateWebFontFaceCss,
} from '@src/types/settings/fonts';
import { settingsApi } from '@api/modules/settingsApi';
import { fontApi } from '@api/modules/resourceApi';
import { canLoadFont } from '@utils/core/assetProbe';

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
          await settingsApi.update({
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

  const showInvalidFontAlert = () => {
    void window.api.ui.dialog
      .alert(t('fontPicker.invalidFont'), {
        confirmText: t('common.ok') || '확인',
      })
      .catch((error) => {
        console.error('Failed to open invalid font alert:', error);
      });
  };

  const showFontFamilyChangeAlert = () => {
    void window.api.ui.dialog
      .alert(t('webFontInput.familyChangeNotAllowed'), {
        confirmText: t('common.ok') || '확인',
      })
      .catch((error) => {
        console.error('Failed to open font-family change alert:', error);
      });
  };

  const addLocalFont = async () => {
    if (isAddingRef.current) return;
    isAddingRef.current = true;
    try {
      const result = await fontApi.load();

      if (result.success && result.fontName && result.fontPath) {
        const normalizedFamily = normalizeFontFamilyName(result.fontName);
        const matchingFonts = useFontStore
          .getState()
          .getAllFonts()
          .filter(
            (font) => normalizeFontFamilyName(font.name) === normalizedFamily,
          );
        if (matchingFonts.some((font) => font.type !== 'local')) {
          showDuplicateFontFamilyAlert(result.fontName);
          return;
        }

        // 시그니처를 통과해도 브라우저가 못 쓰는 폰트가 있다. 목록에 넣기 전에 확인한다
        if (!(await canLoadFont(result.fontPath))) {
          showInvalidFontAlert();
          return;
        }

        const existingLocalFont = matchingFonts.find(
          (font) => font.type === 'local',
        );

        const newFont: CustomFont = {
          id: generateFontId(),
          type: 'local',
          name: result.fontName,
          displayName: existingLocalFont?.displayName ?? result.fontName,
          enabled: existingLocalFont?.enabled ?? true,
          localPath: result.fontPath,
          weightRanges:
            result.weightRanges && result.weightRanges.length > 0
              ? result.weightRanges
              : [{ min: 400, max: 400 }],
        };
        const newRanges = JSON.stringify(newFont.weightRanges);
        const nextFonts = [
          ...useFontStore.getState().customFonts.filter((font) => {
            if (
              font.type !== 'local' ||
              normalizeFontFamilyName(font.name) !== normalizedFamily
            ) {
              return true;
            }
            const ranges =
              font.weightRanges && font.weightRanges.length > 0
                ? font.weightRanges
                : [{ min: 400, max: 400 }];
            return JSON.stringify(ranges) !== newRanges;
          }),
          newFont,
        ];
        persistFonts(nextFonts);
      } else if (result.errorCode) {
        // errorCode가 없는 실패는 사용자 취소
        console.error('Failed to load font:', result.error ?? result.errorCode);
        showInvalidFontAlert();
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
    const validation = validateWebFontFaceCss(css);
    const fontFamily = validation.detectedFontFamily;
    if (!fontFamily) {
      console.error('Failed to extract font-family from CSS');
      return false;
    }

    if (isDuplicateFontFamily(fontFamily, { excludeId: editingWebFontId })) {
      showDuplicateFontFamilyAlert(fontFamily);
      return false;
    }

    const currentCustomFonts = useFontStore.getState().customFonts;
    const editingWebFont = editingWebFontId
      ? currentCustomFonts.find(
          (font) => font.id === editingWebFontId && font.type === 'web',
        )
      : null;
    if (editingWebFont && editingWebFont.name !== fontFamily) {
      showFontFamilyChangeAlert();
      return false;
    }
    const newWebFont: CustomFont = {
      id: generateFontId(),
      type: 'web',
      name: fontFamily,
      displayName: displayName || fontFamily,
      enabled: true,
      cssContent: css,
      weightRanges: validation.detectedWeights,
    };

    const nextFonts: CustomFont[] = editingWebFontId
      ? currentCustomFonts.map((font) =>
          font.id === editingWebFontId
            ? {
                ...font,
                name: fontFamily,
                displayName: displayName || fontFamily,
                cssContent: css,
                weightRanges: validation.detectedWeights,
              }
            : font,
        )
      : [...currentCustomFonts, newWebFont];

    persistFonts(nextFonts);
    return true;
  };

  const removeFont = (id: string) => {
    const currentFonts = useFontStore.getState().customFonts;
    const target = currentFonts.find((font) => font.id === id);
    const targetFamily = target ? normalizeFontFamilyName(target.name) : '';
    const nextFonts = currentFonts.filter(
      (font) =>
        font.id !== id &&
        !(
          target?.type === 'local' &&
          font.type === 'local' &&
          normalizeFontFamilyName(font.name) === targetFamily
        ),
    );
    persistFonts(nextFonts);
  };

  const toggleFont = (id: string, enabled: boolean) => {
    const currentFonts = useFontStore.getState().customFonts;
    const target = currentFonts.find((font) => font.id === id);
    const targetFamily = target ? normalizeFontFamilyName(target.name) : '';
    const nextFonts = currentFonts.map((font) =>
      font.id === id ||
      (target?.type === 'local' &&
        font.type === 'local' &&
        normalizeFontFamilyName(font.name) === targetFamily)
        ? { ...font, enabled }
        : font,
    );
    persistFonts(nextFonts);
  };

  // 표시 이름만 변경 (font-family 참조는 유지)
  const renameFont = (id: string, displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    const currentFonts = useFontStore.getState().customFonts;
    const target = currentFonts.find((font) => font.id === id);
    const targetFamily = target ? normalizeFontFamilyName(target.name) : '';
    const nextFonts = currentFonts.map((font) =>
      font.id === id ||
      (target?.type === 'local' &&
        font.type === 'local' &&
        normalizeFontFamilyName(font.name) === targetFamily)
        ? { ...font, displayName: trimmed }
        : font,
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
