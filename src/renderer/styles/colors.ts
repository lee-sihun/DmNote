export const colors = {
  primary: "#1A191E",

  button: {
    primary: "#000000",
    hover: "#1F1F23",
    active: "#2A2A30",
  },

  text: {
    white1: "#FFFFFF",
    white2: "#DBDEE8",
  },
} as const;

export type ColorKeys = keyof typeof colors;
