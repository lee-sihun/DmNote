import { PANEL_HEADER_HEIGHT } from '@components/main/Grid/PropertiesPanel/panelChrome';

import type { PanelDragGhost as PanelDragGhostRect } from '@hooks/panel/usePanelHeaderDrag';

interface PanelDragGhostProps {
  ghost: PanelDragGhostRect;
}

// 헤더 드래그 중 커서를 따라다니는 패널 실루엣 - 분리 창과 같은 크기·라운딩·표면색.
// 메인 창 안에서만 그려지고, 커서가 창 밖으로 나가면 실제 창이 이어받는다
const PanelDragGhost = ({ ghost }: PanelDragGhostProps) => (
  <div
    aria-hidden="true"
    data-dmn-panel-drag-ghost=""
    className="pointer-events-none fixed z-[200] rounded-[12px] overflow-hidden bg-panel-detached shadow-elevation-panel opacity-70"
    style={{
      left: ghost.x,
      top: ghost.y,
      width: ghost.width,
      height: ghost.height,
      boxShadow:
        'inset 0 0 0 1px var(--ui-line), 0 12px 32px rgba(0, 0, 0, 0.35)',
    }}
  >
    {/* 잡고 있는 헤더 띠 - 어디를 쥐었는지 감이 오게 살짝 밝힌다 */}
    <div
      className="w-full bg-white/[0.04] border-b border-[var(--ui-line)]"
      style={{ height: PANEL_HEADER_HEIGHT }}
    />
  </div>
);

export default PanelDragGhost;
