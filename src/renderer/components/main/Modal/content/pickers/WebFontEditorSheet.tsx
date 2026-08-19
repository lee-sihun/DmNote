import { Suspense, lazy, useEffect, useState } from 'react';
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
  // 편집 대상 id가 이 창의 목록에 없다(삭제됨·아직 하이드레이션 전). 추가 모드로 흘려보내면
  // 빈 폼이 보이는데 제출은 그 id를 덮어써 기존 폰트를 조용히 지운다 - 열지 않고 실패로 접는다.
  // 마운트 시점에 한 번만 판정한다 - 편집 중 다른 창이 그 폰트를 지워도 쓰던 내용을 걷어가지 않는다
  const [editingTargetMissing] = useState(
    () => editingId != null && editingWebFont === null,
  );

  const failToOpen = (message: string, notice: string, error?: unknown) => {
    console.error(message, error);
    void window.api.ui.dialog
      .alert(notice, { confirmText: t('common.ok') })
      .catch(() => {});
    onDone('failed');
  };

  // 청크를 못 불러오면 창 루트가 아니라 시트만 접는다
  const handleLoadError = (error: unknown) => {
    resetWebFontEditorLoader();
    failToOpen(
      'Failed to load web font editor',
      t('fontPicker.editorLoadFailed'),
      error,
    );
  };

  useEffect(() => {
    if (editingTargetMissing) {
      failToOpen(
        `Web font ${editingId} not found in this window`,
        t('fontPicker.editTargetMissing'),
      );
    }
    // 마운트 판정 한 번 - onDone·t는 그 시점 값을 쓰면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTargetMissing]);

  const handleSubmit = (css: string, displayName: string) => {
    if (fontLibrary.submitWebFont(css, displayName, editingId)) onDone('saved');
  };

  if (editingTargetMissing) return null;

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
