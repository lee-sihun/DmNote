/** @type {import('tailwindcss').Config} */
const { typography } = require("./src/renderer/styles/typography");

module.exports = {
  content: ["./src/**/*.{js,jsx,tsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        ".all-unset": {
          all: "unset",
        },
        ".text-style-1": {
          fontSize: typography.style[1].fontSize,
          lineHeight: typography.style[1].lineHeight,
          letterSpacing: typography.style[1].letterSpacing,
          fontWeight: typography.style[1].fontWeight,
        },
        ".text-style-2": {
          fontSize: typography.style[2].fontSize,
          lineHeight: typography.style[2].lineHeight,
          letterSpacing: typography.style[2].letterSpacing,
          fontWeight: typography.style[2].fontWeight,
        },
        ".text-style-3": {
          fontSize: typography.style[3].fontSize,
          lineHeight: typography.style[3].lineHeight,
          letterSpacing: typography.style[3].letterSpacing,
          fontWeight: typography.style[3].fontWeight,
        },
        ".text-style-4": {
          fontSize: typography.style[4].fontSize,
          lineHeight: typography.style[4].lineHeight,
          letterSpacing: typography.style[4].letterSpacing,
          fontWeight: typography.style[4].fontWeight,
        },
      });
    },
  ],
};
