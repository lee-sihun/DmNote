import { defineConfig, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';
import analyzer from 'rollup-plugin-analyzer';
import removeConsole from './vite-plugin-remove-console.js';
import pkg from './package.json';

const onRollupWarning: Rollup.WarningHandlerWithDefault = (warning, warn) => {
  const isReactCompilerDirective =
    warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
    warning.message.includes('"use no memo"') &&
    /[\\/]src[\\/]renderer[\\/]/.test(warning.id ?? '');

  // React Compiler 제어 지시문은 번들 실행 시 의미가 없고 소스 변환 단계에서만 소비됨
  if (isReactCompilerDirective) return;

  warn(warning);
};

export default defineConfig(async () => {
  const projectRoot = __dirname;
  const rendererRoot = path.resolve(projectRoot, 'src/renderer');
  const windowsRoot = path.resolve(rendererRoot, 'windows');
  const isAnalyze = process.env.ANALYZE === 'true';
  const configuredPort = Number(process.env.DMN_VITE_PORT);
  const devServerPort =
    Number.isInteger(configuredPort) && configuredPort > 0
      ? configuredPort
      : 3400;

  return {
    // Vite 개발 서버 루트: /main/index.html, /overlay/index.html 경로로 접근 가능
    root: windowsRoot,
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react({
        babel: {
          plugins: [
            [
              'babel-plugin-react-compiler',
              {
                // signals 파일 제외
                sources: (filename: string) => {
                  if (filename.includes('stores/signals/')) return false;
                  return true;
                },
              },
            ],
          ],
        },
      }),
      svgr({
        include: '**/*.svg',
        svgrOptions: {
          // named export: { ReactComponent }
          exportType: 'default',
        },
      }),
      removeConsole(),
      isAnalyze &&
        analyzer({
          summaryOnly: true,
        }),
      isAnalyze &&
        (await import('rollup-plugin-visualizer')).visualizer({
          filename: path.resolve(projectRoot, 'dist', 'stats.html'),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          open: false,
        }),
    ].filter(Boolean),
    server: {
      port: devServerPort,
      strictPort: true,
      open: false,
      fs: {
        // 루트 상위(src/renderer 등) 경로 import 허용
        allow: [projectRoot, rendererRoot, windowsRoot],
      },
    },
    resolve: {
      alias: {
        '@components': path.resolve(rendererRoot, 'components'),
        '@styles': path.resolve(rendererRoot, 'styles'),
        '@windows': path.resolve(rendererRoot, 'windows'),
        '@hooks': path.resolve(rendererRoot, 'hooks'),
        '@api': path.resolve(rendererRoot, 'api'),
        '@assets': path.resolve(rendererRoot, 'assets'),
        '@utils': path.resolve(rendererRoot, 'utils'),
        '@stores': path.resolve(rendererRoot, 'stores'),
        '@constants': path.resolve(rendererRoot, 'constants'),
        '@contexts': path.resolve(rendererRoot, 'contexts'),
        '@plugins': path.resolve(rendererRoot, 'plugins'),
        '@config': path.resolve(rendererRoot, 'config'),
        '@shared': path.resolve(projectRoot, 'src/types'),
        '@src': path.resolve(projectRoot, 'src/'),
      },
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    },
    build: {
      outDir: path.resolve(projectRoot, 'dist/renderer'),
      emptyOutDir: true,
      // 데스크톱 앱에 내장되는 메인 UI 청크의 현재 상한
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        onwarn: onRollupWarning,
        input: {
          main: path.resolve(windowsRoot, 'main/index.html'),
          overlay: path.resolve(windowsRoot, 'overlay/index.html'),
          obs: path.resolve(windowsRoot, 'obs/index.html'),
        },
      },
    },
  };
});
