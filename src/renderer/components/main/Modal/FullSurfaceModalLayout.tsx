import { usePressAction } from '@hooks/usePressAction';
import type { ReactNode } from 'react';
import Modal from './Modal';

// 전면 시트 재질 — 시트 크롬과 로딩 폴백이 같은 소스를 공유
export const FULL_SURFACE_MATERIAL_CLASS = 'bg-glass-heavy backdrop-glass';

interface FullSurfaceModalLayoutProps {
  onClose: () => void;
  title: string;
  /** 제목 옆 보조 정보 (아이콘 + 캡션 등) */
  headerInfo?: ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  cancelLabel: string;
  children: ReactNode;
}

// 전면 시트 공통 크롬 — 재질·칼럼·헤더·액션을 한 곳이 소유, 본문 레이아웃은 소비자 몫
const FullSurfaceModalLayout = ({
  onClose,
  title,
  headerInfo,
  submitLabel,
  submitDisabled = false,
  onSubmit,
  cancelLabel,
  children,
}: FullSurfaceModalLayoutProps) => {
  // 입력 blur·IME flush와의 경합으로 첫 click이 유실되는 것을 방어
  const submitPress = usePressAction(onSubmit);
  const cancelPress = usePressAction(onClose);

  return (
    <Modal
      fullSurface
      onClick={onClose}
      ariaLabel={title}
      // 시트 크롬을 먼저 그리고 무거운 본문은 다음 틱에 붙인다. 소비자가 본문 노드에
      // 이펙트를 걸 때는 마운트 시점 ref 읽기가 아니라 ref 콜백이나 노드 state로
      // 붙는 순간을 받아야 한다 - 첫 커밋에는 본문이 없다
      contentMountStrategy="after-paint"
    >
      <div
        className={`w-full h-full flex flex-col ${FULL_SURFACE_MATERIAL_CLASS}`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* 시트 칼럼 — 모달 카드와 같은 문법: 바깥 14px 패딩 + 내부 12px 갭 */}
        <div className="w-full h-full max-w-[960px] mx-auto flex flex-col p-[14px] gap-[12px] min-h-0">
          {/* 헤더 행 — 제목·보조 정보 좌측, 액션 우측 */}
          <div className="shrink-0 flex items-center justify-between gap-[12px]">
            <div className="min-w-0 flex items-center gap-[12px]">
              <h2 className="shrink-0 text-heading text-fg">{title}</h2>
              {headerInfo}
            </div>
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                className={`w-[120px] h-[30px] rounded-surface text-label transition-colors duration-fast ${
                  submitDisabled
                    ? 'bg-fill-faint text-fg-disabled cursor-not-allowed'
                    : 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active'
                }`}
                {...submitPress}
                disabled={submitDisabled}
              >
                {submitLabel}
              </button>
              <button
                type="button"
                className="px-[24px] h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
                {...cancelPress}
              >
                {cancelLabel}
              </button>
            </div>
          </div>

          {children}
        </div>
      </div>
    </Modal>
  );
};

export default FullSurfaceModalLayout;
