/* eslint-disable react-hooks/refs */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import FullSurfaceModalLayout from '@components/main/Modal/FullSurfaceModalLayout';
import {
  buildDraftPreviewCss,
  validateWebFontFaceCss,
} from '@src/types/settings/fonts';
import type { FontWeightRange } from '@src/types/settings/fonts';
import type { CSSProperties } from 'react';

interface WebFontInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (css: string, displayName: string) => void;
  initialCss?: string;
  isDuplicateFontFamily?: (fontFamily: string) => boolean;
  /** 시트 제목 분기 — 추가/수정 */
  mode?: 'add' | 'edit';
  t: (key: string, options?: Record<string, string>) => string;
}

// 형식 예시 — 코드라 로케일 불필요. 줄 높이 부풀림은 absolute placeholder CSS가 방지
const WEBFONT_PLACEHOLDER_EXAMPLE = `@font-face {\n  font-family: 'FontName';\n  src: url('https://...') format('woff2');\n  font-weight: 400;\n  font-style: normal;\n}`;

// 스페시멘 전용 패밀리 — 등록된 실제 폰트와 충돌하지 않게 초안 이름으로 교체
const DRAFT_PREVIEW_FAMILY = 'DmnWebFontDraftPreview';
const DRAFT_PREVIEW_STYLE_ID = 'webfont-draft-preview';

// 가변 범위는 경계값 + 안쪽 400/700 대표 스톱으로 압축해 행 수를 억제
const expandWeightStops = (ranges: FontWeightRange[]): number[] => {
  const stops = new Set<number>();
  for (const { min, max } of ranges) {
    stops.add(min);
    stops.add(max);
    for (const mid of [400, 700]) {
      if (mid > min && mid < max) stops.add(mid);
    }
  }
  return Array.from(stops).sort((a, b) => a - b);
};

const injectDraftPreviewCSS = (css: string) => {
  const existing = document.getElementById(DRAFT_PREVIEW_STYLE_ID);
  if (existing) {
    existing.textContent = css;
  } else {
    const style = document.createElement('style');
    style.id = DRAFT_PREVIEW_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
};

const removeDraftPreviewCSS = () => {
  document.getElementById(DRAFT_PREVIEW_STYLE_ID)?.remove();
};

const WEBFONT_EDITOR_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.comment, color: '#6A9955' },
  { tag: [tags.string, tags.special(tags.string)], color: '#CE9178' },
  { tag: tags.keyword, color: '#C586C0' },
  { tag: [tags.propertyName], color: '#9CDCFE' },
  { tag: [tags.bracket, tags.punctuation], color: '#D4D4D4' },
]);

// 활성 줄 하이라이트는 제외 — 여러 줄 placeholder가 한 줄에 담겨
// 빈 상태에서 블록 전체가 선택된 것처럼 보임
const WEBFONT_EDITOR_BASE_EXTENSIONS = [
  lineNumbers(),
  history(),
  indentUnit.of('  '),
  css(),
  syntaxHighlighting(WEBFONT_EDITOR_HIGHLIGHT_STYLE),
  EditorView.contentAttributes.of({
    spellcheck: 'false',
    'aria-label': '@font-face CSS input',
  }),
  EditorView.domEventHandlers({
    dragstart: (event) => {
      event.preventDefault();
      return true;
    },
    drop: (event) => {
      event.preventDefault();
      return true;
    },
  }),
] as const;

// 문서 전체를 새 값으로 바꾸고 커서를 앞으로. 같은 값이면 건드리지 않는다
const replaceEditorDoc = (editorView: EditorView, nextValue: string) => {
  const currentValue = editorView.state.doc.toString();
  if (currentValue === nextValue) return;
  editorView.dispatch({
    changes: { from: 0, to: currentValue.length, insert: nextValue },
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
  });
};

const WebFontInputModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialCss = '',
  isDuplicateFontFamily,
  mode = 'add',
  t,
}: WebFontInputModalProps) => {
  const [cssInput, setCssInput] = useState('');
  // 스페시멘 로드 결과 — css 스냅샷 키로 최신 입력과 대조, 굵기별 성패 기록 (loading은 파생)
  const [previewLoad, setPreviewLoad] = useState<{
    css: string;
    loaded: number[];
    failed: number[];
  } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const handleSubmitRef = useRef<() => void>(() => undefined);
  const normalizedInitialCss = initialCss || '';
  // 에디터는 컨테이너가 붙는 순간 만들어지므로 그때의 초기값을 ref로 읽는다
  const initialCssRef = useRef(normalizedInitialCss);
  initialCssRef.current = normalizedInitialCss;

  const trimmedCSS = cssInput.trim();

  const cssValidation = validateWebFontFaceCss(trimmedCSS);

  const extractedFontFamily = cssValidation.detectedFontFamily;

  const hasDuplicateFontFamily = (() => {
    if (cssValidation.status !== 'ready' || !extractedFontFamily) {
      return false;
    }
    return isDuplicateFontFamily?.(extractedFontFamily) ?? false;
  })();

  const canSubmit = cssValidation.status === 'ready' && !hasDuplicateFontFamily;

  // 중복 폰트도 스페시멘은 보여줌 — 저장만 막고 확인은 허용
  const previewActive =
    isOpen && cssValidation.status === 'ready' && !!extractedFontFamily;
  // 일부 굵기만 실패하면 ready 유지 — 실패 행은 스페시멘에서 개별 표시
  const previewStatus: 'idle' | 'loading' | 'ready' | 'error' = !previewActive
    ? 'idle'
    : previewLoad?.css === trimmedCSS
    ? previewLoad.loaded.length > 0
      ? 'ready'
      : 'error'
    : 'loading';
  const weightStops = expandWeightStops(cssValidation.detectedWeights);
  const failedWeights = new Set(
    previewLoad?.css === trimmedCSS ? previewLoad.failed : [],
  );

  const availabilityLabel = (() => {
    if (cssValidation.status === 'ready' && hasDuplicateFontFamily) {
      return (
        t('webFontInput.availabilityDuplicateFontFamily') ||
        '이미 등록된 font-family'
      );
    }

    switch (cssValidation.status) {
      case 'idle':
        return t('webFontInput.availabilityIdle') || '입력 대기';
      case 'ready':
        return t('webFontInput.availabilityReady') || '사용 가능';
      case 'invalidCss':
        return t('webFontInput.availabilityInvalidCss') || '문법 오류';
      case 'missingFontFace':
        return (
          t('webFontInput.availabilityMissingFontFace') || '@font-face 없음'
        );
      case 'missingFontFamily':
        return (
          t('webFontInput.availabilityMissingFontFamily') || 'font-family 없음'
        );
      case 'missingSrc':
        return t('webFontInput.availabilityMissingSrc') || 'src 없음';
      case 'multipleFamilies':
        return (
          t('webFontInput.availabilityMultipleFamilies') || '다중 폰트 감지'
        );
      default:
        return t('webFontInput.availabilityNotReady') || '사용 불가';
    }
  })();

  const sheetTitle =
    mode === 'edit'
      ? t('webFontInput.titleEdit') || '웹 폰트 수정'
      : t('webFontInput.titleAdd') || '웹 폰트 추가';
  const submitButtonLabel = t('webFontInput.submit') || '저장';

  const resetEditorContent = (nextValue = '') => {
    setCssInput(nextValue);
    if (editorViewRef.current)
      replaceEditorDoc(editorViewRef.current, nextValue);
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    onSubmit(trimmedCSS, extractedFontFamily || '');
    resetEditorContent('');
  };

  handleSubmitRef.current = handleSubmit;

  const handleClose = () => {
    resetEditorContent('');
    onClose();
  };

  // 시트 본문은 첫 paint 뒤에 붙는다(FullSurfaceModalLayout after-paint). 마운트 시점
  // 이펙트에서 컨테이너를 찾으면 아직 없어 에디터가 영영 안 만들어지므로, 컨테이너가
  // 실제로 붙고 떨어지는 순간을 ref 콜백으로 받아 거기서 수명을 소유한다.
  // 콜백 정체성이 바뀌면 React가 정리·재부착을 반복하니 의존성 없이 고정한다
  const mountEditor = useCallback((mountNode: HTMLDivElement | null) => {
    if (!mountNode) return;
    const editorView = new EditorView({
      state: EditorState.create({
        doc: initialCssRef.current,
        extensions: [
          ...WEBFONT_EDITOR_BASE_EXTENSIONS,
          placeholder(WEBFONT_PLACEHOLDER_EXAMPLE),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            {
              key: 'Mod-Enter',
              run: () => {
                handleSubmitRef.current();
                return true;
              },
              preventDefault: true,
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setCssInput(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: mountNode,
    });

    editorViewRef.current = editorView;
    editorView.dispatch({
      selection: EditorSelection.cursor(0),
      scrollIntoView: true,
    });

    return () => {
      editorView.destroy();
      if (editorViewRef.current === editorView) {
        editorViewRef.current = null;
      }
    };
  }, []);

  // 초기값이 바뀌면(다른 폰트 편집으로 전환) 입력 상태와 문서를 함께 맞춘다.
  // 에디터가 아직 안 붙었으면 붙을 때 initialCssRef를 읽으므로 상태만 맞춘다
  useLayoutEffect(() => {
    const nextValue = isOpen ? normalizedInitialCss : '';
    setCssInput(nextValue);
    if (editorViewRef.current)
      replaceEditorDoc(editorViewRef.current, nextValue);
  }, [isOpen, normalizedInitialCss]);

  // 스페시멘 로드 — 입력이 잠잠해지면 초안 패밀리로 주입하고 실제 로드를 확인
  useEffect(() => {
    if (!previewActive) {
      removeDraftPreviewCSS();
      return;
    }

    let cancelled = false;
    const cssSnapshot = trimmedCSS;
    const timer = setTimeout(() => {
      // @font-face 블록만 주입 — 블록 밖 규칙이 앱 전역 스타일을 오염시키지 못함
      injectDraftPreviewCSS(
        buildDraftPreviewCss(cssSnapshot, DRAFT_PREVIEW_FAMILY),
      );
      // 선언된 굵기마다 로드 확인 — 스톱별 요청이 각자 가장 가까운 face를 당겨옴
      const stops = expandWeightStops(
        validateWebFontFaceCss(cssSnapshot).detectedWeights,
      );
      const targets = stops.length > 0 ? stops : [400];
      Promise.allSettled(
        targets.map((weight) =>
          document.fonts.load(`${weight} 16px "${DRAFT_PREVIEW_FAMILY}"`),
        ),
      ).then((results) => {
        if (cancelled) return;
        const loaded: number[] = [];
        const failed: number[] = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            loaded.push(targets[index]);
          } else {
            failed.push(targets[index]);
          }
        });
        setPreviewLoad({ css: cssSnapshot, loaded, failed });
      });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewActive, trimmedCSS]);

  // 언마운트 시 초안 스타일 잔류 방지
  useEffect(() => () => removeDraftPreviewCSS(), []);

  if (!isOpen) return null;

  const specimenFontFamily = `'${DRAFT_PREVIEW_FAMILY}'`;
  const pangramText =
    t('webFontInput.previewPangram') || '다람쥐 헌 쳇바퀴에 타고파';
  const singleWeight = weightStops.length === 1;
  // font-synthesis 차단 — 없는 굵기를 가짜 볼드로 합성하지 않아 실제 로드 결과가 그대로 보임
  const specimenTextStyle = (weight: number): CSSProperties => ({
    fontFamily: specimenFontFamily,
    fontWeight: weight,
    fontSynthesis: 'none',
  });

  return (
    <FullSurfaceModalLayout
      onClose={handleClose}
      title={sheetTitle}
      submitLabel={submitButtonLabel}
      submitDisabled={!canSubmit}
      onSubmit={handleSubmit}
      cancelLabel={t('common.cancel') || '취소'}
    >
      {/* 본문 — 입력(에디터)과 결과(스페시멘) 섹션 카드를 나란히 (사이드 패널 문법) */}
      <div className="flex-1 min-h-0 flex gap-[12px]">
        {/* CSS 입력 섹션 */}
        <div className="flex-[5] min-w-0 bg-fill-faint rounded-surface p-[10px] flex flex-col gap-[8px]">
          <div className="shrink-0 px-[2px]">
            <p className="text-caption text-fg-faint">
              {t('webFontInput.cssLabel') || '@font-face CSS'}
            </p>
          </div>
          <div
            data-webfont-editor-surface="true"
            className="flex-1 min-h-0 rounded-md bg-glass-dim backdrop-glass-popup overflow-hidden"
          >
            <div ref={mountEditor} className="h-full webfont-cm-editor" />
          </div>
        </div>

        {/* 미리보기 섹션 — 검증 상태는 결과 옆이 제자리, 색은 무채색 유지 */}
        <div className="flex-[3] min-w-[220px] max-w-[340px] bg-fill-faint rounded-surface p-[10px] flex flex-col gap-[8px]">
          <div className="shrink-0 flex items-center justify-between gap-[8px] px-[2px]">
            <p className="text-caption text-fg-faint">
              {t('webFontInput.previewLabel') || '미리보기'}
            </p>
            <span role="status" className="text-caption text-fg-muted truncate">
              {availabilityLabel}
            </span>
          </div>
          {/* 로드 상태 발표 전용 — 스페시멘은 라이브 영역 밖에 둬서 통짜 낭독을 피함 */}
          <p role="status" className="sr-only">
            {previewStatus === 'loading'
              ? t('webFontInput.previewLoading') || '폰트 불러오는 중…'
              : previewStatus === 'error'
              ? t('webFontInput.previewError') || '폰트를 불러오지 못했습니다'
              : previewStatus === 'ready'
              ? t('webFontInput.previewReady') || '폰트 미리보기 준비됨'
              : ''}
          </p>
          {/* 패딩은 스크롤 컨테이너 안쪽 소유 — 웰에 두면 스크롤 시 위아래 죽은 띠가 생김 */}
          <div className="flex-1 min-h-0 min-w-0 rounded-md bg-inset flex flex-col justify-center overflow-hidden">
            {previewStatus === 'ready' ? (
              /* 스크롤 페이드와 등장 모션은 animation 충돌로 분리 — 바깥이 스크롤, 안쪽이 모션 */
              <div
                key={extractedFontFamily}
                className="min-w-0 max-h-full overflow-y-auto modal-content-scroll dmn-scroll-fade px-[16px] py-[12px]"
              >
                <div className="min-w-0">
                  <p
                    className="text-[28px] leading-[36px] text-fg break-words"
                    style={{ fontFamily: specimenFontFamily }}
                  >
                    {extractedFontFamily}
                  </p>
                  <div className="mt-[24px] flex flex-col gap-[6px] text-[14px] leading-[21px] text-fg-muted">
                    {weightStops.map((weight) => (
                      <div
                        key={weight}
                        className="min-w-0 flex items-baseline gap-[6px]"
                      >
                        <span className="shrink-0 w-[30px] text-caption text-fg-faint tabular-nums">
                          {weight}
                        </span>
                        {failedWeights.has(weight) ? (
                          <span className="text-caption text-danger-fg">
                            {t('webFontInput.weightLoadFailed') || '로드 실패'}
                          </span>
                        ) : (
                          <p
                            className="flex-1 min-w-0 truncate"
                            style={specimenTextStyle(weight)}
                          >
                            {singleWeight
                              ? pangramText
                              : `${pangramText} AaBb 09`}
                          </p>
                        )}
                      </div>
                    ))}
                    {singleWeight && !failedWeights.has(weightStops[0]) && (
                      <>
                        <p
                          className="pl-[36px] truncate"
                          style={specimenTextStyle(weightStops[0])}
                        >
                          AaBb CcDd EeFf GgHh
                        </p>
                        <p
                          className="pl-[36px] truncate tabular-nums"
                          style={specimenTextStyle(weightStops[0])}
                        >
                          0123456789 · 99.9% · 300ms
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : previewStatus === 'error' ? (
              <div className="flex flex-col gap-[4px] text-center px-[16px]">
                <p className="text-label text-fg">
                  {t('webFontInput.previewError') ||
                    '폰트를 불러오지 못했습니다'}
                </p>
                <p className="text-caption text-fg-muted">
                  {t('webFontInput.previewErrorHint') || 'src URL을 확인하세요'}
                </p>
              </div>
            ) : (
              <p
                className={`text-caption text-fg-muted text-center px-[16px] ${
                  previewStatus === 'loading' ? 'animate-pulse' : ''
                }`}
              >
                {previewStatus === 'loading'
                  ? t('webFontInput.previewLoading') || '폰트 불러오는 중…'
                  : t('webFontInput.previewEmpty') ||
                    '유효한 @font-face를 입력하면 미리보기가 표시됩니다'}
              </p>
            )}
          </div>
        </div>
      </div>
    </FullSurfaceModalLayout>
  );
};

export default WebFontInputModal;
