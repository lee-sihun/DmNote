import {
  Suspense,
  lazy,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { useLenis } from "@hooks/useLenis";
import Modal from "@components/main/Modal/Modal";
import Checkbox from "@components/main/common/Checkbox";
import TrashIcon from "@assets/svgs/trash.svg";
import { getScrollShadowState } from "@utils/scrollShadow";
import {
  useFontStore,
  syncFontCSS,
} from "@stores/useFontStore";
import type { CustomFont } from "@src/types/fonts";
import {
  extractFontFamilyFromCSS,
  generateFontId,
  normalizeFontFamilyName,
} from "@src/types/fonts";
import { convertFileSrc } from "@tauri-apps/api/core";

interface FontManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  t: (key: string, options?: Record<string, string>) => string;
}

type TabType = "local" | "web";
const MAX_SCROLL_HEIGHT = 195;

let webFontInputModalPreloadPromise:
  | Promise<typeof import("./WebFontInputModal")>
  | null = null;

const preloadWebFontInputModal = () => {
  if (!webFontInputModalPreloadPromise) {
    webFontInputModalPreloadPromise = import("./WebFontInputModal");
  }
  return webFontInputModalPreloadPromise;
};

const LazyWebFontInputModal = lazy(preloadWebFontInputModal);

export default function FontManagerModal({
  isOpen,
  onClose,
  t,
}: FontManagerModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    hasTopShadow: false,
    hasBottomShadow: false,
  });
  const [skipShadowTransition, setSkipShadowTransition] = useState(true);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const isFirstRender = useRef(true);

  const [activeTab, setActiveTab] = useState<TabType>("web");
  const [isAdding, setIsAdding] = useState(false);
  const [showWebFontModal, setShowWebFontModal] = useState(false);
  const [editingWebFontId, setEditingWebFontId] = useState<string | null>(null);

  const { customFonts, setAll } = useFontStore();

  // 현재 탭에 해당하는 폰트 목록
  const currentFonts = useMemo(() => {
    return customFonts.filter((f) => f.type === activeTab);
  }, [customFonts, activeTab]);

  const editingWebFont = useMemo(
    () =>
      customFonts.find(
        (font) => font.type === "web" && font.id === editingWebFontId,
      ) || null,
    [customFonts, editingWebFontId],
  );

  // 주입된 preview CSS ID들을 추적하는 ref
  const previewIdsRef = useRef<Set<string>>(new Set());
  const previewCssCacheRef = useRef<Map<string, string>>(new Map());

  // preview용 font-family 이름 생성 (syncFontCSS의 영향을 받지 않도록 별도 이름 사용)
  const getPreviewFontFamily = useCallback((fontName: string) => `${fontName}__preview`, []);

  // preview CSS 주입 (syncFontCSS의 'font-' prefix와 다른 'fontpreview-' prefix 사용)
  const injectPreviewCSS = useCallback((id: string, css: string) => {
    const styleId = `fontpreview-${id}`;
    const existing = document.getElementById(styleId);
    if (existing) {
      existing.textContent = css;
    } else {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }, []);

  // preview CSS 제거
  const removePreviewCSS = useCallback((id: string) => {
    const style = document.getElementById(`fontpreview-${id}`);
    if (style) style.remove();
  }, []);

  // 모달이 열려있는 동안 모든 폰트의 CSS를 임시로 주입 (enabled 상태와 상관없이 미리보기 가능)
  // 폰트가 변경될 때 CSS가 실제로 달라진 항목만 갱신하여 폰트가 많아도 부담을 줄임
  useEffect(() => {
    if (!isOpen) return;

    const nextPreviewIds = new Set<string>();

    currentFonts.forEach((font) => {
      const previewId = font.id;

      // preview용 font-family 이름 사용 (원본 font-family와 분리)
      const previewFontFamily = getPreviewFontFamily(font.name);

      let css: string | null = null;
      if (font.type === "local" && font.localPath) {
        const url = convertFileSrc(font.localPath);
        const ext = font.localPath.split(".").pop()?.toLowerCase() ?? "";
        const format = ext === "otf" ? "opentype" : ext === "woff" ? "woff" : ext === "woff2" ? "woff2" : "truetype";
        css = `@font-face {\n  font-family: '${previewFontFamily}';\n  src: url('${url}') format('${format}');\n  font-weight: normal;\n  font-style: normal;\n  font-display: swap;\n}`;
      } else if (font.type === "web" && font.cssContent) {
        // 웹폰트 CSS에서 font-family를 preview 이름으로 교체
        css = font.cssContent.replace(
          /font-family:\s*['"]?([^'";]+)['"]?\s*;/i,
          `font-family: '${previewFontFamily}';`
        );
      }

      if (css) {
        nextPreviewIds.add(previewId);

        if (previewCssCacheRef.current.get(previewId) !== css) {
          // CSS가 실제로 바뀐 경우에만 갱신하여 reflow/repaint를 줄임
          injectPreviewCSS(previewId, css);
          previewCssCacheRef.current.set(previewId, css);
        }
      }
    });

    previewIdsRef.current.forEach((id) => {
      if (!nextPreviewIds.has(id)) {
        removePreviewCSS(id);
        previewCssCacheRef.current.delete(id);
      }
    });

    previewIdsRef.current = nextPreviewIds;
  }, [
    isOpen,
    currentFonts,
    getPreviewFontFamily,
    injectPreviewCSS,
    removePreviewCSS,
  ]);

  // 모달이 닫힐 때만 모든 preview CSS 제거
  useEffect(() => {
    if (isOpen) return;

    // 모달이 닫히면 모든 preview CSS 제거
    previewIdsRef.current.forEach((id) => removePreviewCSS(id));
    previewIdsRef.current.clear();
    previewCssCacheRef.current.clear();
  }, [isOpen, removePreviewCSS]);

  // 폰트 매니저가 열려 있는 동안 WebFontInputModal 코드를 미리 로드
  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(() => {
      void preloadWebFontInputModal();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // 스크롤 상태 업데이트 함수
  const updateScrollState = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const nextState = getScrollShadowState(el, contentRef.current);
    setScrollState((prev) =>
      prev.hasTopShadow === nextState.hasTopShadow &&
      prev.hasBottomShadow === nextState.hasBottomShadow
        ? prev
        : nextState,
    );
  }, []);

  // Lenis smooth scroll 적용
  const { scrollContainerRef: scrollRef, wrapperElement } = useLenis({
    onScroll: () => updateScrollState(wrapperElement),
  });

  // 스크롤 상태 및 높이 업데이트
  useLayoutEffect(() => {
    if (!isOpen) return;

    setSkipShadowTransition(true);
    setScrollState({ hasTopShadow: false, hasBottomShadow: false });
    setIsScrollable(false);

    const el = wrapperElement;
    const contentEl = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (contentEl) {
        const contentHeight = contentEl.scrollHeight;
        setContainerHeight(Math.min(contentHeight, MAX_SCROLL_HEIGHT));
        setIsScrollable(contentHeight > MAX_SCROLL_HEIGHT);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState(el);
      updateHeight();
    });

    if (contentEl) {
      resizeObserver.observe(contentEl);
    }
    resizeObserver.observe(el);

    updateScrollState(el);
    updateHeight();

    const rafId = requestAnimationFrame(() => {
      setSkipShadowTransition(false);
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, activeTab, currentFonts, wrapperElement, updateScrollState]);

  const persistFonts = useCallback(
    (nextFonts: CustomFont[]) => {
      setAll(nextFonts);
      // Note: syncFontCSS()는 모달이 닫힐 때 한 번만 호출 (깜빡임 방지)
      window.api.settings
        .update({ fontSettings: { customFonts: nextFonts } })
        .catch((error) => {
          console.error("Failed to persist font settings:", error);
        });
    },
    [setAll],
  );

  const isDuplicateFontFamily = useCallback(
    (fontFamily: string, options?: { excludeId?: string | null }) => {
      const normalizedFamily = normalizeFontFamilyName(fontFamily);
      if (!normalizedFamily) return false;

      const allFonts = useFontStore.getState().getAllFonts();
      return allFonts.some((font) => {
        if (options?.excludeId && font.id === options.excludeId) {
          return false;
        }
        return normalizeFontFamilyName(font.name) === normalizedFamily;
      });
    },
    [],
  );

  const showDuplicateFontFamilyAlert = useCallback(
    (fontFamily: string) => {
      const message =
        t("webFontInput.duplicateFontFamilyAlert", { name: fontFamily }) ||
        `"${fontFamily}" 폰트가 이미 등록되어 있습니다.`;

      void window.api.ui.dialog
        .alert(message, { confirmText: t("common.ok") || "확인" })
        .catch((error) => {
          console.error("Failed to open duplicate font alert:", error);
        });
    },
    [t],
  );

  // 로컬 폰트 파일 선택
  const handleAddLocalFont = useCallback(async () => {
    setIsAdding(true);
    try {
      // Tauri font_load 명령어 사용
      const result = await window.api.font.load();

      if (result.success && result.fontName && result.fontPath) {
        if (isDuplicateFontFamily(result.fontName)) {
          showDuplicateFontFamilyAlert(result.fontName);
          return;
        }

        const newFont: CustomFont = {
          id: generateFontId(),
          type: "local",
          name: result.fontName,
          displayName: result.fontName,
          enabled: true,
          localPath: result.fontPath,
        };
        const nextFonts = [...useFontStore.getState().customFonts, newFont];
        persistFonts(nextFonts);
      } else if (result.error) {
        console.error("Failed to load font:", result.error);
      }
    } catch (error) {
      console.error("Failed to add local font:", error);
    } finally {
      setIsAdding(false);
    }
  }, [isDuplicateFontFamily, persistFonts, showDuplicateFontFamilyAlert]);

  // 웹폰트 추가 버튼 클릭
  const handleAddWebFont = useCallback(() => {
    void preloadWebFontInputModal();
    setEditingWebFontId(null);
    setShowWebFontModal(true);
  }, []);

  const handleEditWebFont = useCallback((fontId: string) => {
    void preloadWebFontInputModal();
    setEditingWebFontId(fontId);
    setShowWebFontModal(true);
  }, []);

  const handleCloseWebFontModal = useCallback(() => {
    setShowWebFontModal(false);
    setEditingWebFontId(null);
  }, []);

  // 웹폰트 CSS 추가 완료
  const handleWebFontSubmit = useCallback(
    (css: string, displayName: string) => {
      const fontFamily = extractFontFamilyFromCSS(css);
      if (!fontFamily) {
        console.error("Failed to extract font-family from CSS");
        return;
      }

      if (isDuplicateFontFamily(fontFamily, { excludeId: editingWebFontId })) {
        showDuplicateFontFamilyAlert(fontFamily);
        return;
      }

      const currentCustomFonts = useFontStore.getState().customFonts;
      const newWebFont: CustomFont = {
        id: generateFontId(),
        type: "web",
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
      handleCloseWebFontModal();
    },
    [
      editingWebFontId,
      handleCloseWebFontModal,
      isDuplicateFontFamily,
      persistFonts,
      showDuplicateFontFamilyAlert,
    ],
  );

  // 폰트 삭제
  const handleRemoveFont = useCallback(
    (id: string) => {
      const nextFonts = useFontStore
        .getState()
        .customFonts.filter((font) => font.id !== id);
      persistFonts(nextFonts);
    },
    [persistFonts],
  );

  // 폰트 토글
  const handleToggleFont = useCallback(
    (id: string, enabled: boolean) => {
      const nextFonts = useFontStore.getState().customFonts.map((font) =>
        font.id === id ? { ...font, enabled } : font,
      );
      persistFonts(nextFonts);
    },
    [persistFonts],
  );

  // 추가 버튼 클릭
  const handleAdd = useCallback(() => {
    if (activeTab === "local") {
      handleAddLocalFont();
    } else {
      handleAddWebFont();
    }
  }, [activeTab, handleAddLocalFont, handleAddWebFont]);

  // 모달 닫기 핸들러 (닫힐 때 syncFontCSS 호출)
  const handleClose = useCallback(() => {
    syncFontCSS();
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <>
      <Modal onClick={handleClose}>
        <div
          className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] pr-[6px]"
          onClick={(event) => event.stopPropagation()}
        >
          {/* 탭 전환 */}
          <div className="pr-[14px]">
            <div className="flex w-full h-[30px] bg-[#26262C] mb-[19px] rounded-[7px] items-center p-[3px] gap-[5px]">
              <button
                type="button"
                className={`w-full h-[24px] rounded-[7px] text-style-2 transition-colors ${
                  activeTab === "web"
                    ? "bg-[#3A3943] text-white"
                    : "bg-[#26262C] text-[#9395A1] hover:bg-[#303036]"
                }`}
                onClick={() => setActiveTab("web")}
              >
                {t("fontManager.webTab") || "웹폰트"}
              </button>
              <button
                type="button"
                className={`w-full h-[24px] rounded-[7px] text-style-2 transition-colors ${
                  activeTab === "local"
                    ? "bg-[#3A3943] text-white"
                    : "bg-[#26262C] text-[#9395A1] hover:bg-[#303036]"
                }`}
                onClick={() => setActiveTab("local")}
              >
                {t("fontManager.localTab") || "로컬 폰트"}
              </button>
            </div>
          </div>

          {/* 스크롤 영역 */}
          <div className="relative">
            {/* 상단 그림자 */}
            <div
              className={`absolute top-0 left-0 right-[14px] h-[10px] bg-gradient-to-b from-[#1A191E] to-transparent pointer-events-none z-10 ${
                skipShadowTransition ? "" : "transition-opacity duration-150"
              } ${scrollState.hasTopShadow ? "opacity-100" : "opacity-0"}`}
            />

            <div
              ref={scrollRef}
              className="modal-content-scroll pr-[14px]"
              style={{
                height:
                  containerHeight !== null ? `${containerHeight}px` : "auto",
                maxHeight: `${MAX_SCROLL_HEIGHT}px`,
                overflowY: isScrollable ? "auto" : "hidden",
                transition: isFirstRender.current
                  ? "none"
                  : "height 100ms ease-in-out",
                willChange: "scroll-position",
              }}
            >
              <div
                ref={contentRef}
                className="flex flex-col gap-[19px] py-[5px]"
              >
                {currentFonts.length === 0 ? (
                  <div className="flex items-center justify-center py-[10px] px-[12px] text-style-2 text-white">
                    {activeTab === "local"
                      ? t("fontManager.noLocalFonts") || "로컬 폰트가 없습니다"
                      : t("fontManager.noWebFonts") || "웹폰트가 없습니다"}
                  </div>
                ) : (
                  currentFonts.map((font) => (
                    <div
                      key={font.id}
                      className="flex items-center justify-between"
                      style={{ transform: "translateZ(0)" }}
                    >
                      <div className="flex items-center gap-[10px] h-[23px]">
                        <button
                          className="flex items-center justify-center transition-colors hover:opacity-80"
                          onClick={() => handleRemoveFont(font.id)}
                          aria-label={
                            t("fontManager.removeFont") || "폰트 삭제"
                          }
                          title={t("fontManager.removeFont") || "폰트 삭제"}
                        >
                          <TrashIcon className="w-[14px] h-[15px]" />
                        </button>
                        {font.type === "web" ? (
                          <button
                            type="button"
                            className="appearance-none bg-transparent border-0 p-0 m-0 text-white text-style-2 text-left leading-[23px] cursor-pointer transition-colors duration-150 hover:text-[#DBDEE8]"
                            style={{
                              fontFamily: `${font.name}__preview, ${font.name}`,
                            }}
                            onClick={() => handleEditWebFont(font.id)}
                            title={t("webFontInput.update") || "수정"}
                          >
                            {font.displayName}
                          </button>
                        ) : (
                          <span
                            className="text-white text-style-2"
                            style={{
                              fontFamily: `${font.name}__preview, ${font.name}`,
                            }}
                          >
                            {font.displayName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-center w-[27px] h-[21px]">
                        <Checkbox
                          checked={font.enabled}
                          onChange={() =>
                            handleToggleFont(font.id, !font.enabled)
                          }
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 하단 그림자 */}
            <div
              className={`absolute bottom-0 left-0 right-[14px] h-[10px] bg-gradient-to-t from-[#1A191E] to-transparent pointer-events-none z-10 ${
                skipShadowTransition ? "" : "transition-opacity duration-150"
              } ${scrollState.hasBottomShadow ? "opacity-100" : "opacity-0"}`}
            />
          </div>

          {/* 구분선 */}
          <div className="h-px bg-[#2A2A30] my-[20px] -ml-[20px] -mr-[6px]" />

          {/* 하단 버튼 */}
          <div className="flex items-center gap-[10.5px] pr-[14px]">
            <button
              className={`flex items-center justify-center w-[150px] h-[30px] rounded-[7px] text-style-3 text-[#DCDEE7] transition-colors ${
                isAdding
                  ? "bg-[#222228] cursor-not-allowed opacity-50"
                  : "bg-[#2A2A30] hover:bg-[#34343c]"
              }`}
              onClick={handleAdd}
              disabled={isAdding}
            >
              {isAdding
                ? t("fontManager.adding") || "추가 중..."
                : `${t("fontManager.addFont") || "추가"} (${
                    currentFonts.length
                  })`}
            </button>
            <button
              className="flex items-center justify-center w-[75px] h-[30px] bg-[#2A2A30] rounded-[7px] text-style-3 text-[#DCDEE7] hover:bg-[#34343c] transition-colors"
              onClick={handleClose}
            >
              {t("common.ok") || "확인"}
            </button>
          </div>
        </div>
      </Modal>

      {/* 웹폰트 CSS 입력 모달 */}
      {showWebFontModal ? (
        <Suspense
          fallback={
            <Modal onClick={handleCloseWebFontModal}>
              <div
                className="w-[640px] max-w-[calc(100vw-80px)] h-[335px] flex items-center justify-center bg-[#1A191E] rounded-[10px] border border-[#2A2A30]"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-[12px] leading-[16px] text-[#8A8D99]">
                  로딩 중...
                </p>
              </div>
            </Modal>
          }
        >
          <LazyWebFontInputModal
            isOpen={showWebFontModal}
            onClose={handleCloseWebFontModal}
            onSubmit={handleWebFontSubmit}
            initialCss={editingWebFont?.cssContent || ""}
            isDuplicateFontFamily={(fontFamily) =>
              isDuplicateFontFamily(fontFamily, { excludeId: editingWebFontId })
            }
            t={t}
          />
        </Suspense>
      ) : null}
    </>
  );
}
