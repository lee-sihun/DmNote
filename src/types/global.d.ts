declare module '@styles/global.css';
declare module '@styles/tokens.css';
declare module '@styles/main.css';
declare module 'rollup-plugin-analyzer';

// Vite define 변수
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
