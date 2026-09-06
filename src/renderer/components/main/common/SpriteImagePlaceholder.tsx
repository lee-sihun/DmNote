import type { CSSProperties } from 'react';

interface SpriteImagePlaceholderProps {
  /** 아이콘 색 - 캔버스는 어두운 바탕 고정값, 패널은 테마 토큰 */
  color?: CSSProperties['color'];
}

// 그릴 이미지가 없거나 유실된 스프라이트 자리표시자. 캔버스 아이템·복제 고스트·
// 설정 카드가 같은 그림을 쓴다 - 깨진 img 노드를 남기지 않는 공통 규칙
const SpriteImagePlaceholder = ({
  color = 'rgba(237, 238, 242, 0.45)',
}: SpriteImagePlaceholderProps) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      color,
    }}
    data-sprite-placeholder="true"
  >
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="9" r="2" fill="currentColor" />
      <path
        d="M4 17.5L9.5 12.5L13.5 16L16.5 13.5L20 16.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

export default SpriteImagePlaceholder;
