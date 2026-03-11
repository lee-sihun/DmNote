import { defineConfig } from 'vitest/config';
import path from 'path';

const rendererRoot = path.resolve(__dirname, 'src/renderer');

export default defineConfig({
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
      '@shared': path.resolve(__dirname, 'src/types'),
      '@src': path.resolve(__dirname, 'src/'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
