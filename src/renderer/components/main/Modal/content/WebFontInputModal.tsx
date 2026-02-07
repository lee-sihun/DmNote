import { useState, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import Modal from "@components/main/Modal/Modal";
import { validateWebFontFaceCss } from "@src/types/fonts";

interface WebFontInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (css: string, displayName: string) => void;
  initialCss?: string;
  isDuplicateFontFamily?: (fontFamily: string) => boolean;
  t: (key: string, options?: Record<string, string>) => string;
}

const WEBFONT_EDITOR_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.comment, color: "#6A9955" },
  { tag: [tags.string, tags.special(tags.string)], color: "#CE9178" },
  { tag: tags.keyword, color: "#C586C0" },
  { tag: [tags.propertyName], color: "#9CDCFE" },
  { tag: [tags.bracket, tags.punctuation], color: "#D4D4D4" },
]);

const WEBFONT_EDITOR_BASE_EXTENSIONS = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  history(),
  indentUnit.of("  "),
  css(),
  syntaxHighlighting(WEBFONT_EDITOR_HIGHLIGHT_STYLE),
  EditorView.contentAttributes.of({
    spellcheck: "false",
    "aria-label": "@font-face CSS input",
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

export default function WebFontInputModal({
  isOpen,
  onClose,
  onSubmit,
  initialCss = "",
  isDuplicateFontFamily,
  t,
}: WebFontInputModalProps) {
  const [cssInput, setCssInput] = useState("");
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const handleSubmitRef = useRef<() => void>(() => undefined);
  const normalizedInitialCss = initialCss || "";

  const trimmedCSS = cssInput.trim();

  const cssValidation = useMemo(
    () => validateWebFontFaceCss(trimmedCSS),
    [trimmedCSS],
  );

  const extractedFontFamily = cssValidation.detectedFontFamily;

  const hasDuplicateFontFamily = useMemo(() => {
    if (cssValidation.status !== "ready" || !extractedFontFamily) {
      return false;
    }
    return isDuplicateFontFamily?.(extractedFontFamily) ?? false;
  }, [cssValidation.status, extractedFontFamily, isDuplicateFontFamily]);

  const canSubmit = cssValidation.status === "ready" && !hasDuplicateFontFamily;

  const detectedFontFileName = useMemo(() => {
    const defaultFileName = t("webFontInput.defaultFileName") || "web-font";
    return extractedFontFamily || defaultFileName;
  }, [extractedFontFamily, t]);

  const availabilityLabel = useMemo(() => {
    if (cssValidation.status === "ready" && hasDuplicateFontFamily) {
      return (
        t("webFontInput.availabilityDuplicateFontFamily") ||
        "이미 등록된 font-family"
      );
    }

    switch (cssValidation.status) {
      case "idle":
        return t("webFontInput.availabilityIdle") || "입력 대기";
      case "ready":
        return t("webFontInput.availabilityReady") || "사용 가능";
      case "invalidCss":
        return t("webFontInput.availabilityInvalidCss") || "문법 오류";
      case "missingFontFace":
        return t("webFontInput.availabilityMissingFontFace") || "@font-face 없음";
      case "missingFontFamily":
        return t("webFontInput.availabilityMissingFontFamily") || "font-family 없음";
      case "missingSrc":
        return t("webFontInput.availabilityMissingSrc") || "src 없음";
      case "multipleFamilies":
        return (
          t("webFontInput.availabilityMultipleFamilies") ||
          "다중 폰트 감지"
        );
      default:
        return t("webFontInput.availabilityNotReady") || "사용 불가";
    }
  }, [cssValidation.status, hasDuplicateFontFamily, t]);

  const fixedHintMessage =
    t("webFontInput.fixedHint") || "@font-face CSS를 추가할 수 있습니다.";
  const submitButtonLabel = t("webFontInput.submit") || "저장";

  const placeholderText = useMemo(
    () =>
      `${t("webFontInput.cssLabel") || "@font-face CSS"}\n\n@font-face {\n  font-family: 'FontName';\n  src: url('https://...') format('woff2');\n  font-weight: 400;\n  font-style: normal;\n}`,
    [t],
  );

  const resetEditorContent = useCallback((nextValue = "") => {
    setCssInput(nextValue);

    const editorView = editorViewRef.current;
    if (!editorView) return;

    const currentValue = editorView.state.doc.toString();
    if (currentValue === nextValue) return;

    editorView.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: nextValue,
      },
      selection: EditorSelection.cursor(0),
      scrollIntoView: true,
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }

    onSubmit(trimmedCSS, extractedFontFamily || "");
    resetEditorContent("");
  }, [canSubmit, extractedFontFamily, onSubmit, resetEditorContent, trimmedCSS]);

  handleSubmitRef.current = handleSubmit;

  const handleClose = useCallback(() => {
    resetEditorContent("");
    onClose();
  }, [onClose, resetEditorContent]);

  useLayoutEffect(() => {
    if (!isOpen) {
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
      }
      setCssInput("");
      return;
    }

    setCssInput(normalizedInitialCss);

    const mountNode = editorContainerRef.current;
    if (!mountNode) return;

    const nextState = EditorState.create({
      doc: normalizedInitialCss,
      extensions: [
        ...WEBFONT_EDITOR_BASE_EXTENSIONS,
        placeholder(placeholderText),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: "Mod-Enter",
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
    });

    const editorView = new EditorView({
      state: nextState,
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
  }, [isOpen, normalizedInitialCss, placeholderText]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const editorView = editorViewRef.current;
    if (!editorView) return;

    const currentValue = editorView.state.doc.toString();
    if (currentValue === normalizedInitialCss) return;

    editorView.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: normalizedInitialCss,
      },
      selection: EditorSelection.cursor(0),
      scrollIntoView: true,
    });
    setCssInput(normalizedInitialCss);
  }, [isOpen, normalizedInitialCss]);

  if (!isOpen) return null;

  return (
    <Modal onClick={handleClose}>
      <div
        className="w-[640px] max-w-[calc(100vw-80px)] flex flex-col bg-[#1A191E] rounded-[10px] border border-[#2A2A30] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[37px] bg-[#2A2A30] border-b border-[#3A3943] px-[12px] flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-[8px]">
            <span className="px-[6px] h-[18px] rounded-[4px] border border-[#3A3943] bg-[#1A191E] text-[10px] leading-[18px] font-semibold tracking-[0.2px] text-[#8CC2FF]">
              CSS
            </span>
            <span className="truncate text-[12px] leading-[16px] text-[#DBDEE8]">
              {detectedFontFileName}
            </span>
          </div>
          <span className="text-[11px] leading-[14px] text-[#8A8D99]">
            {availabilityLabel}
          </span>
        </div>

        <div className="p-[12px] pb-[0px]">
          <div className="w-full h-[220px] rounded-[8px] border border-[#3A3943] bg-[#1E1E1E] overflow-hidden">
            <div
              ref={editorContainerRef}
              className="h-full webfont-cm-editor"
            />
          </div>
        </div>

        <div className="h-[28px] mt-[10px] bg-[#2A2A30] border-t border-[#3A3943] px-[12px] flex items-center justify-between gap-[12px]">
          <p className="truncate text-[11px] leading-[14px] text-[#8A8D99]">
            {fixedHintMessage}
          </p>
          <p className="shrink-0 text-[11px] leading-[14px] text-[#8A8D99]">
            Ctrl/Cmd + Enter
          </p>
        </div>

        <div className="bg-[#1A191E] border-t border-[#2A2A30] px-[12px] py-[10px] flex items-center justify-end gap-[10.5px]">
          <button
            className={`w-[120px] h-[30px] rounded-[7px] text-style-3 text-[#DCDEE7] transition-colors ${
              canSubmit
                ? "bg-[#2A2A30] hover:bg-[#34343c]"
                : "bg-[#222228] cursor-not-allowed opacity-50"
            }`}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitButtonLabel}
          </button>
          <button
            className="px-[24px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3 transition-colors"
            onClick={handleClose}
          >
            {t("common.cancel") || "취소"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
