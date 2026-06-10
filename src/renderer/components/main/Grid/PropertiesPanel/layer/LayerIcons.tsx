import React from 'react';

// ============================================================================
// 그룹 폴더 아이콘
// ============================================================================

export const FolderIcon: React.FC<{ open?: boolean }> = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    {open ? (
      <path
        d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L7 4H11.5C12.05 4 12.5 4.45 12.5 5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L7 4H11.5C12.05 4 12.5 4.45 12.5 5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    )}
  </svg>
);

export const ChevronIcon: React.FC<{ collapsed?: boolean }> = ({
  collapsed,
}) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    style={{
      transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <path
      d="M3 4L5 6L7 4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// 요소 타입 아이콘
// ============================================================================

export const KeyIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="2"
      y="2"
      width="10"
      height="10"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <circle cx="7" cy="7" r="2" fill="currentColor" />
  </svg>
);

export const PluginIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="7"
      y="0.05"
      width="9.8"
      height="9.8"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.2"
      transform="rotate(45 7 0.05)"
    />
    <circle cx="7" cy="7" r="2" fill="currentColor" />
  </svg>
);

export const StatIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M10.8 2H3.7c-.4 0-.7.3-.7.7 0 .2.1.4.2.5l3 3.8-3 3.8c-.1.1-.2.3-.2.5 0 .4.3.7.7.7h7.1"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const GraphIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M2 10.5L5.2 7.3L7.4 8.8L12 4.2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 4.2H9.8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

export const DialIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M7 2.5V7"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
