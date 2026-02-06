import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
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

const COMMENT_TOKEN_PREFIX = "___DMN_COMMENT_";
const STRING_TOKEN_PREFIX = "___DMN_STRING_";
const COMMENT_TOKEN_REGEX = /___DMN_COMMENT_(\d+)___/g;
const STRING_TOKEN_REGEX = /___DMN_STRING_(\d+)___/g;
const CSS_PROPERTY_REGEX = /(^|\n)(\s*)([a-z-]+)(\s*:)/g;
const CSS_AT_RULE_REGEX = /(^|[\s{;])(@[a-zA-Z-]+)/g;
const CSS_STRING_REGEX = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const CSS_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;
const CSS_BRACE_REGEX = /([{}])/g;
const INDENT_UNIT = "  ";

function countLinesUntilIndex(text: string, endExclusive: number): number {
  let line = 1;
  const safeEnd = Math.max(0, Math.min(endExclusive, text.length));
  for (let index = 0; index < safeEnd; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function getLineStartIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  return text.lastIndexOf("\n", index - 1) + 1;
}

function getLineEndIndex(text: string, from: number): number {
  const nextNewLineIndex = text.indexOf("\n", from);
  return nextNewLineIndex === -1 ? text.length : nextNewLineIndex;
}

function getIndentRemovalCount(line: string): number {
  if (!line) return 0;
  if (line.startsWith("\t")) {
    return 1;
  }

  let leadingSpaceCount = 0;
  while (
    leadingSpaceCount < INDENT_UNIT.length &&
    leadingSpaceCount < line.length &&
    line.charAt(leadingSpaceCount) === " "
  ) {
    leadingSpaceCount += 1;
  }
  return leadingSpaceCount;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightCssToHtml(source: string): string {
  if (!source) return "";

  let highlighted = escapeHtml(source);
  const comments: string[] = [];
  const strings: string[] = [];

  highlighted = highlighted.replace(CSS_COMMENT_REGEX, (match) => {
    const token = `${COMMENT_TOKEN_PREFIX}${comments.length}___`;
    comments.push(`<span style="color:#6A9955">${match}</span>`);
    return token;
  });

  highlighted = highlighted.replace(CSS_STRING_REGEX, (match) => {
    const token = `${STRING_TOKEN_PREFIX}${strings.length}___`;
    strings.push(`<span style="color:#CE9178">${match}</span>`);
    return token;
  });

  highlighted = highlighted.replace(
    CSS_AT_RULE_REGEX,
    (_match, prefix, atRule: string) =>
      `${prefix}<span style="color:#C586C0">${atRule}</span>`,
  );

  highlighted = highlighted.replace(
    CSS_PROPERTY_REGEX,
    (_match, start, indent, property, colon) =>
      `${start}${indent}<span style="color:#9CDCFE">${property}</span>${colon}`,
  );

  highlighted = highlighted.replace(
    CSS_BRACE_REGEX,
    '<span style="color:#D7BA7D">$1</span>',
  );

  highlighted = highlighted.replace(
    STRING_TOKEN_REGEX,
    (_match, index) => strings[Number(index)] || "",
  );

  highlighted = highlighted.replace(
    COMMENT_TOKEN_REGEX,
    (_match, index) => comments[Number(index)] || "",
  );

  return highlighted;
}

export default function WebFontInputModal({
  isOpen,
  onClose,
  onSubmit,
  initialCss = "",
  isDuplicateFontFamily,
  t,
}: WebFontInputModalProps) {
  const [cssInput, setCssInput] = useState("");
  const [activeLine, setActiveLine] = useState(1);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const lineNumberTrackRef = useRef<HTMLDivElement | null>(null);
  const codeTrackRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorSyncRafRef = useRef<number | null>(null);
  const hasEditorContent = cssInput.length > 0;
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

  const editorLineCount = useMemo(
    () => Math.max(cssInput.split("\n").length, 8),
    [cssInput],
  );

  const lineNumbers = useMemo(
    () => Array.from({ length: editorLineCount }, (_, index) => index + 1),
    [editorLineCount],
  );

  const highlightedCss = useMemo(() => highlightCssToHtml(cssInput), [cssInput]);

  const syncLineNumberScroll = useCallback((scrollTop: number) => {
    if (lineNumberTrackRef.current) {
      lineNumberTrackRef.current.style.transform = `translateY(-${scrollTop}px)`;
    }
  }, []);

  const syncCodeTrackScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    if (codeTrackRef.current) {
      codeTrackRef.current.style.transform = `translate(${-scrollLeft}px, -${scrollTop}px)`;
    }
  }, []);

  const syncViewportFromTarget = useCallback(
    (target: HTMLTextAreaElement) => {
      syncLineNumberScroll(target.scrollTop);
      syncCodeTrackScroll(target.scrollTop, target.scrollLeft);
    },
    [syncCodeTrackScroll, syncLineNumberScroll],
  );

  const updateActiveLineFromTarget = useCallback((target: HTMLTextAreaElement) => {
    const cursorPosition = target.selectionStart ?? 0;
    const line = countLinesUntilIndex(target.value, cursorPosition);
    setActiveLine(line);
  }, []);

  const scheduleCursorSyncFromActiveTextarea = useCallback(() => {
    if (cursorSyncRafRef.current !== null) return;

    cursorSyncRafRef.current = requestAnimationFrame(() => {
      cursorSyncRafRef.current = null;
      const target = textareaRef.current;
      if (!target || document.activeElement !== target) return;
      updateActiveLineFromTarget(target);
      syncViewportFromTarget(target);
    });
  }, [syncViewportFromTarget, updateActiveLineFromTarget]);

  const applyTabIndentation = useCallback(
    (target: HTMLTextAreaElement, shouldOutdent: boolean) => {
      const value = target.value;
      const selectionStart = target.selectionStart ?? 0;
      const selectionEnd = target.selectionEnd ?? selectionStart;

      const applyValueAndSelection = (
        nextValue: string,
        nextSelectionStart: number,
        nextSelectionEnd: number,
      ) => {
        setCssInput(nextValue);
        requestAnimationFrame(() => {
          const activeTextarea = textareaRef.current;
          if (!activeTextarea) return;
          activeTextarea.selectionStart = nextSelectionStart;
          activeTextarea.selectionEnd = nextSelectionEnd;
          updateActiveLineFromTarget(activeTextarea);
          syncViewportFromTarget(activeTextarea);
        });
      };

      if (selectionStart === selectionEnd) {
        if (!shouldOutdent) {
          const nextValue =
            value.slice(0, selectionStart) +
            INDENT_UNIT +
            value.slice(selectionEnd);
          const nextCursorPosition = selectionStart + INDENT_UNIT.length;
          applyValueAndSelection(nextValue, nextCursorPosition, nextCursorPosition);
          return;
        }

        const lineStart = getLineStartIndex(value, selectionStart);
        const lineEnd = getLineEndIndex(value, lineStart);
        const currentLine = value.slice(lineStart, lineEnd);
        const removableIndentCount = getIndentRemovalCount(currentLine);
        if (removableIndentCount === 0) {
          return;
        }

        const nextLine = currentLine.slice(removableIndentCount);
        const nextValue =
          value.slice(0, lineStart) +
          nextLine +
          value.slice(lineEnd);
        const nextCursorPosition = Math.max(
          lineStart,
          selectionStart - removableIndentCount,
        );
        applyValueAndSelection(nextValue, nextCursorPosition, nextCursorPosition);
        return;
      }

      const firstLineStart = getLineStartIndex(value, selectionStart);
      let effectiveSelectionEnd = selectionEnd;
      if (
        effectiveSelectionEnd > selectionStart &&
        value.charCodeAt(effectiveSelectionEnd - 1) === 10
      ) {
        effectiveSelectionEnd -= 1;
      }

      const lastLineEnd = getLineEndIndex(
        value,
        Math.max(firstLineStart, effectiveSelectionEnd),
      );
      const selectedBlock = value.slice(firstLineStart, lastLineEnd);
      const lines = selectedBlock.split("\n");

      let firstLineDelta = 0;
      let totalDelta = 0;

      const nextBlock = lines
        .map((line, index) => {
          if (shouldOutdent) {
            const removableIndentCount = getIndentRemovalCount(line);
            if (index === 0) {
              firstLineDelta = -removableIndentCount;
            }
            totalDelta -= removableIndentCount;
            return line.slice(removableIndentCount);
          }

          if (index === 0) {
            firstLineDelta = INDENT_UNIT.length;
          }
          totalDelta += INDENT_UNIT.length;
          return `${INDENT_UNIT}${line}`;
        })
        .join("\n");

      if (nextBlock === selectedBlock) {
        return;
      }

      const nextValue =
        value.slice(0, firstLineStart) +
        nextBlock +
        value.slice(lastLineEnd);
      const nextSelectionStart = Math.max(
        firstLineStart,
        selectionStart + firstLineDelta,
      );
      const nextSelectionEnd = Math.max(
        nextSelectionStart,
        selectionEnd + totalDelta,
      );
      applyValueAndSelection(nextValue, nextSelectionStart, nextSelectionEnd);
    },
    [syncViewportFromTarget, updateActiveLineFromTarget],
  );

  const resetEditorViewport = useCallback(() => {
    const target = textareaRef.current;
    if (target) {
      target.scrollTop = 0;
      target.scrollLeft = 0;
      syncViewportFromTarget(target);
      return;
    }
    syncLineNumberScroll(0);
    syncCodeTrackScroll(0, 0);
  }, [syncCodeTrackScroll, syncLineNumberScroll, syncViewportFromTarget]);

  const resetEditorState = useCallback(
    ({ clearInput = false }: { clearInput?: boolean } = {}) => {
      if (clearInput) {
        setCssInput("");
      }
      setActiveLine(1);
      setIsEditorFocused(false);
      resetEditorViewport();
    },
    [resetEditorViewport],
  );

  const setTextareaElement = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (!node) return;
      syncViewportFromTarget(node);
    },
    [syncViewportFromTarget],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    return () => {
      if (cursorSyncRafRef.current !== null) {
        cancelAnimationFrame(cursorSyncRafRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const nextCss = initialCss || "";
    setCssInput(nextCss);
    setActiveLine(1);
    setIsEditorFocused(false);
    resetEditorViewport();

    const target = textareaRef.current;
    if (!target) return;

    const rafId = requestAnimationFrame(() => {
      target.scrollTop = 0;
      target.scrollLeft = 0;
      updateActiveLineFromTarget(target);
      syncViewportFromTarget(target);
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    initialCss,
    isOpen,
    resetEditorViewport,
    syncViewportFromTarget,
    updateActiveLineFromTarget,
  ]);

  useEffect(() => {
    return () => {
      if (cursorSyncRafRef.current !== null) {
        cancelAnimationFrame(cursorSyncRafRef.current);
      }
    };
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }

    onSubmit(trimmedCSS, extractedFontFamily || "");
    resetEditorState({ clearInput: true });
  }, [canSubmit, extractedFontFamily, onSubmit, resetEditorState, trimmedCSS]);

  const handleClose = useCallback(() => {
    resetEditorState({ clearInput: true });
    onClose();
  }, [onClose, resetEditorState]);

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
          <div className="w-full h-[220px] rounded-[8px] border border-[#3A3943] bg-[#1A191E] overflow-hidden flex">
            <div className="w-[48px] shrink-0 bg-[#23232A] border-r border-[#3A3943] overflow-hidden">
              <div
                ref={lineNumberTrackRef}
                className="pt-[10px] pb-[10px] pr-[14px] text-right text-[12px] leading-[22px] text-[#6F6E7A] select-none font-mono tabular-nums will-change-transform"
              >
                {lineNumbers.map((line) => (
                  <div
                    key={line}
                    className={`h-[22px] ${
                      isEditorFocused && line === activeLine ? "text-[#DBDEE8]" : ""
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden">
              <div className="absolute inset-0 z-[6] pointer-events-none overflow-hidden">
                <div
                  ref={codeTrackRef}
                  className="w-max min-w-full min-h-full will-change-transform"
                  style={{ transform: "translate(0px, 0px)" }}
                >
                  {hasEditorContent ? (
                    <pre
                      aria-hidden
                      className="m-0 px-0 py-0 text-[12px] leading-[22px] font-mono text-[#DBDEE8] whitespace-pre"
                    >
                      <code
                        className="block min-w-full pl-[15px] pr-[12px] py-[10px]"
                        dangerouslySetInnerHTML={{
                          __html: `${highlightedCss}\n`,
                        }}
                      />
                    </pre>
                  ) : null}
                </div>
              </div>

              <textarea
                ref={setTextareaElement}
                value={cssInput}
                onChange={(event) => {
                  setCssInput(event.target.value);
                  updateActiveLineFromTarget(event.currentTarget);
                  syncViewportFromTarget(event.currentTarget);
                }}
                onScroll={(event) => {
                  syncViewportFromTarget(event.currentTarget);
                }}
                onFocus={(event) => {
                  setIsEditorFocused(true);
                  updateActiveLineFromTarget(event.currentTarget);
                  syncViewportFromTarget(event.currentTarget);
                }}
                onBlur={() => {
                  setIsEditorFocused(false);
                }}
                onSelect={() => {
                  scheduleCursorSyncFromActiveTextarea();
                }}
                onClick={() => {
                  scheduleCursorSyncFromActiveTextarea();
                }}
                onKeyUp={() => {
                  scheduleCursorSyncFromActiveTextarea();
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    handleSubmit();
                    return;
                  }

                  if (event.key === "Tab") {
                    event.preventDefault();
                    applyTabIndentation(event.currentTarget, event.shiftKey);
                    return;
                  }

                  scheduleCursorSyncFromActiveTextarea();
                }}
                placeholder={`${t("webFontInput.cssLabel") || "@font-face CSS"}

@font-face {
  font-family: 'FontName';
  src: url('https://...') format('woff2');
  font-weight: 400;
  font-style: normal;
}`}
                aria-label="@font-face CSS input"
                wrap="off"
                className="absolute inset-0 z-10 pl-[15px] pr-[12px] py-[10px] bg-transparent text-transparent text-[12px] leading-[22px] placeholder-[#6F6E7A] focus:placeholder-transparent outline-none resize-none font-mono caret-[#DBDEE8] selection:bg-[#264F78] selection:text-transparent select-text overflow-auto code-editor-scroll"
                spellCheck={false}
              />
            </div>
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
