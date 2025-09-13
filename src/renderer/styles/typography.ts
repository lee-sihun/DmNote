export const typography = {
  style: {
    // 12px m
    1: {
      fontSize: "12px",
      fontWeight: "500",
      lineHeight: "15px",
      letterSpacing: "0px",
    },
    // 13px m
    2: {
      fontSize: "13px",
      fontWeight: "500",
      lineHeight: "16px",
      letterSpacing: "0px",
    },
    // 14px m
    3: {
      fontSize: "14px",
      fontWeight: "500",
      lineHeight: "15.5px",
      letterSpacing: "0px",
    },
    // 14px sb
    4: {
      fontSize: "14px",
      fontWeight: "600",
      lineHeight: "17px",
      letterSpacing: "0px",
    },
  },
} as const;

export type TypographyKeys = keyof typeof typography;
