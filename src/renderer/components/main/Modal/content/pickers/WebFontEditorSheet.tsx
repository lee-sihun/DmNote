import { Suspense, lazy, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore } from '@stores/useFontStore';
import { useFontLibrary } from '@hooks/useFontLibrary';
import RenderErrorBoundary from '@components/main/common/RenderErrorBoundary';
import {
  importWebFontInputModal,
  resetWebFontEditorLoader,
} from './webFontEditorLoader';

type WebFontEditorOutcome = 'saved' | 'cancelled' | 'failed';

interface WebFontEditorSheetProps {
  // 편집할 웹폰트 id. null이면 새로 추가
  editingId: string | null;
  // 닫히는 이유. saved면 폰트가 이미 라이브러리에 저장된 뒤다
  onDone: (outcome: WebFontEditorOutcome) => void;
}

/**
 * 웹폰트 편집 시트의 수명을 소유한다 - 청크 지연 로드, 로드 실패 경계, 저장.
 * 열려 있는 동안만 마운트한다. 도킹 피커는 자기 창에서, 분리 패널은 메인 호스트가 띄운다
 */
const WebFontEditorSheet = ({ editingId, onDone }: WebFontEditorSheetProps) => {
  const { t } = useTranslation();
  const fontLibrary = useFontLibrary();
  const { customFonts } = useFontStore();
  // 청크 로드가 실패하면 lazy는 그 실패를 영구히 기억한다. 마운트마다 새 래퍼를 만들고
  // 실패 시 import 프라미스도 비워야 다음 열기가 새로 시도한다
  const [LazyWebFontInputModal] = useState(() => lazy(importWebFontInputModal));

  const editingWebFont =
    editingId != null
      ? customFonts.find(
          (font) => font.type === 'web' && font.id === editingId,
        ) ?? null
      : null;

  // 청크를 못 불러오면 창 루트가 아니라 시트만 접는다
  const handleLoadError = (error: unknown) => {
    console.error('Failed to load web font editor', error);
    resetWebFontEditorLoader();
    void window.api.ui.dialog
      .alert(t('fontPicker.editorLoadFailed'), {
        confirmText: t('common.ok'),
      })
      .catch(() => {});
    onDone('failed');
  };

  const handleSubmit = (css: string, displayName: string) => {
    if (fontLibrary.submitWebFont(css, displayName, editingId)) onDone('saved');
  };

  return (
    <RenderErrorBoundary onError={handleLoadError}>
      <Suspense fallback={null}>
        <LazyWebFontInputModal
          isOpen
          onClose={() => onDone('cancelled')}
          onSubmit={handleSubmit}
          initialCss={editingWebFont?.cssContent || ''}
          mode={editingWebFont ? 'edit' : 'add'}
          isDuplicateFontFamily={(fontFamily) =>
            fontLibrary.isDuplicateFontFamily(fontFamily, {
              excludeId: editingId,
            })
          }
          t={t}
        />
      </Suspense>
    </RenderErrorBoundary>
  );
};

export default WebFontEditorSheet;
