/** @type {import('tailwindcss').Config} */

// 색·모션·그림자 값의 단일 소스는 src/renderer/styles/tokens.css
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx,html}'],
  theme: {
    extend: {
      borderRadius: {
        md: 'var(--ui-radius-inner)',
        surface: 'var(--ui-radius-surface)',
        modal: 'var(--ui-radius-modal)',
      },
      colors: {
        app: 'var(--ui-bg-app)',
        panel: 'var(--ui-bg-panel)',
        surface: {
          DEFAULT: 'var(--ui-bg-surface)',
          hover: 'var(--ui-bg-surface-hover)',
          active: 'var(--ui-bg-surface-active)',
        },
        elevated: 'var(--ui-bg-elevated)',
        inset: 'var(--ui-bg-inset)',
        glass: 'var(--ui-glass)',
        'glass-heavy': 'var(--ui-glass-heavy)',
        'glass-dim': 'var(--ui-glass-dim)',
        'glass-panel': 'var(--ui-glass-panel)',
        line: {
          DEFAULT: 'var(--ui-line)',
          strong: 'var(--ui-line-strong)',
        },
        fill: {
          DEFAULT: 'var(--ui-fill)',
          hover: 'var(--ui-fill-hover)',
          active: 'var(--ui-fill-active)',
          faint: 'var(--ui-fill-faint)',
        },
        fg: {
          DEFAULT: 'var(--ui-fg)',
          muted: 'var(--ui-fg-muted)',
          faint: 'var(--ui-fg-faint)',
          disabled: 'var(--ui-fg-disabled)',
        },
        accent: {
          DEFAULT: 'var(--ui-accent)',
          hover: 'var(--ui-accent-hover)',
          active: 'var(--ui-accent-active)',
          muted: 'var(--ui-accent-muted)',
          fg: 'var(--ui-accent-fg)',
          deep: 'var(--ui-accent-deep)',
          'deep-hover': 'var(--ui-accent-deep-hover)',
          'deep-active': 'var(--ui-accent-deep-active)',
        },
        danger: {
          DEFAULT: 'var(--ui-danger)',
          hover: 'var(--ui-danger-hover)',
          active: 'var(--ui-danger-active)',
          muted: 'var(--ui-danger-muted)',
          'muted-hover': 'var(--ui-danger-muted-hover)',
          'muted-active': 'var(--ui-danger-muted-active)',
          fg: 'var(--ui-danger-fg)',
        },
        success: {
          DEFAULT: 'var(--ui-success)',
          muted: 'var(--ui-success-muted)',
        },
        warning: {
          DEFAULT: 'var(--ui-warning)',
          muted: 'var(--ui-warning-muted)',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Segoe UI',
          'sans-serif',
        ],
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '240ms',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-smooth': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      boxShadow: {
        'elevation-1': 'var(--ui-shadow-1)',
        'elevation-2': 'var(--ui-shadow-2)',
        'elevation-3': 'var(--ui-shadow-3)',
        'elevation-chrome': 'var(--ui-shadow-chrome)',
        'elevation-panel': 'var(--ui-shadow-panel)',
        'focus-ring': 'var(--ui-focus-ring)',
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        // 타이포그래피 스케일 — 위계는 크기+웨이트+행간 세트로만 표현
        '.text-caption': {
          fontSize: '11px',
          lineHeight: '16px',
          letterSpacing: '0.01em',
          fontWeight: '500',
        },
        '.text-body': {
          fontSize: '12px',
          lineHeight: '18px',
          letterSpacing: '0',
          fontWeight: '500',
        },
        '.text-label': {
          fontSize: '13px',
          lineHeight: '18px',
          letterSpacing: '0',
          fontWeight: '500',
        },
        '.text-title': {
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '-0.01em',
          fontWeight: '600',
        },
        '.text-heading': {
          fontSize: '16px',
          lineHeight: '22px',
          letterSpacing: '-0.014em',
          fontWeight: '700',
        },
        // 레거시 별칭 — 마이그레이션 완료 후 제거
        '.text-style-1': {
          fontSize: '12px',
          lineHeight: '18px',
          letterSpacing: '0',
          fontWeight: '500',
        },
        '.text-style-2': {
          fontSize: '13px',
          lineHeight: '18px',
          letterSpacing: '0',
          fontWeight: '500',
        },
        '.text-style-3': {
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '0',
          fontWeight: '500',
        },
        '.text-style-4': {
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '0',
          fontWeight: '500',
        },
      });
    },
  ],
};
