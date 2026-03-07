import React from 'react';
import { createRoot } from 'react-dom/client';
import '@styles/global.css';

async function bootstrap() {
  try {
    const { default: App } = await import('./App');
    const container = document.getElementById('root')!;
    const root = createRoot(container);
    root.render(<App />);
  } catch (error) {
    const err = error as Error;
    console.error('[OBS] Failed to mount React app:', err);
    const pre = document.createElement('pre');
    pre.style.cssText = 'color: red; padding: 20px;';
    pre.textContent = `OBS Error: ${err.message}\n${err.stack}`;
    document.body.replaceChildren(pre);
  }
}

bootstrap();
