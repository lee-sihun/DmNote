export const colors = {
  primary: '#1A191E',

  button: {
    primary: '#000000',
    hover: '#1F1F23',
    active: '#2A2A30',
  },

  text: {
    white1: '#FFFFFF',
    white2: '#DBDEE8',
  },

  border: '#3A3943',
  surface: '#2A2A30',
  surfaceHover: '#303036',
  surfaceActive: '#393941',
  hoverDark: '#353540',
  focus: '#459BF8',
  textDisabled: '#6B6D75',

  danger: {
    bg: '#3C1E1E',
    hover: '#442222',
    active: '#522929',
    text: '#E6DBDB',
  },
} as const;

export type ColorKeys = keyof typeof colors;
